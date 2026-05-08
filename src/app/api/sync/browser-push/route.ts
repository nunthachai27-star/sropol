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
  processWebhookPayload,
  processAncWebhook,
  processPartographWebhook,
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
  labor?: Omit<WebhookPayload, 'hospitalCode'>;
  anc?: Omit<WebhookAncPayload, 'hospitalCode' | 'type'>;
  partograph?: Omit<WebhookPartographPayload, 'hospitalCode' | 'type'>;
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
      return NextResponse.json(
        { error: 'readonly_session_cannot_push' },
        { status: 403 },
      );
    }
    hcode = session.user.hospitalCode ?? null;
    if (!hcode) {
      return NextResponse.json(
        { error: 'no_hospital_code_in_session' },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const rows = await db.query<{ id: string; is_active: boolean | number }>(
      'SELECT id, is_active FROM hospitals WHERE hcode = ?',
      [hcode],
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'hospital_not_registered', hcode },
        { status: 403 },
      );
    }
    if (rows[0].is_active !== true && rows[0].is_active !== 1) {
      return NextResponse.json(
        { error: 'hospital_inactive', hcode },
        { status: 403 },
      );
    }
    hospitalId = rows[0].id;

    const body = (await request.json().catch(() => null)) as BrowserPushBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    runId = await startSyncRun(hospitalId, hcode, 'browser');

    const sseManager = SseManager.getInstance();
    const result: {
      labor?: { processed: number; newAdmissions: number; discharges: number; transfers: number };
      anc?: { processed: number };
      partograph?: { accepted: number; skipped: number };
    } = {};

    // Labor — main payload, mirrors webhook 'labor' default route.
    if (body.labor && Array.isArray(body.labor.patients)) {
      const patients = body.labor.patients;
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
          {
            hospitalCode: hcode,
            patients,
            mode: body.labor.mode ?? 'incremental',
          },
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
          message: `Upserted ${r.patientsProcessed} labor rows (${r.newAdmissions} new, ${r.discharges} discharges, ${r.transfers} transfers).`,
          counts: {
            processed: r.patientsProcessed,
            newAdmissions: r.newAdmissions,
            discharges: r.discharges,
            transfers: r.transfers,
          },
        });
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

    // ANC.
    if (body.anc && Array.isArray(body.anc.patients)) {
      const patients = body.anc.patients;
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_anc',
        status: 'running',
        message: `Persisting ${patients.length} ANC pregnancies.`,
        counts: { pregnancies: patients.length },
      });
      try {
        const r = await processAncWebhook(
          db,
          hospitalId,
          { type: 'anc_data', hospitalCode: hcode, patients },
          sseManager,
        );
        result.anc = { processed: r.patientsProcessed };
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_anc',
          status: 'success',
          message: `Upserted ${r.patientsProcessed} ANC pregnancies.`,
          counts: { processed: r.patientsProcessed },
        });
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

    // Partograph.
    if (body.partograph && Array.isArray(body.partograph.observations)) {
      const observations = body.partograph.observations;
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
          {
            type: 'partograph',
            hospitalCode: hcode,
            observations,
          },
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

    // Mark hospital ONLINE — browser successfully reached HOSxP and pushed
    // a bundle, so we know the upstream is reachable from somewhere.
    await db.execute(
      "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
      [new Date().toISOString(), hospitalId],
    );

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
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500 },
    );
  }
}
