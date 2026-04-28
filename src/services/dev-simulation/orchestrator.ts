// Dev-mode simulation orchestrator — runs one async loop per hospital and
// pushes synthetic events into the webhook service functions directly (no
// HTTP round-trip). In-memory state; resets on server restart.
//
// Gated at every call site: orchestrator.start() throws in production.

import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { KK_HOSPITALS } from '@/config/hospitals';
import {
  generateLaborEvent,
  generateAncEvent,
  generateReferralEvent,
  generateReferralUpdateEvent,
  generatePartographEvent,
  type HospitalContext,
} from './generators';
import { getOrCreateDevApiKey, revokeDevApiKeys } from './api-keys';
import { resetPool } from './pool';
import { ensurePlan, getHospitalPlan, resetPlans } from './planner';
import { evalStats, resetEvalStats } from './generators';
import { isSimulationEnabled } from '@/lib/feature-flags';
import type {
  SimulationConfig,
  SimulationStatus,
  SimulationEventLog,
  HospitalSimState,
  SimEventType,
} from './types';

const MAX_RECENT_EVENTS = 40;

interface HospitalWorker {
  hcode: string;
  name: string;
  state: HospitalSimState;
  loopTimer: ReturnType<typeof setTimeout> | null;
  abort: AbortController;
}

