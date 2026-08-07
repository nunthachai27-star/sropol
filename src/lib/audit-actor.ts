// Build the actor half of an AuditLogEntry from a NextAuth session, so every
// audit call site records the same identity snapshot (user id + name + role +
// hospital) without duplicating the extraction. Spread the result into the
// tryLogAccess/logAccess call:
//
//   await tryLogAccess(db, { ...auditActorFromSession(session), action, resourceType });
import type { Session } from 'next-auth';

export interface AuditActor {
  userId?: string;
  userName?: string;
  userRole?: string;
  hospitalCode?: string;
}

/**
 * Map a NextAuth session to the audit actor snapshot. Undefined/missing fields
 * are omitted (not emitted as null) so the object spreads cleanly and only
 * overrides what it actually knows.
 */
export function auditActorFromSession(session: Session | null | undefined): AuditActor {
  const user = session?.user;
  if (!user) return {};
  const actor: AuditActor = {};
  if (user.id) actor.userId = user.id;
  if (user.name) actor.userName = user.name;
  if (user.role) actor.userRole = user.role;
  if (user.hospitalCode) actor.hospitalCode = user.hospitalCode;
  return actor;
}
