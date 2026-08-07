// Bounded MOPH alert drain — the ONLY site that performs LINE I/O (codex #1,
// hybrid variant). Invoked as a final step on the live browser-push path.
//
// Atomically CLAIMS pending rows (pending→processing, claimed_at=NOW()) before
// sending, so a concurrent browser-push drain or an admin re-drive cannot
// double-send the same row (codex review P1: duplicate-send race). Stale
// `processing` rows (claimed_at older than 2× the drain budget — a crashed
// mid-send) are recovered to `pending` on entry so they're not stuck.
//
// Re-derives a fresh BMS session (the in-band one may have expired between
// enqueue and drain — codex #6a), sends each via sendMophPrompt within a hard
// budget, and updates the row:
//   - success → status='sent', message_id, api_status, sent_at
//   - 502/timeout (RETRYABLE_EXHAUSTED) → status back to 'pending', attempts++,
//     last_error set (retried on the next drain)
//   - 4xx (CLIENT_ERROR/AUTH/VALIDATION/INVALID_CID) → status='failed' (terminal)
//
// Rebuilds the Flex from the stored hospital_name + decrypted patient_name_enc
// (staff scope only), so hospital staff receive the patient name (codex review
// P1 fix: void-flex loss). NEVER throws to the caller — the sync run must not
// abort because LINE is slow/down. Returns {sent, retryable, failed, skipped}.

import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';
import { sendMophPrompt } from '@/services/moph-prompt';
import { resolveSessionIdForHospital } from '@/lib/bms-session';
import { mophAlertsEnabled, mophAlertLimits } from '@/config/moph-alert-config';
import { decryptSafe } from '@/lib/encryption';
import {
  buildAlertFlex,
  alertTitle,
  type AlertSeverity,
  type AlertRecipientScope,
} from '@/config/moph-alert-templates';

export interface DrainOptions {
  maxAlerts?: number;
  perSendTimeoutMs?: number;
  budgetMs?: number;
}

export interface DrainSummary {
  sent: number;
  retryable: number;
  failed: number;
  skipped: number;
}

interface ClaimedRow {
  id: string;
  case_id: string;
  hospital_id: string;
  origin_hcode: string;
  hospital_name: string | null;
  recipient_cid: string;
  recipient_scope: string;
  alert_source: string;
  severity: string;
  rule_id: string;
  title: string;
  patient_name_enc: string | null;
  confirm_url: string | null;
  attempts: number;
}

const RETRYABLE_CODES = new Set(['RETRYABLE', 'RETRYABLE_EXHAUSTED']);
const TERMINAL_CODES = new Set(['CLIENT_ERROR', 'AUTH', 'VALIDATION', 'INVALID_CID']);

export async function drainMophAlerts(
  db: DatabaseAdapter,
  hospitalId: string,
  opts: DrainOptions = {},
): Promise<DrainSummary> {
  const summary: DrainSummary = { sent: 0, retryable: 0, failed: 0, skipped: 0 };
  if (!mophAlertsEnabled()) {
    logger.debug('moph_alert_drain_skipped_disabled', { hospitalId });
    return summary;
  }
  const limits = mophAlertLimits();
  const maxAlerts = opts.maxAlerts ?? limits.maxAlertsPerDrain;
  const budgetMs = opts.budgetMs ?? limits.drainBudgetMs;

  // Recover stale `processing` rows first — a previous drain crashed mid-send
  // (or its request was aborted) leaving rows claimed but never finalized.
  // 2× budget is a safe "this drain is definitely dead" threshold.
  const staleMs = budgetMs * 2;
  await db.query(
    `UPDATE moph_alert_log
     SET status = 'pending', claimed_at = NULL, updated_at = NOW()
     WHERE hospital_id = $1 AND status = 'processing'
       AND claimed_at IS NOT NULL
       AND claimed_at < NOW() - ($2 || ' milliseconds')::interval`,
    [hospitalId, String(staleMs)],
  );

  // Atomically claim up to maxAlerts pending rows for THIS drain. The
  // UPDATE...RETURNING + status='processing' + claimed_at is the claim: a
  // concurrent drain/admin-re-drive won't see these rows as pending, so no
  // double-send. (PGlite/Postgres both support FOR UPDATE SKIP LOCKED.)
  const claimed = await db.query<ClaimedRow>(
    `UPDATE moph_alert_log
     SET status = 'processing', claimed_at = NOW(), updated_at = NOW()
     WHERE id IN (
       SELECT id FROM moph_alert_log
       WHERE hospital_id = $1 AND status = 'pending'
       ORDER BY created_at
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, case_id, hospital_id, origin_hcode, hospital_name, recipient_cid,
              recipient_scope, alert_source, severity, rule_id, title,
              patient_name_enc, confirm_url, attempts`,
    [hospitalId, maxAlerts],
  );

  // Purge terminal rows older than the retention window so moph_alert_log
  // doesn't grow forever (codex gap-sweep: no retention). Runs even when there
  // are no pending rows to send — retention is independent of delivery. Best-
  // effort, never throws.
  try {
    await purgeOldMophAlerts(db, limits.retentionDays);
  } catch (err) {
    logger.warn('moph_alert_purge_failed', { hospitalId, error: String(err) });
  }

  if (claimed.length === 0) return summary;

  // Re-derive a session once per drain (covers codex #6a session expiry). If it
  // fails, release the claims back to pending with a per-row last_error so
  // operators can see the cause (codex gap-sweep: was silent).
  let sessionId: string;
  try {
    sessionId = await resolveSessionIdForHospital(db, hospitalId);
  } catch (err) {
    logger.warn('moph_alert_drain_no_session', { hospitalId, error: String(err) });
    const msg = `session re-derive failed: ${String((err as Error)?.message ?? err)}`;
    await db.query(
      `UPDATE moph_alert_log
       SET status = 'pending', claimed_at = NULL, attempts = attempts + 1,
           last_error = $1, updated_at = NOW()
       WHERE id::text = ANY($2::text[]) AND status = 'processing'`,
      [msg, claimed.map((r) => r.id)],
    );
    summary.retryable = claimed.length; // all deferred to next drain
    return summary;
  }

  const deadline = Date.now() + budgetMs;
  let sentIdx = 0;
  for (const row of claimed) {
    if (Date.now() >= deadline) {
      // Budget exhausted — release the UN-sent claimed rows back to pending so
      // they're not stuck in processing (codex gap-sweep P1: was just `break`,
      // leaving them for a future drain's stale recovery, which may never run).
      const unsent = claimed.slice(sentIdx).map((r) => r.id);
      await releaseClaimsToPending(db, unsent);
      break;
    }
    sentIdx++;
    await sendOne(db, row, sessionId, summary, limits.max502Retries);
  }
  logger.info('moph_alert_drain_done', { hospitalId, ...summary });
  return summary;
}