class SimulationOrchestrator {
  private running = false;
  private config: SimulationConfig | null = null;
  private startedAt: string | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private recentEvents: SimulationEventLog[] = [];
  private workers: Map<string, HospitalWorker> = new Map();
  /**
   * Base URL for the webhook POSTs. Resolved from env so the simulator can
   * target the same Next.js server it runs inside (default) or a remote one.
   */
  private get webhookBaseUrl(): string {
    return (
      process.env.SIM_WEBHOOK_BASE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(config: SimulationConfig): Promise<SimulationStatus> {
    if (this.running) {
      throw new Error('Simulation already running; stop it first');
    }
    if (!isSimulationEnabled()) {
      throw new Error('Simulation disabled by feature flag');
    }
    if (config.eventTypes.length === 0) {
      throw new Error('At least one event type required');
    }
    if (config.ratePerHospitalPerMin <= 0) {
      throw new Error('ratePerHospitalPerMin must be > 0');
    }
    if (config.durationMin <= 0) {
      throw new Error('durationMin must be > 0');
    }

    await ensureInit();

    const roster: HospitalContext[] = (
      config.hospitals.length > 0
        ? KK_HOSPITALS.filter((h) => config.hospitals.includes(h.hcode))
        : KK_HOSPITALS
    ).map((h) => ({ hcode: h.hcode, name: h.name }));

    // Pre-flight: issue + verify an API key for every hospital by POSTing an
    // empty body to the real webhook endpoint. Auth runs before validation on
    // the server, so:
    //   401 → auth broken for this hospital (stale cache, bundle-split DB,
    //         key row missing), count as preflight failure.
    //   400 VALIDATION_FAILED → auth OK, body rejected (expected), count as
    //         success.
    //   anything else → treat as success, but log.
    // If ANY hospital fails, throw before scheduling workers. This replaces
    // the old behaviour where every tick flooded the event log with 401s
    // until someone noticed.
    await this.preflightValidateAuth(roster);

    this.running = true;
    this.config = config;
    this.startedAt = new Date().toISOString();
    this.recentEvents = [];
    this.workers.clear();
    resetPlans();           // Tier-3: force fresh plan generation on each start
    resetEvalStats();

    for (const h of roster) {
      const worker: HospitalWorker = {
        hcode: h.hcode,
        name: h.name,
        state: {
          hcode: h.hcode,
          hospitalName: h.name,
          running: true,
          eventsSucceeded: 0,
          eventsFailed: 0,
          lastEventAt: null,
          lastError: null,
        },
        loopTimer: null,
        abort: new AbortController(),
      };
      this.workers.set(h.hcode, worker);
      this.scheduleNext(worker, roster);
    }

    // Kick off Tier-3 plan generation — STAGGERED. vLLM serves one prompt
    // at a time per model, so firing 26 plan LLM calls simultaneously makes
    // them all starve each other and time out. We space them 2s apart so
    // the model chews through one plan before the next arrives. Workers
    // start immediately and fall back to profile sampling for their first
    // few events until their plan lands.
    const STAGGER_MS = 2_000;
    roster.forEach((h, i) => {
      setTimeout(() => {
        if (!this.running) return;
        const worker = this.workers.get(h.hcode);
        if (!worker) return;
        ensurePlan({
          hospitalName: h.name,
          hcode: h.hcode,
          scenario: config.scenario,
          eventTypes: config.eventTypes,
          model: config.model,
          signal: worker.abort.signal,
        }).catch((err) => {
          logger.warn('sim_plan_kickoff_failed', {
            hcode: h.hcode,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }, i * STAGGER_MS);
    });

    // Auto-stop after duration.
    this.stopTimer = setTimeout(() => {
      this.stop().catch((err) => logger.warn('sim_auto_stop_failed', { err: String(err) }));
    }, config.durationMin * 60_000);

    logger.info('simulation_started', {
      hospitals: roster.length,
      eventTypes: config.eventTypes,
      ratePerHospitalPerMin: config.ratePerHospitalPerMin,
      durationMin: config.durationMin,
      model: config.model,
    });

    return this.status();
  }

  async stop(): Promise<SimulationStatus> {
    if (!this.running) return this.status();
    this.running = false;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    for (const w of this.workers.values()) {
      w.state.running = false;
      if (w.loopTimer) clearTimeout(w.loopTimer);
      w.abort.abort();
    }
    resetPool();
    resetPlans();
    try {
      const db = await getDatabase();
      const revoked = await revokeDevApiKeys(db);
      logger.info('simulation_stopped', {
        totalEvents: this.recentEvents.length,
        apiKeysRevoked: revoked,
      });
    } catch (err) {
      logger.warn('sim_key_revoke_on_stop_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return this.status();
  }

  status(): SimulationStatus {
    const hospitals = Array.from(this.workers.values()).map((w) => {
      const plan = getHospitalPlan(w.hcode);
      return {
        ...w.state,
        plan: plan
          ? {
              narrative: plan.narrative,
              total: plan.events.length,
              consumed: plan.cursor,
              remaining: plan.events.length - plan.cursor,
              refilling: plan.refilling,
            }
          : null,
      };
    });
    return {
      running: this.running,
      startedAt: this.startedAt,
      stoppingAt: this.running && this.stopTimer && this.startedAt && this.config
        ? new Date(new Date(this.startedAt).getTime() + this.config.durationMin * 60_000).toISOString()
        : null,
      config: this.config,
      hospitals,
      recentEvents: [...this.recentEvents],
      evaluation: { ...evalStats },
    };
  }

  /**
   * Issues an API key for each hospital and confirms the webhook endpoint
   * accepts it (expects HTTP 400 VALIDATION_FAILED on an empty body — auth
   * runs before payload validation, so 400 proves auth worked). Any 401, or
   * hospitals missing from the local hospitals table, become a pre-flight
   * failure that aborts start() before any worker is scheduled.
   *
   * Runs hospitals sequentially: the PGlite mutex would serialize them
   * anyway, and this way one broken hospital doesn't mask the rest.
   */
  private async preflightValidateAuth(roster: HospitalContext[]): Promise<void> {
    const db = await getDatabase();
    const base = this.webhookBaseUrl;
    const failures: Array<{ hcode: string; name: string; reason: string }> = [];

    for (const h of roster) {
      try {
        const hospRow = await db.query<{ id: string }>(
          'SELECT id FROM hospitals WHERE hcode = ?',
          [h.hcode],
        );
        if (hospRow.length === 0) {
          failures.push({ hcode: h.hcode, name: h.name, reason: 'hospital not found in DB' });
          continue;
        }
        const apiKey = await getOrCreateDevApiKey(db, hospRow[0].id, h.hcode);
        const res = await fetch(`${base}/api/webhooks/patient-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({}),
        });
        if (res.status === 401) {
          const txt = await res.text().catch(() => '');
          failures.push({
            hcode: h.hcode,
            name: h.name,
            reason: `auth rejected (HTTP 401): ${txt.slice(0, 160)}`,
          });
        }
        // 400 (validation failed on empty body) = auth OK. Any other status
        // we treat as auth-passed too — the point of preflight is to rule
        // OUT 401, not to fully validate payload contracts.
      } catch (err) {
        failures.push({
          hcode: h.hcode,
          name: h.name,
          reason: `preflight threw: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (failures.length > 0) {
      logger.error('sim_preflight_auth_failed', {
        failureCount: failures.length,
        total: roster.length,
        failures,
      });
      const summary = failures
        .slice(0, 5)
        .map((f) => `${f.hcode} (${f.name}): ${f.reason}`)
        .join(' | ');
      const more = failures.length > 5 ? ` (+${failures.length - 5} more)` : '';
      throw new Error(
        `Pre-flight webhook auth failed for ${failures.length}/${roster.length} hospital(s). ${summary}${more}`,
      );
    }

    logger.info('sim_preflight_auth_ok', { hospitals: roster.length });
  }

  private scheduleNext(worker: HospitalWorker, roster: HospitalContext[]): void {
    if (!this.running || !this.config) return;
    // Mean interval = 60_000 / rate ms; jitter ±30%.
    const mean = 60_000 / Math.max(1, this.config.ratePerHospitalPerMin);
    const jitter = mean * 0.3 * (Math.random() * 2 - 1);
    const delay = Math.max(500, mean + jitter);
    worker.loopTimer = setTimeout(async () => {
      if (!this.running) return;
      await this.dispatchOne(worker, roster);
      this.scheduleNext(worker, roster);
    }, delay);
  }

  private async dispatchOne(
    worker: HospitalWorker,
    roster: HospitalContext[],
  ): Promise<void> {
    if (!this.config) return;
    const type = pickEventType(this.config.eventTypes);
    const hosp: HospitalContext = { hcode: worker.hcode, name: worker.name };
    try {
      const db = await getDatabase();
      const hospRow = await db.query<{ id: string }>(
        'SELECT id FROM hospitals WHERE hcode = ?',
        [worker.hcode],
      );
      if (hospRow.length === 0) {
        throw new Error(`hospital ${worker.hcode} not in local DB`);
      }
      const hospitalId = hospRow[0].id;
      const apiKey = await getOrCreateDevApiKey(db, hospitalId, worker.hcode);
      const signal = worker.abort.signal;

      // Build the webhook body per event type. Some types (partograph,
      // referral_update) can return null if there's no appropriate target
      // in the pool yet — we just skip without counting as a failure.
      let body: unknown = null;
      let summary = '';
      if (type === 'labor') {
        const patient = await generateLaborEvent(hosp, this.config.scenario, signal, this.config.model);
        body = { hospitalCode: worker.hcode, mode: 'incremental', patients: [patient] };
        summary = `Labor admit · ${patient.an} · GA ${patient.ga_weeks}w`;
      } else if (type === 'anc') {
        const patient = await generateAncEvent(hosp, this.config.scenario, signal, this.config.model);
        body = { type: 'anc_data', hospitalCode: worker.hcode, patients: [patient] };
        summary = `ANC · ${patient.hn ?? 'CID'} · preg#${patient.pregNo}`;
      } else if (type === 'referral') {
        const event = await generateReferralEvent(hosp, roster, this.config.scenario, signal, this.config.model);
        body = event;
        summary = `Refer ${event.referralId} → ${event.toHospitalCode} · ${event.urgencyLevel}`;
      } else if (type === 'referral_update') {
        const event = generateReferralUpdateEvent(hosp);
        if (!event) {
          this.logEvent({
            at: new Date().toISOString(),
            hcode: worker.hcode,
            type,
            ok: true,
            summary: 'referral_update skipped (no pending referral for this hospital)',
          });
          return;
        }
        body = event;
        summary = `Ref update ${event.referralId} · ${event.status}`;
      } else if (type === 'partograph') {
        const event = await generatePartographEvent(hosp, signal, this.config.model);
        if (!event) {
          this.logEvent({
            at: new Date().toISOString(),
            hcode: worker.hcode,
            type,
            ok: true,
            summary: 'partograph skipped (no recent admission)',
          });
          return;
        }
        body = event;
        const latest = event.observations[event.observations.length - 1];
        summary = `Partograph ${latest.an} · batch ×${event.observations.length} · up to hour ${latest.hourNo} · ${latest.cervicalDilationCm}cm`;
      } else {
        throw new Error(`unsupported event type: ${type}`);
      }

      // Hit the real webhook endpoint — exercises auth, parsing, routing, error handling.
      const res = await fetch(`${this.webhookBaseUrl}/api/webhooks/patient-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      worker.state.eventsSucceeded += 1;
      worker.state.lastEventAt = new Date().toISOString();
      worker.state.lastError = null;
      this.logEvent({
        at: new Date().toISOString(),
        hcode: worker.hcode,
        type,
        ok: true,
        summary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      worker.state.eventsFailed += 1;
      worker.state.lastError = msg.slice(0, 200);
      this.logEvent({
        at: new Date().toISOString(),
        hcode: worker.hcode,
        type,
        ok: false,
        summary: `${type} event failed`,
        error: msg.slice(0, 200),
      });
    }
  }

  private logEvent(evt: SimulationEventLog): void {
    this.recentEvents.push(evt);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS);
    }
  }
}

function pickEventType(types: SimEventType[]): SimEventType {
  return types[Math.floor(Math.random() * types.length)];
}

// Module-global singleton (server-only). Resets on HMR in dev.
const globalAny = global as unknown as { __simulationOrchestrator?: SimulationOrchestrator };
export const simulationOrchestrator: SimulationOrchestrator =
  globalAny.__simulationOrchestrator ?? new SimulationOrchestrator();
if (!globalAny.__simulationOrchestrator) {
  globalAny.__simulationOrchestrator = simulationOrchestrator;
}
