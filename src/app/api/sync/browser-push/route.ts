// POST /api/sync/browser-push — receives a HOSxP data bundle that the
// user's browser pulled directly from 127.0.0.1:45011 and dispatches it
// to the existing webhook processors. NextAuth-gated; the hospital is
// derived from the session, not the body, so a user can only push data
// for their own hospital.
//
// This is the central path now that server-side scheduled polling is
// disabled. Each request records a SyncProgressRun (trigger='browser')
// so admins see browser-driven syncs in the /admin · Sync Status tab
// and the per-hospital Sync Log.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { SseManager } from '@/lib/sse';
import {
  processBrowserNewborns,
  newbornSyncCutoffDate,
  type BrowserNewbornsSection,
} from '@/services/sync/newborn';
import { autoArriveReferrals } from '@/services/referral';
import {
  processBrowserReferouts,
  processBrowserReferins,
  processBrowserVisitEvidences,
  getReferralArrivalProbe,
  type BrowserReferoutRow,
  type BrowserReferinRow,
  type BrowserVisitEvidenceRow,
  type BrowserReferoutsResult,
  type BrowserReferinsResult,
} from '@/services/sync/referrals';
import { enqueueHighRiskAlert } from '@/services/risk-alert';
import { drainMophAlerts } from '@/services/moph-alert-drain';
import { classifyAncItems } from '@/config/anc-classifying-canon';
import { AncRiskLevel } from '@/types/domain';
import {
  processWebhookPayload,
  processAncWebhook,
  processPartographWebhook,
  validatePayload,
  validateAncPayload,
  validatePartographPayload,
  type WebhookPayload,
  type WebhookAncPayload,
  type WebhookPartographPayload,
} from '@/services/webhook';
import {
  startSyncRun,
  appendSyncStep,
  finalizeSyncRun,
  type SyncRunOutcome,
} from '@/services/sync/progress-store';

interface BrowserPushBody {
  /** BMS PasteJSON session id the client pulled under — see readBmsSessionId. */
  bms_session_id?: unknown;
  labor?: Omit<WebhookPayload, 'hospitalCode'>;
  anc?: Omit<WebhookAncPayload, 'hospitalCode' | 'type'>;
  partograph?: Omit<WebhookPartographPayload, 'hospitalCode' | 'type'>;
  /** Raw HOSxP delivery rows (labour infants + ipt_pregnancy summaries)
   *  since the server-issued cutoff — see GET below. */
  newborns?: BrowserNewbornsSection;
  /** Raw HOSxP referral rows: referouts from the origin hospital's gateway,
   *  referins observed at the destination, plus ovst visit evidence for the
   *  server-issued probe CIDs (hospitals that never fill the refer-in form).
   *  Optional and best-effort. */
  referrals?: {
    referouts?: BrowserReferoutRow[];
    referins?: BrowserReferinRow[];
    visitEvidences?: BrowserVisitEvidenceRow[];
  };
}

// Validate the optional client-supplied BMS session id: non-empty string,
// length-capped. It is an infrastructure credential-ish handle (logger.ts
// SENSITIVE_KEYS redacts session ids), so it is stored ONLY in the Redis
// sync-run record (24h TTL) — never emitted through logger — where operators
// read it via the Sync Log / redis-cli to run diagnostic SQL against the
// hospital's HOSxP through the BMS Session API.
const BMS_SESSION_ID_MAX_LEN = 100;
function readBmsSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > BMS_SESSION_ID_MAX_LEN) return null;
  return trimmed;
}

