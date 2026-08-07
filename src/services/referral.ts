// Referral workflow service — state machine for inter-hospital referrals
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { ReferralStatus, UrgencyLevel } from '@/types/domain';
import type { CachedReferral } from '@/types/domain';
import { REFERRAL_AUTO_ARRIVE } from '@/config/referral-sla';
import { logAccess } from '@/services/audit';
import type { AuditActor } from '@/lib/audit-actor';

export class ReferralAccessError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN',
    message: string,
  ) {
    super(message);
    this.name = 'ReferralAccessError';
  }
}

/** Throws unless `hospitalId` is the referral's `side` party. */
export async function assertReferralParty(
  db: DatabaseAdapter,
  referralId: string,
  hospitalId: string,
  side: 'from' | 'to',
): Promise<void> {
  const rows = await db.query<{ from_hospital_id: string; to_hospital_id: string }>(
    'SELECT from_hospital_id, to_hospital_id FROM cached_referrals WHERE id = ?',
    [referralId],
  );
  if (rows.length === 0) {
    throw new ReferralAccessError('NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ');
  }
  const expected = side === 'from' ? rows[0].from_hospital_id : rows[0].to_hospital_id;
  if (expected !== hospitalId) {
    throw new ReferralAccessError('FORBIDDEN', 'โรงพยาบาลของคุณไม่มีสิทธิ์ดำเนินการกับใบส่งต่อนี้');
  }
}

export interface InitiateReferralInput {
  journeyId: string;
  fromHospitalId: string;
  toHospitalId: string;
  reason: string;
  diagnosisCode?: string;
  urgencyLevel: UrgencyLevel;
  initiatedBy?: string;
}

export async function initiateReferral(
  db: DatabaseAdapter,
  input: InitiateReferralInput,
): Promise<CachedReferral> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, diagnosis_code, urgency_level, initiated_at, initiated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.journeyId,
      input.fromHospitalId,
      input.toHospitalId,
      ReferralStatus.INITIATED,
      input.reason,
      input.diagnosisCode ?? null,
      input.urgencyLevel,
      now,
      input.initiatedBy ?? null,
      now,
      now,
    ],
  );

  return getReferralById(db, id);
}

export class ReferralConflictError extends Error {
  constructor(
    public readonly currentStatus: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReferralConflictError';
  }
}

/** After a lost compare-and-set: idempotent success if the target status is
 *  already committed, NOT_FOUND if the row vanished, else a 409 conflict. */
async function resolveLostTransition(
  db: DatabaseAdapter,
  referralId: string,
  idempotentStatus: ReferralStatus,
  expected: ReferralStatus,
): Promise<CachedReferral> {
  const rows = await db.query<{ status: string }>(
    'SELECT status FROM cached_referrals WHERE id = ?',
    [referralId],
  );
  if (rows.length === 0) {
    throw new ReferralAccessError('NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ');
  }
  if (rows[0].status === idempotentStatus) {
    return getReferralById(db, referralId);
  }
  throw new ReferralConflictError(
    rows[0].status,
    `ไม่สามารถดำเนินการได้: สถานะปัจจุบัน "${rows[0].status}" ต้องเป็น "${expected}"`,
  );
}

export async function acceptReferral(
  db: DatabaseAdapter,
  referralId: string,
  acceptedBy: string,
  audit?: AuditActor,
): Promise<CachedReferral> {
  return db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const won = await tx.query<{ id: string }>(
      `UPDATE cached_referrals SET status = ?, accepted_at = ?, accepted_by = ?, updated_at = ?
        WHERE id = ? AND status = ? RETURNING id`,
      [ReferralStatus.ACCEPTED, now, acceptedBy, now, referralId, ReferralStatus.INITIATED],
    );
    if (won.length === 0) {
      return resolveLostTransition(
        tx,
        referralId,
        ReferralStatus.ACCEPTED,
        ReferralStatus.INITIATED,
      );
    }
    if (audit?.userId) {
      await logAccess(tx, {
        ...audit,
        action: 'referral_accept',
        resourceType: 'referral',
        resourceId: referralId,
      });
    }
    return getReferralById(tx, referralId);
  });
}

export async function rejectReferral(
  db: DatabaseAdapter,
  referralId: string,
  reason: string,
  suggestedAlternativeId?: string,
  audit?: AuditActor,
): Promise<CachedReferral> {
  return db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const won = await tx.query<{ id: string }>(
      `UPDATE cached_referrals SET status = ?, rejected_at = ?, rejection_reason = ?, suggested_alternative_id = ?, updated_at = ?
        WHERE id = ? AND status = ? RETURNING id`,
      [
        ReferralStatus.REJECTED,
        now,
        reason,
        suggestedAlternativeId ?? null,
        now,
        referralId,
        ReferralStatus.INITIATED,
      ],
    );
    if (won.length === 0) {
      return resolveLostTransition(
        tx,
        referralId,
        ReferralStatus.REJECTED,
        ReferralStatus.INITIATED,
      );
    }
    if (audit?.userId) {
      await logAccess(tx, {
        ...audit,
        action: 'referral_reject',
        resourceType: 'referral',
        resourceId: referralId,
      });
    }
    return getReferralById(tx, referralId);
  });
}

