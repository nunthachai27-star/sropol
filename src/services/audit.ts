// T088: Audit service — append-only PDPA access logging
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

export interface AuditLogEntry {
  /** Correlation token for the actor — the BMS session id. A soft, non-FK,
   *  nullable reference. Optional in the type so `auditActorFromSession()` can
   *  be spread in directly; `logAccess` still validates it is present at
   *  runtime (see below), so every audited action records *some* identity. */
  userId?: string | null;
  /** Human-readable actor identity, snapshotted at write time (the "who" for
   *  PDPA). Optional so non-session callers can still log. */
  userName?: string | null;
  userRole?: string | null;
  hospitalCode?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export async function logAccess(db: DatabaseAdapter, entry: AuditLogEntry): Promise<void> {
  if (!entry.userId || !entry.action || !entry.resourceType) {
    throw new Error('Missing required audit log fields: userId, action, resourceType');
  }

  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO audit_logs (id, user_id, user_name, user_role, hospital_code, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      entry.userId ?? null,
      entry.userName ?? null,
      entry.userRole ?? null,
      entry.hospitalCode ?? null,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      now,
    ],
  );
}

/**
 * Fire-and-forget audit log: never throws, never blocks the request.
 *
 * Audit failures are an *operational* problem (DB issue, schema mismatch),
 * not an authorization problem — the user has already been authenticated
 * and the action they're requesting is unrelated to the audit DB. Failing
 * the request would punish the user for an internal bug.
 *
 * Instead we emit logger.warn so the failure is visible in observability
 * without affecting the user experience. PDPA compliance gaps that result
 * are tracked through the warn-level metric.
 */
export async function tryLogAccess(db: DatabaseAdapter, entry: AuditLogEntry): Promise<void> {
  try {
    await logAccess(db, entry);
  } catch (error) {
    logger.warn('audit_log_failed', {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      error,
    });
  }
}
