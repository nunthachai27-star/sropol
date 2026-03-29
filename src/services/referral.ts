// Referral workflow service — state machine for inter-hospital referrals
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { ReferralStatus, UrgencyLevel } from '@/types/domain';
import type { CachedReferral } from '@/types/domain';

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
    [id, input.journeyId, input.fromHospitalId, input.toHospitalId, ReferralStatus.INITIATED, input.reason, input.diagnosisCode ?? null, input.urgencyLevel, now, input.initiatedBy ?? null, now, now],
  );

  return getReferralById(db, id);
}

async function assertReferralStatus(
  db: DatabaseAdapter,
  referralId: string,
  expectedStatus: ReferralStatus,
): Promise<void> {
  const current = await getReferralById(db, referralId);
  if (current.status !== expectedStatus) {
    throw new Error(
      `ไม่สามารถดำเนินการได้: สถานะปัจจุบัน "${current.status}" ต้องเป็น "${expectedStatus}"`,
    );
  }
}

export async function acceptReferral(
  db: DatabaseAdapter,
  referralId: string,
  acceptedBy: string,
): Promise<CachedReferral> {
  await assertReferralStatus(db, referralId, ReferralStatus.INITIATED);
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = ?, accepted_at = ?, accepted_by = ?, updated_at = ? WHERE id = ?`,
    [ReferralStatus.ACCEPTED, now, acceptedBy, now, referralId],
  );
  return getReferralById(db, referralId);
}

export async function rejectReferral(
  db: DatabaseAdapter,
  referralId: string,
  reason: string,
  suggestedAlternativeId?: string,
): Promise<CachedReferral> {
  await assertReferralStatus(db, referralId, ReferralStatus.INITIATED);
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = ?, rejected_at = ?, rejection_reason = ?, suggested_alternative_id = ?, updated_at = ? WHERE id = ?`,
    [ReferralStatus.REJECTED, now, reason, suggestedAlternativeId ?? null, now, referralId],
  );
  return getReferralById(db, referralId);
}

export async function markInTransit(
  db: DatabaseAdapter,
  referralId: string,
  transportMode: string,
): Promise<CachedReferral> {
  await assertReferralStatus(db, referralId, ReferralStatus.ACCEPTED);
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = ?, departed_at = ?, transport_mode = ?, updated_at = ? WHERE id = ?`,
    [ReferralStatus.IN_TRANSIT, now, transportMode, now, referralId],
  );
  return getReferralById(db, referralId);
}

export async function confirmArrival(
  db: DatabaseAdapter,
  referralId: string,
  _receivingAn: string,
): Promise<CachedReferral> {
  await assertReferralStatus(db, referralId, ReferralStatus.IN_TRANSIT);
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = ?, arrived_at = ?, updated_at = ? WHERE id = ?`,
    [ReferralStatus.ARRIVED, now, now, referralId],
  );

  const referral = await getReferralById(db, referralId);
  await db.execute(
    `UPDATE maternal_journeys SET current_hospital_id = ?, updated_at = ? WHERE id = ?`,
    [referral.toHospitalId, now, referral.journeyId],
  );

  return referral;
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