export async function markInTransit(
  db: DatabaseAdapter,
  referralId: string,
  transportMode: string,
  audit?: AuditActor,
): Promise<CachedReferral> {
  return db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const won = await tx.query<{ id: string }>(
      `UPDATE cached_referrals SET status = ?, departed_at = ?, transport_mode = ?, updated_at = ?
        WHERE id = ? AND status = ? RETURNING id`,
      [ReferralStatus.IN_TRANSIT, now, transportMode, now, referralId, ReferralStatus.ACCEPTED],
    );
    if (won.length === 0) {
      return resolveLostTransition(
        tx,
        referralId,
        ReferralStatus.IN_TRANSIT,
        ReferralStatus.ACCEPTED,
      );
    }
    if (audit?.userId) {
      await logAccess(tx, {
        ...audit,
        action: 'referral_transit',
        resourceType: 'referral',
        resourceId: referralId,
      });
    }
    return getReferralById(tx, referralId);
  });
}

export async function confirmArrival(
  db: DatabaseAdapter,
  referralId: string,
  _receivingAn: string,
  audit?: AuditActor,
): Promise<CachedReferral> {
  return db.transaction(async (tx) => {
    const now = new Date().toISOString();
    const won = await tx.query<{ id: string; to_hospital_id: string; journey_id: string }>(
      `UPDATE cached_referrals SET status = ?, arrived_at = ?, updated_at = ?
        WHERE id = ? AND status = ? RETURNING id, to_hospital_id, journey_id`,
      [ReferralStatus.ARRIVED, now, now, referralId, ReferralStatus.IN_TRANSIT],
    );
    if (won.length === 0) {
      return resolveLostTransition(
        tx,
        referralId,
        ReferralStatus.ARRIVED,
        ReferralStatus.IN_TRANSIT,
      );
    }
    await tx.execute(
      `UPDATE maternal_journeys SET current_hospital_id = ?, updated_at = ? WHERE id = ?`,
      [won[0].to_hospital_id, now, won[0].journey_id],
    );
    if (audit?.userId) {
      await logAccess(tx, {
        ...audit,
        action: 'referral_arrive',
        resourceType: 'referral',
        resourceId: referralId,
      });
    }
    return getReferralById(tx, referralId);
  });
}

/**
 * Infer arrivals for INITIATED referrals from journey ownership.
 *
 * Production reality: HOSxP refer-out sync creates referrals as INITIATED
 * and hospitals rarely drive the accept/transit/arrive webhooks, so the
 * lifecycle never advances even after the patient demonstrably arrived.
 * Conservative evidence rule — all must hold:
 *   1. referral is still INITIATED
 *   2. the journey's current_hospital_id equals the referral destination
 *   3. the journey was updated AFTER the referral was initiated
 * arrived_at is set to the journey's ownership-change timestamp, not now(),
 * so the recorded arrival reflects the evidence. Gated by
 * REFERRAL_AUTO_ARRIVE.enabled in src/config/referral-sla.ts.
 *
 * Returns the number of referrals transitioned.
 */
export async function autoArriveReferrals(
  db: DatabaseAdapter,
  options: { enabled?: boolean } = {},
): Promise<number> {
  const enabled = options.enabled ?? REFERRAL_AUTO_ARRIVE.enabled;
  if (!enabled) return 0;

  const candidates = await db.query<{ id: string; evidence_at: string }>(
    `SELECT cr.id, mj.updated_at as evidence_at
       FROM cached_referrals cr
       JOIN maternal_journeys mj ON mj.id = cr.journey_id
      WHERE cr.status = 'INITIATED'
        AND mj.current_hospital_id = cr.to_hospital_id
        AND mj.updated_at > cr.initiated_at`,
    [],
  );

  const now = new Date().toISOString();
  for (const c of candidates) {
    // Guard on status so a parallel explicit confirmArrival/reject wins.
    await db.execute(
      `UPDATE cached_referrals
          SET status = ?, arrived_at = ?, updated_at = ?
        WHERE id = ? AND status = 'INITIATED'`,
      [ReferralStatus.ARRIVED, c.evidence_at, now, c.id],
    );
  }
  return candidates.length;
}

export async function getPendingReferrals(
  db: DatabaseAdapter,
  hospitalId: string,
  direction: 'in' | 'out',
): Promise<CachedReferral[]> {
  const column = direction === 'out' ? 'from_hospital_id' : 'to_hospital_id';
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_referrals WHERE ${column} = ? AND status NOT IN ('ARRIVED', 'REJECTED') ORDER BY initiated_at DESC`,
    [hospitalId],
  );
  return rows.map(mapRowToReferral);
}

async function getReferralById(db: DatabaseAdapter, id: string): Promise<CachedReferral> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_referrals WHERE id = ?`,
    [id],
  );
  return mapRowToReferral(rows[0]);
}

function mapRowToReferral(row: Record<string, unknown>): CachedReferral {
  return {
    id: row.id as string,
    journeyId: row.journey_id as string,
    referNumber: row.refer_number as string | null,
    fromHospitalId: row.from_hospital_id as string,
    toHospitalId: row.to_hospital_id as string,
    status: row.status as ReferralStatus,
    reason: row.reason as string,
    diagnosisCode: row.diagnosis_code as string | null,
    urgencyLevel: row.urgency_level as UrgencyLevel,
    rejectionReason: row.rejection_reason as string | null,
    suggestedAlternativeId: row.suggested_alternative_id as string | null,
    transportMode: row.transport_mode as string | null,
    initiatedAt: new Date(row.initiated_at as string),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at as string) : null,
    departedAt: row.departed_at ? new Date(row.departed_at as string) : null,
    arrivedAt: row.arrived_at ? new Date(row.arrived_at as string) : null,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at as string) : null,
    initiatedBy: row.initiated_by as string | null,
    acceptedBy: row.accepted_by as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
