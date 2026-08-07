// Risk-alert enqueue orchestrator (codex #2: one orchestrator, two producers).
//
// HIGH (ANC HR3 item-based) and EMERGENCY (maternal labor-triage) producers
// both call `enqueueAlertEvent()` with a normalized event. The orchestrator:
//   1. resolves recipients — active hospital_consult_doctors (hospital_staff)
//      + active moph_center_monitors for the province (province_center);
//   2. writes a status='pending' moph_alert_log row per recipient, persisting
//      hospital_name + the ENCRYPTED patient name (staff-scope only — PDPA:
//      center rows get NULL patient_name_enc). The drain rebuilds the Flex
//      from these stored fields, so no Flex is built/discarded here (codex
//      review P1 fix: the old `void flex` built a staff Flex then threw it
//      away, so staff never received the patient name);
//   3. ON CONFLICT DO NOTHING on the dedup unique index (codex #5) so a repeat
//      enqueue for the same (case,recipient,source,severity,rule,day) is a no-op.
//
// NO LINE I/O happens here — the drain (moph-alert-drain.ts) is the only site
// that calls sendMophPrompt. This keeps the sync path cheap and fail-safe.

import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';
import { encrypt, getEncryptionKey } from '@/lib/encryption';
import { mophAlertsEnabled } from '@/config/moph-alert-config';
import { isValidCid } from '@/services/moph-prompt';
import { enabledSubscriberCids } from '@/services/notification-preference';
import {
  alertTitle,
  type AlertSeverity,
  type AlertRecipientScope,
} from '@/config/moph-alert-templates';

export interface AlertEventContext {
  hospitalId: string;
  originHcode: string;
  hospitalName: string;
  /** Province code (e.g. '30' Khon Kaen) — for center-monitor resolution. */
  province: string;
  /** Case/journey reference shown in the message. */
  caseRef: string;
  /** 'YYYY-MM-DD' Asia/Bangkok calendar date — part of the dedup key. */
  localDate: string;
  /** Patient name — encrypted at rest for hospital_staff scope; never stored
   *  for province_center (PDPA). */
  patientName?: string | null;
  /** Optional action-button URL. */
  confirmUrl?: string | null;
}

// NOTE: there is deliberately NO `score` field here. The HIGH trigger is ANC
// AncRiskLevel.HR3 (item-based via classifyAncItems), not a CPD numeric score.
// The old `score: number` was vestigial CPD vocabulary (codex review P1/P2:
// HR3/CPD semantic drift) and is removed. The caller gates on HR3, not score.

export interface EmergencyEventContext extends AlertEventContext {
  /** Maternal-triage acuity Thai label (e.g. 'ฉุกเฉิน'). */
  acuityLabel: string;
  /** Specific EMERGENCY_ACUITY rule id — part of the dedup key so distinct
   *  emergencies on one case co-fire (codex #5). */
  ruleId: string;
}

interface Recipient {
  cid: string;
  name: string;
  scope: AlertRecipientScope;
}

// HR3/item-based HIGH-risk vocabulary (codex review P1/P2: was anc_cpd/cpd_high,
// misleading because the trigger is ANC HR3, not a CPD score).
const HIGH_RULE_ID = 'hr3';
const HIGH_ALERT_SOURCE = 'anc_hr3';
const EMERGENCY_ALERT_SOURCE = 'maternal_triage';

/** Resolve active recipients for a hospital + province.
 *  P1-C contract (codex gap-sweep):
 *   - CENTER monitors (admin-configured via MophAlertsTab) ALWAYS deliver — no
 *     self-subscribe gate; the admin list is the authoritative "main setting".
 *   - Default OFF: hospital staff (consult doctors) deliver ONLY when they have
 *     an enabled notification_preferences row for this hospital.
 *   - Authoritative self-subscribers: enabled pref rows NOT on any admin list
 *     are merged (deduped by CID).
 *  Filters out any recipient whose CID is not exactly 13 digits (the MOPH API
 *  would 400 at drain time, wasting a claim — codex gap-sweep: validate at
 *  enqueue instead). */