export async function POST(request: NextRequest) {
  const startTs = Date.now();
  let runId: string | null = null;
  let hospitalId: string | null = null;
  let hcode: string | null = null;
  let hadWarning = false;
  try {
    await ensureInit();

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.accessMode === 'readonly') {
      return NextResponse.json({ error: 'readonly_session_cannot_push' }, { status: 403 });
    }
    hcode = session.user.hospitalCode ?? null;
    if (!hcode) {
      return NextResponse.json({ error: 'no_hospital_code_in_session' }, { status: 400 });
    }

    const db = await getDatabase();
    const rows = await db.query<{ id: string; is_active: boolean | number }>(
      'SELECT id, is_active FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'hospital_not_registered', hcode }, { status: 403 });
    }
    if (rows[0].is_active !== true && rows[0].is_active !== 1) {
      return NextResponse.json({ error: 'hospital_inactive', hcode }, { status: 403 });
    }
    hospitalId = rows[0].id;

    const body = (await request.json().catch(() => null)) as BrowserPushBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    runId = await startSyncRun(hospitalId, hcode, 'browser', {
      bmsSessionId: readBmsSessionId(body.bms_session_id),
    });

    const sseManager = SseManager.getInstance();
    const result: {
      labor?: {
        processed: number;
        newAdmissions: number;
        discharges: number;
        transfers: number;
        // Maternal screening ingest counters (Task 7). Present only when the
        // ingest flag is on AND a patient carried a maternal_screening object;
        // surfaced so the browser client and the admin Sync Log can see
        // persisted assessments, idempotent replays, and — critically —
        // dropped/invalid screenings that would otherwise vanish on this
        // browser-only prod path (review IMPORTANT 1).
        maternalScreenAssessments?: number;
        maternalScreenDuplicates?: number;
        maternalScreenIngestErrors?: string[];
      };
      // downgradesBlocked/visitConflicts are the WHO T4/T5 anomaly counters
      // off WebhookAncResult — surfaced here so the browser client (and the
      // admin Sync Log via the persist_anc step below) can see when the
      // ingest pipeline silently protected data integrity. See WHO
      // containment T6.
      anc?: {
        processed: number;
        downgradesBlocked: number;
        visitConflicts: number;
        fieldOverflows: number;
      };
      partograph?: { accepted: number; skipped: number };
      newborns?: { upserted: number; journeys: number; failedAns: number };
      referrals?: {
        referouts: BrowserReferoutsResult;
        referins: BrowserReferinsResult;
        visitEvidences: BrowserReferinsResult;
      };
    } = {};

    // Labor — main payload, mirrors webhook 'labor' default route.
    // Run the same validator that /api/webhooks/patient-data uses so a
    // malformed CID (12-digit truncation, encrypted-blob leftover from a
    // missing marketplace_token) never reaches cached_patients with a
    // junk cidHash that won't match a real patient.
    //
    // Two labor shapes are handled:
    //   1. Has patients to upsert → validate (CID etc.) then process. The
    //      authoritative active set (activeAns) rides along so the server can
    //      reconcile discharges.
    //   2. No patients but an explicit activeAns set → reconcile-only push.
    //      The ward emptied (Occupied=0) or every row was dropped by the name
    //      probe; nothing to upsert, but we must still close out the cached
    //      ACTIVE patients HOSxP no longer returns (Mantis #9505). validatePayload
    //      rejects an empty patients array, so we call the processor directly —
    //      there are no patient fields to validate.
    const laborBody = body.labor;
    const laborPatients =
      laborBody && Array.isArray(laborBody.patients) ? laborBody.patients : null;
    const laborActiveAns =
      laborBody && Array.isArray(laborBody.activeAns) ? laborBody.activeAns : undefined;

    if (laborPatients && laborPatients.length > 0) {
      const laborValidation = validatePayload({
        hospitalCode: hcode,
        patients: laborPatients,
        mode: laborBody?.mode ?? 'incremental',
        ...(laborActiveAns !== undefined ? { activeAns: laborActiveAns } : {}),
      });
      if (!laborValidation.valid || !laborValidation.payload) {
        hadWarning = true;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_labor',
          status: 'error',
          message: 'Labor payload failed validation; not persisted.',
          detail: laborValidation.error ?? 'unknown validation error',
        });
      } else {
        const patients = laborValidation.payload.patients;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_labor',
          status: 'running',
          message: `Persisting ${patients.length} active labor rows.`,
          counts: { rows: patients.length },
        });
        try {
          const r = await processWebhookPayload(
            db,
            hospitalId,
            laborValidation.payload,
            sseManager,
          );
          // Forward the maternal-screening counters (present only when the
          // ingest flag is on AND a screening rode along) so they are not
          // silently dropped on this browser-only prod path (review IMPORTANT 1a).
          // result.labor keeps the full PHI-free error strings; the Sync Log
          // `counts` map is numeric-only, so it carries an error COUNT.
          const hasScreening = r.maternalScreenAssessments !== undefined;
          const screenErrorCount = r.maternalScreenIngestErrors?.length ?? 0;
          result.labor = {
            processed: r.patientsProcessed,
            newAdmissions: r.newAdmissions,
            discharges: r.discharges,
            transfers: r.transfers,
            ...(hasScreening
              ? {
                  maternalScreenAssessments: r.maternalScreenAssessments,
                  maternalScreenDuplicates: r.maternalScreenDuplicates,
                  maternalScreenIngestErrors: r.maternalScreenIngestErrors,
                }
              : {}),
          };
          await appendSyncStep(hospitalId, runId, {
            name: 'persist_labor',
            status: screenErrorCount > 0 ? 'warning' : 'success',
            message: `Upserted ${r.patientsProcessed} labor rows (${r.newAdmissions} new, ${r.discharges} discharges, ${r.transfers} transfers)${
              hasScreening
                ? `; maternal screening: ${r.maternalScreenAssessments} saved, ${r.maternalScreenDuplicates ?? 0} duplicate, ${screenErrorCount} error(s)`
                : ''
            }.`,
            counts: {
              processed: r.patientsProcessed,
              newAdmissions: r.newAdmissions,
              discharges: r.discharges,
              transfers: r.transfers,
              ...(hasScreening
                ? {
                    maternalScreenAssessments: r.maternalScreenAssessments ?? 0,
                    maternalScreenDuplicates: r.maternalScreenDuplicates ?? 0,
                    maternalScreenErrors: screenErrorCount,
                  }
                : {}),
            },
          });
          if (screenErrorCount > 0) hadWarning = true;
        } catch (e) {
          hadWarning = true;
          await appendSyncStep(hospitalId, runId, {
            name: 'persist_labor',
            status: 'error',
            message: 'Labor persist failed.',
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else if (laborActiveAns !== undefined) {
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_labor',
        status: 'running',
        message: `Reconciling active labor set (${laborActiveAns.length} active, 0 to upsert).`,
        counts: { active: laborActiveAns.length },
      });
      try {
        const r = await processWebhookPayload(
          db,
          hospitalId,
          { hospitalCode: hcode, patients: [], activeAns: laborActiveAns },
          sseManager,
        );
        result.labor = {
          processed: r.patientsProcessed,
          newAdmissions: r.newAdmissions,
          discharges: r.discharges,
          transfers: r.transfers,
        };
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_labor',
          status: 'success',
          message: `Closed out ${r.discharges} patient(s) no longer active in HOSxP.`,
          counts: { discharges: r.discharges },
        });
      } catch (e) {
        hadWarning = true;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_labor',
          status: 'error',
          message: 'Labor reconcile failed.',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ANC. Same validator as /api/webhooks/patient-data — rejects bundles
    // with malformed CIDs / missing pregNo / etc. before processAncWebhook
    // creates phantom maternal_journeys.
    const ancValidation =
      body.anc && Array.isArray(body.anc.patients)
        ? validateAncPayload({ type: 'anc_data', hospitalCode: hcode, patients: body.anc.patients })
        : null;
    if (ancValidation && (!ancValidation.valid || !ancValidation.payload)) {
      hadWarning = true;
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_anc',
        status: 'error',
        message: 'ANC payload failed validation; not persisted.',
        detail: ancValidation.error ?? 'unknown validation error',
      });
    }
    if (ancValidation?.valid && ancValidation.payload) {
      const patients = ancValidation.payload.patients;
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_anc',
        status: 'running',
        message: `Persisting ${patients.length} ANC pregnancies.`,
        counts: { pregnancies: patients.length },
      });
      try {
        const r = await processAncWebhook(db, hospitalId, ancValidation.payload, sseManager);
        result.anc = {
          processed: r.patientsProcessed,
          downgradesBlocked: r.downgradesBlocked,
          visitConflicts: r.visitConflicts,
          fieldOverflows: r.fieldOverflows,
        };
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_anc',
          status: 'success',
          message: `Upserted ${r.patientsProcessed} ANC pregnancies.`,
          counts: {
            processed: r.patientsProcessed,
            downgradesBlocked: r.downgradesBlocked,
            visitConflicts: r.visitConflicts,
            fieldOverflows: r.fieldOverflows,
          },
        });
        // WHO containment T6 — non-zero means the ingest pipeline silently
        // protected data integrity (blocked a downgrade on missing evidence,
        // skipped a cross-hospital visit conflict, or dropped an over-width
        // sender field). An operator should know without having to dig
        // through the Sync Log.
        if (r.downgradesBlocked > 0 || r.visitConflicts > 0 || r.fieldOverflows > 0) {
          logger.warn('anc_ingest_anomalies', {
            hospitalId,
            downgradesBlocked: r.downgradesBlocked,
            visitConflicts: r.visitConflicts,
            fieldOverflows: r.fieldOverflows,
          });
        }

        // MOPH Prompt HIGH-risk alert enqueue (codex #2 HIGH producer). For
        // each ANC patient the server classifies as HR3 (top tier), enqueue a
        // pending moph_alert_log row — no LINE I/O here; the drain step below
        // sends. Best-effort: a failure never aborts the sync run.
        try {
          const hosp = await db.query<{ name: string; province_code: string | null }>(
            'SELECT name, province_code FROM hospitals WHERE id = ?',
            [hospitalId],
          );
          const hospitalName = hosp[0]?.name ?? hcode;
          const province = hosp[0]?.province_code ?? '';
          const localDate = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Bangkok',
          });
          let enqueued = 0;
          for (const p of patients) {
            // Trust the server-side canon classifier, not the client-declared
            // riskLevel — a client can claim HR3 without the item evidence.
            const classified = classifyAncItems(p.riskItemIds ?? []);
            if (classified.level !== AncRiskLevel.HR3) continue;
            const n = await enqueueHighRiskAlert(db, {
              hospitalId,
              originHcode: hcode,
              hospitalName,
              province,
              caseRef: `ANC-${p.cid}-G${p.pregNo}`,
              localDate,
              patientName: p.name,
              confirmUrl: null,
            });
            enqueued += n;
          }
          if (enqueued > 0) {
            await appendSyncStep(hospitalId, runId, {
              name: 'moph_alerts_enqueue',
              status: 'success',
              message: `Enqueued ${enqueued} HIGH-risk (HR3) MOPH alert(s) for drain.`,
              counts: { enqueued },
            });
          }
        } catch (e) {
          // Alerting is best-effort — never let it break the sync run.
          logger.warn('moph_alert_enqueue_failed', { hospitalId, error: e });
        }
      } catch (e) {
        hadWarning = true;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_anc',
          status: 'warning',
          message: 'ANC persist failed (continuing with labor + partograph).',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Partograph. Same validator the Pascal-driven route uses.
    const partographValidation =
      body.partograph && Array.isArray(body.partograph.observations)
        ? validatePartographPayload({
            type: 'partograph',
            hospitalCode: hcode,
            observations: body.partograph.observations,
          })
        : null;
    if (partographValidation && (!partographValidation.valid || !partographValidation.payload)) {
      hadWarning = true;
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_partograph',
        status: 'error',
        message: 'Partograph payload failed validation; not persisted.',
        detail: partographValidation.error ?? 'unknown validation error',
      });
    }
    if (partographValidation?.valid && partographValidation.payload) {
      const observations = partographValidation.payload.observations;
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_partograph',
        status: 'running',
        message: `Persisting ${observations.length} partograph observations.`,
        counts: { observations: observations.length },
      });
      try {
        const r = await processPartographWebhook(
          db,
          hospitalId,
          partographValidation.payload,
          sseManager,
        );
        result.partograph = {
          accepted: r.observationsAccepted,
          skipped: r.observationsSkipped.length,
        };
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_partograph',
          status: 'success',
          message: `Upserted ${r.observationsAccepted} observations (${r.observationsSkipped.length} skipped).`,
          counts: {
            accepted: r.observationsAccepted,
            skipped: r.observationsSkipped.length,
          },
        });
      } catch (e) {
        hadWarning = true;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_partograph',
          status: 'warning',
          message: 'Partograph persist failed.',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Newborn outcomes — raw labour-infant + ipt_pregnancy rows since the
    // cutoff this route's GET handed out. Both processors are idempotent
    // ((journey_id, infant_number) upsert key), so overlap is safe.
    if (body.newborns && typeof body.newborns === 'object') {
      const infantsCount = Array.isArray(body.newborns.infants) ? body.newborns.infants.length : 0;
      const pregCount = Array.isArray(body.newborns.pregnancies)
        ? body.newborns.pregnancies.length
        : 0;
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_newborns',
        status: 'running',
        message: `Persisting newborn outcomes (${infantsCount} infant rows, ${pregCount} delivery summaries).`,
        counts: { infants: infantsCount, pregnancies: pregCount },
      });
      try {
        const r = await processBrowserNewborns(db, hospitalId, body.newborns);
        const upserted = r.infants.upserted + r.fallback.upserted;
        const journeys = r.infants.journeys + r.fallback.journeys;
        const failedAns = r.infants.failedAns + r.fallback.failedAns;
        result.newborns = { upserted, journeys, failedAns };
        // Same event name the polling path used — dashboards/log greps keep working.
        logger.info('newborn_sync_cycle', {
          hospitalId,
          source: 'browser',
          rows: r.infants.rowsRead,
          upserted: r.infants.upserted,
          journeys: r.infants.journeys,
          skippedNoJourney: r.infants.skippedNoJourney,
          createdJourneys: r.infants.createdJourneys + r.fallback.createdJourneys,
          failedAns,
          infantsPassError: r.infantsError ?? null,
          fallbackRows: r.fallback.rowsRead,
          fallbackUpserted: r.fallback.upserted,
          fallbackJourneys: r.fallback.journeys,
          fallbackSkippedHasDetail: r.fallback.skippedHasDetail,
        });
        // Degraded-but-continuing outcomes must be visible in the Sync Log
        // (frozen-cutoff incident: silent failure hid a year of data loss).
        const degraded = failedAns > 0 || r.infantsError !== undefined;
        if (degraded) hadWarning = true;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_newborns',
          status: degraded ? 'warning' : 'success',
          message: `Upserted ${upserted} newborns across ${journeys} journeys (${r.infants.skippedNoJourney + r.fallback.skippedNoJourney} ANs without a journey${
            failedAns > 0 ? `; ${failedAns} AN(s) failed and were isolated` : ''
          }${r.infantsError ? `; infants pass failed: ${r.infantsError}` : ''}).`,
          counts: { upserted, journeys, failedAns },
        });
      } catch (e) {
        hadWarning = true;
        const msg = e instanceof Error ? e.message : String(e);
        // Mirror persist_anc: the warning must be diagnosable from the Sync
        // Log alone — error text (PHI-free primary message) + payload counts,
        // not a bare 'failed'.
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_newborns',
          status: 'warning',
          message: `Newborn persist failed (continuing): ${msg.slice(0, 120)} — payload had ${infantsCount} infant rows, ${pregCount} delivery summaries.`,
          counts: { infants: infantsCount, pregnancies: pregCount },
          detail: msg,
        });
      }
    }

    // Referral gateway sync — referouts (origin side) + referins (destination
    // side). Best-effort: a referral failure never blocks the main push. Runs
    // BEFORE autoArriveReferrals below so rows ingested this cycle are visible
    // to the same cycle's reconciliation.
    if (body.referrals && typeof body.referrals === 'object') {
      const referouts = Array.isArray(body.referrals.referouts) ? body.referrals.referouts : [];
      const referins = Array.isArray(body.referrals.referins) ? body.referrals.referins : [];
      const visitEvidences = Array.isArray(body.referrals.visitEvidences)
        ? body.referrals.visitEvidences
        : [];
      try {
        const referoutResult = await processBrowserReferouts(db, hospitalId, referouts);
        const referinResult = await processBrowserReferins(db, hospitalId, referins);
        const visitResult = await processBrowserVisitEvidences(db, hospitalId, visitEvidences);
        result.referrals = {
          referouts: referoutResult,
          referins: referinResult,
          visitEvidences: visitResult,
        };
        const arrivedTotal = referinResult.arrived + visitResult.arrived;
        if (referoutResult.created + referoutResult.upserted > 0 || arrivedTotal > 0) {
          await appendSyncStep(hospitalId, runId, {
            name: 'persist_referrals',
            status: 'success',
            message: `Referrals: ${referoutResult.created} new, ${referoutResult.upserted} refreshed, ${arrivedTotal} arrived (${visitResult.arrived} via visit evidence).`,
            counts: {
              referoutsRead: referoutResult.rowsRead,
              created: referoutResult.created,
              upserted: referoutResult.upserted,
              skippedNoJourney: referoutResult.skippedNoJourney,
              referinsRead: referinResult.rowsRead,
              visitEvidencesRead: visitResult.rowsRead,
              arrived: arrivedTotal,
            },
          });
        }
      } catch (e) {
        hadWarning = true;
        const msg = e instanceof Error ? e.message : String(e);
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_referrals',
          status: 'warning',
          message: `Referral persist failed (continuing): ${msg.slice(0, 120)} — payload had ${referouts.length} referout rows, ${referins.length} referin rows, ${visitEvidences.length} visit evidences.`,
          counts: {
            referouts: referouts.length,
            referins: referins.length,
            visitEvidences: visitEvidences.length,
          },
          detail: msg,
        });
      }
    }

    // Referral auto-arrive reconciliation — previously lived only in the
    // disabled polling cycle, so it never ran in production. Cheap query;
    // never blocks the push.
    try {
      const arrived = await autoArriveReferrals(db);
      if (arrived > 0) {
        logger.info('auto_arrive_referrals', { hospitalId, arrived, source: 'browser' });
        await appendSyncStep(hospitalId, runId, {
          name: 'auto_arrive_referrals',
          status: 'success',
          message: `Auto-arrived ${arrived} referral(s) with journey evidence at the destination.`,
          counts: { arrived },
        });
      }
    } catch (e) {
      logger.warn('auto_arrive_referrals_failed', { hospitalId, error: e });
    }

    // Mark hospital ONLINE — browser successfully reached HOSxP and pushed
    // a bundle, so we know the upstream is reachable from somewhere.
    await db.execute(
      "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
      [new Date().toISOString(), hospitalId],
    );

    // MOPH Prompt alert drain (codex #1 hybrid) — the ONLY LINE I/O site, run
    // as a bounded final step on this live browser-push path. Sends pending
    // alert rows for this hospital within a hard budget. Best-effort: failures
    // are logged and the sync run still succeeds (pending rows retry next push).
    try {
      await appendSyncStep(hospitalId, runId, {
        name: 'moph_alerts_drain',
        status: 'running',
        message: 'Draining pending MOPH alerts (bounded).',
      });
      const summary = await drainMophAlerts(db, hospitalId);
      await appendSyncStep(hospitalId, runId, {
        name: 'moph_alerts_drain',
        status: 'success',
        message: `Drained MOPH alerts: ${summary.sent} sent, ${summary.retryable} deferred, ${summary.failed} failed, ${summary.skipped} skipped.`,
        counts: {
          sent: summary.sent,
          retryable: summary.retryable,
          failed: summary.failed,
          skipped: summary.skipped,
        },
      });
    } catch (e) {
      // Drain failure must never abort the sync run — pending rows retry next push.
      logger.warn('moph_alert_drain_step_failed', { hospitalId, error: e });
      await appendSyncStep(hospitalId, runId, {
        name: 'moph_alerts_drain',
        status: 'warning',
        message: 'MOPH alert drain step errored (pending alerts will retry next sync).',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    const outcome: SyncRunOutcome = hadWarning ? 'partial' : 'success';
    void finalizeSyncRun(
      hospitalId,
      runId,
      outcome,
      hadWarning ? 'Sync เสร็จแต่บางขั้นตอนเตือน' : 'Sync เสร็จสมบูรณ์',
      null,
    );

    return NextResponse.json({
      success: true,
      hcode,
      durationMs: Date.now() - startTs,
      ...result,
    });
  } catch (error) {
    logger.error('browser_push_failed', { hcode, hospitalId, error });
    if (hospitalId && runId) {
      void finalizeSyncRun(
        hospitalId,
        runId,
        'failed',
        'Browser push failed',
        error instanceof Error ? error.message : String(error),
      );
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

// GET — sync bootstrap for the browser client: the self-healing newborn
// cutoff (MAX(born_at) − 2d, or a 365-day backfill window when the hospital
// has no cached newborns yet). The client inlines it into the two delivery
// queries it runs against the local gateway.
export async function GET() {
  try {
    await ensureInit();
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const hcode = session.user.hospitalCode ?? null;
    if (!hcode) {
      return NextResponse.json({ error: 'no_hospital_code_in_session' }, { status: 400 });
    }
    const db = await getDatabase();
    const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [
      hcode,
    ]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'hospital_not_registered', hcode }, { status: 403 });
    }
    const newbornCutoff = await newbornSyncCutoffDate(db, rows[0].id);
    // ovst arrival-probe CIDs are a care-communication disclosure to the
    // legitimate destination only: readwrite session of that same hospital.
    // (GET is also used by readonly viewers for the cutoff — never hand them
    // patient identifiers.)
    let referralArrivalProbe: Awaited<ReturnType<typeof getReferralArrivalProbe>> = [];
    if (session.user.accessMode !== 'readonly') {
      try {
        referralArrivalProbe = await getReferralArrivalProbe(db, rows[0].id);
      } catch (e) {
        logger.warn('referral_arrival_probe_failed', { hcode, error: String(e) });
      }
    }
    return NextResponse.json({ newbornCutoff, referralArrivalProbe });
  } catch (error) {
    logger.error('browser_push_bootstrap_failed', { error });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