/** Delete terminal (sent/failed/skipped) rows older than `retentionDays`.
 *  0 = keep forever. Pending/processing rows are never purged. */
async function purgeOldMophAlerts(db: DatabaseAdapter, retentionDays: number): Promise<void> {
  if (!retentionDays || retentionDays <= 0) return;
  await db.query(
    `DELETE FROM moph_alert_log
     WHERE status IN ('sent', 'failed', 'skipped')
       AND created_at < NOW() - ($1 || ' days')::interval`,
    [String(retentionDays)],
  );
}

/** Release the given row ids back to pending (un-claim). */
async function releaseClaimsToPending(db: DatabaseAdapter, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Cast to text[] comparison — PGlite's param binding doesn't reliably cast
  // $1::uuid[] when the column is uuid, and this works identically on Postgres.
  await db.query(
    `UPDATE moph_alert_log
     SET status = 'pending', claimed_at = NULL, updated_at = NOW()
     WHERE id::text = ANY($1::text[]) AND status = 'processing'`,
    [ids],
  );
}

/** Send one claimed row and finalize its status. Never throws (logs + marks).
 *  Dead-letters a retryable row to `failed` once attempts exceed maxAttempts
 *  (codex gap-sweep: poison retryables otherwise starve newer alerts). */
async function sendOne(
  db: DatabaseAdapter,
  row: ClaimedRow,
  sessionId: string,
  summary: DrainSummary,
  maxAttempts: number,
): Promise<void> {
  try {
    const severity = row.severity as AlertSeverity;
    const scope = row.recipient_scope as AlertRecipientScope;
    // Rebuild the Flex from stored fields. hospital_name is the real name
    // (enqueue persisted it — codex review P2: was origin_hcode). Patient name
    // is decrypted ONLY for hospital_staff scope (PDPA); center stays null.
    const hospitalName = row.hospital_name ?? row.origin_hcode;
    const patientName = scope === 'hospital_staff' ? decryptSafe(row.patient_name_enc) : null;
    const flex = buildAlertFlex({
      severity,
      recipientScope: scope,
      hospitalName,
      caseRef: row.case_id,
      patientName,
      confirmUrl: row.confirm_url ?? null,
    });
    const res = await sendMophPrompt({
      sessionId,
      cid: row.recipient_cid,
      title: row.title,
      text: alertTitle({ severity, hospitalName }),
      flex,
      confirmUrl: row.confirm_url ?? null,
    });
    const apiStatus = res.line.status; // success|failed|skipped
    const finalStatus =
      apiStatus === 'success' ? 'sent' : apiStatus === 'skipped' ? 'skipped' : 'failed';
    await db.query(
      `UPDATE moph_alert_log
       SET status = $1, message_id = $2, api_status = $3, attempts = attempts + 1,
           sent_at = $4, last_error = NULL, claimed_at = NULL, updated_at = NOW()
       WHERE id = $5`,
      [
        finalStatus,
        res.messageId,
        apiStatus,
        finalStatus === 'sent' ? new Date().toISOString() : null,
        row.id,
      ],
    );
    if (finalStatus === 'sent') summary.sent++;
    else if (finalStatus === 'skipped') summary.skipped++;
    else summary.failed++;
  } catch (err) {
    // Duck-type on `.code` rather than `instanceof MophPromptError`: under
    // vi.mock the imported class identity differs from thrown instances, and
    // upstream may reject with a decorated Error regardless. Property-check
    // is resilient to both.
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'UNKNOWN';
    const isRetryable = RETRYABLE_CODES.has(code);
    const nextAttempts = row.attempts + 1;
    // Dead-letter: a retryable row that has exhausted maxAttempts goes to
    // `failed` (terminal) so it can't loop forever and starve newer alerts.
    const status =
      isRetryable && nextAttempts >= maxAttempts
        ? 'failed'
        : isRetryable
          ? 'pending'
          : TERMINAL_CODES.has(code)
            ? 'failed'
            : 'pending';
    await db.query(
      `UPDATE moph_alert_log
       SET status = $1, attempts = attempts + 1, last_error = $2,
           claimed_at = NULL, updated_at = NOW()
       WHERE id = $3`,
      [status, String((err as Error)?.message ?? err), row.id],
    );
    if (status === 'failed') summary.failed++;
    else summary.retryable++;
    logger.warn('moph_alert_send_failed', { id: row.id, code, status, attempts: nextAttempts });
  }
}