async function resolveRecipients(
  db: DatabaseAdapter,
  hospitalId: string,
  province: string,
  hospitalCodeOverride?: string,
): Promise<Recipient[]> {
  // hospital_code for the preference gate — resolve from hospitalId if not given.
  let hospitalCode = hospitalCodeOverride ?? '';
  if (!hospitalCode) {
    const h = await db.query<{ hcode: string }>(`SELECT hcode FROM hospitals WHERE id = ?`, [
      hospitalId,
    ]);
    hospitalCode = h[0]?.hcode ?? '';
  }
  const staff = await db.query<{ cid: string; name: string }>(
    `SELECT cid, name FROM hospital_consult_doctors
     WHERE hospital_id = ? AND is_active = true`,
    [hospitalId],
  );
  const center =
    province && province.trim()
      ? await db.query<{ cid: string; name: string }>(
          `SELECT cid, name FROM moph_center_monitors
           WHERE province = ? AND is_active = true`,
          [province],
        )
      : [];
  if (!province || !province.trim()) {
    // Empty province silently skips center monitors — surface it so the
    // hospital's province_code gets fixed (codex gap-sweep edge case).
    logger.warn('moph_alert_empty_province', { hospitalId });
  }
  // P1-C security/correctness (codex gap-sweep): CENTER monitors are an
  // admin-configured role (MophAlertsTab is the authoritative "main setting"
  // for province monitoring) — they ALWAYS deliver, no self-subscribe gate.
  const enabled = new Set((await enabledSubscriberCids(db, hospitalCode)).map((r) => r.cid));
  const allowed: Recipient[] = [];
  for (const c of center) {
    allowed.push({ cid: c.cid, name: c.name, scope: 'province_center' as const });
  }
  // Default OFF: hospital staff (consult doctors) deliver ONLY with an enabled
  // pref row (self-serve opt-in).
  for (const s of staff) {
    if (enabled.has(s.cid)) {
      allowed.push({ cid: s.cid, name: s.name, scope: 'hospital_staff' as const });
    }
  }
  // Authoritative self-subscribers: enabled pref rows for CIDs not already
  // delivered above (neither staff nor center) — deduped by CID.
  const already = new Set(allowed.map((r) => r.cid));
  for (const cid of enabled) {
    if (!already.has(cid)) {
      allowed.push({ cid, name: '', scope: 'self_subscribed' as const });
    }
  }

  const valid = allowed.filter((r) => isValidCid(r.cid));
  if (valid.length !== allowed.length) {
    logger.warn('moph_alert_invalid_recipient_cid_skipped', {
      hospitalId,
      skipped: allowed.length - valid.length,
    });
  }
  return valid;
}

/**
 * Insert one pending alert row per recipient, conflict-skipping on the dedup
 * unique index. Returns the number of rows actually inserted (0 = all dupes).
 * Persists hospital_name + encrypted patient name (staff-scope only) so the
 * drain can rebuild a correct, scope-aware Flex without re-fetching patient data.
 */
async function enqueueAlertEvent(
  db: DatabaseAdapter,
  ctx: AlertEventContext,
  severity: AlertSeverity,
  alertSource: string,
  ruleId: string,
): Promise<number> {
  if (!mophAlertsEnabled()) {
    logger.debug('moph_alert_skipped_disabled', { caseRef: ctx.caseRef });
    return 0;
  }
  const recipients = await resolveRecipients(db, ctx.hospitalId, ctx.province);
  if (recipients.length === 0) {
    logger.warn('moph_alert_no_recipients', { hospitalId: ctx.hospitalId, caseRef: ctx.caseRef });
    return 0;
  }

  const title = alertTitle({ severity, hospitalName: ctx.hospitalName });
  // Encrypt the patient name ONCE per enqueue (staff scope only). Center rows
  // store NULL — they must never carry patient PII at rest or in the message.
  const key = getEncryptionKey();
  if (ctx.patientName && !key) {
    // Fail loud: a missing ENCRYPTION_KEY silently drops the staff patient name
    // (codex gap-sweep). This is a misconfiguration, not a normal path.
    logger.error('moph_alert_encryption_key_missing', { hospitalId: ctx.hospitalId });
  }
  const patientNameEnc = ctx.patientName && key ? encrypt(ctx.patientName, key) : null;

  let inserted = 0;
  for (const r of recipients) {
    const isStaff = r.scope === 'hospital_staff';
    // ON CONFLICT DO NOTHING on the dedup unique index — repeat enqueues are
    // idempotent (codex #5).
    const result = await db.query<{ c: number }>(
      `INSERT INTO moph_alert_log
         (id, case_id, hospital_id, origin_hcode, hospital_name, recipient_cid,
          recipient_scope, alert_source, severity, rule_id, title,
          patient_name_enc, status, attempts, local_date, confirm_url,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',0,$13,$14,NOW(),NOW())
       ON CONFLICT (case_id, hospital_id, recipient_cid, alert_source, severity, rule_id, local_date)
       DO NOTHING
       RETURNING 1::int as c`,
      [
        randomUuid(),
        ctx.caseRef,
        ctx.hospitalId,
        ctx.originHcode,
        ctx.hospitalName,
        r.cid,
        r.scope,
        alertSource,
        severity,
        ruleId,
        title,
        isStaff ? patientNameEnc : null, // PDPA: center rows never store the name
        ctx.localDate,
        ctx.confirmUrl ?? null,
      ],
    );
    if (result.length > 0) inserted++;
  }
  logger.info('moph_alert_enqueued', {
    caseRef: ctx.caseRef,
    severity,
    alertSource,
    ruleId,
    recipients: inserted,
  });
  return inserted;
}

/**
 * HIGH-risk (ANC HR3) producer. Caller MUST have already gated on
 * classifyAncItems(riskItemIds).level === AncRiskLevel.HR3.
 */
export async function enqueueHighRiskAlert(
  db: DatabaseAdapter,
  ctx: AlertEventContext,
): Promise<number> {
  return enqueueAlertEvent(db, ctx, 'high', HIGH_ALERT_SOURCE, HIGH_RULE_ID);
}

/** EMERGENCY (maternal labor-triage acuity) producer. */
export async function enqueueEmergencyAlert(
  db: DatabaseAdapter,
  ctx: EmergencyEventContext,
): Promise<number> {
  return enqueueAlertEvent(db, ctx, 'emergency', EMERGENCY_ALERT_SOURCE, ctx.ruleId);
}

// crypto.randomUUID is available in Node 20+; isolated here so tests/dev can
// stub if ever needed. Not using node:crypto import to keep the service
// Edge-runtime-friendly (browser-push route may run on Edge).
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    const v = c === 'x' ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}
