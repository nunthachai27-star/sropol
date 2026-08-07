// GET  /api/admin/moph-alerts        — list recent MOPH alert log rows (ops view)
// POST /api/admin/moph-alerts        — manually re-drive pending alerts for a hospital
//
// Admin-gated via requireAdmin(). The drain itself is bounded + best-effort
// (never throws); this route lets an operator force a drain outside the
// browser-push cycle (e.g. after a LINE outage that left rows pending).
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { drainMophAlerts } from '@/services/moph-alert-drain';
import { mophAlertLimits } from '@/config/moph-alert-config';
import { logger } from '@/lib/logger';

interface AlertLogRow {
  id: string;
  case_id: string;
  hospital_id: string;
  recipient_cid: string;
  recipient_scope: string;
  alert_source: string;
  severity: string;
  rule_id: string;
  status: string;
  message_id: string | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  try {
    await ensureInit();
    const db = await getDatabase();
    const url = new URL(request.url);
    const hospitalId = url.searchParams.get('hospital_id');
    const status = url.searchParams.get('status');
    // Finite-integer clamp 1..500 — guards NaN (?limit=abc), negatives, zero,
    // and huge values so a malformed query can't reach SQL LIMIT and 500.
    const rawLimit = Number(url.searchParams.get('limit') ?? '100');
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.trunc(rawLimit), 500) : 100;

    const where: string[] = [];
    const params: unknown[] = [];
    if (hospitalId) {
      params.push(hospitalId);
      where.push(`hospital_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const rows = await db.query<AlertLogRow>(
      `SELECT id, case_id, hospital_id, recipient_cid, recipient_scope, alert_source,
              severity, rule_id, status, message_id, attempts, last_error, sent_at, created_at
       FROM moph_alert_log
       ${clause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    // PDPA: mask recipient CID (show last 4) in the ops view — operators see
    // delivery status without full national IDs. Mask ANY length (codex gap-
    // sweep: the 13-digit-only branch exposed malformed CIDs raw).
    const masked = rows.map((r) => ({
      ...r,
      recipient_cid: r.recipient_cid.length >= 4 ? `********${r.recipient_cid.slice(-4)}` : '****',
    }));
    return NextResponse.json({ alerts: masked, count: masked.length });
  } catch (error) {
    logger.error('admin_moph_alerts_list_failed', { error });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  try {
    await ensureInit();
    const db = await getDatabase();
    const body = (await request.json().catch(() => null)) as { hospitalId?: unknown } | null;
    const hospitalId =
      typeof body?.hospitalId === 'string' && body.hospitalId.trim()
        ? body.hospitalId.trim()
        : null;
    if (!hospitalId) {
      return NextResponse.json({ error: 'hospitalId required' }, { status: 400 });
    }
    const limits = mophAlertLimits();
    const summary = await drainMophAlerts(db, hospitalId, {
      maxAlerts: limits.maxAlertsPerDrain,
      perSendTimeoutMs: limits.perSendTimeoutMs,
      budgetMs: limits.drainBudgetMs,
    });
    return NextResponse.json({ success: true, hospitalId, drain: summary });
  } catch (error) {
    logger.error('admin_moph_alerts_redrive_failed', { error });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
