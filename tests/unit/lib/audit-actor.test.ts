import { describe, it, expect } from 'vitest';
import { auditActorFromSession } from '@/lib/audit-actor';
import { UserRole } from '@/types/domain';
import type { Session } from 'next-auth';

function sessionWith(user: Partial<Session['user']>): Session {
  return { user, expires: '2099-01-01T00:00:00.000Z' } as Session;
}

describe('auditActorFromSession', () => {
  it('maps a BMS session to the audit actor snapshot', () => {
    const actor = auditActorFromSession(
      sessionWith({
        id: 'bms-session-id',
        name: 'นาง ทดสอบ ระบบ',
        role: UserRole.NURSE,
        hospitalCode: '10670',
      }),
    );
    expect(actor).toEqual({
      userId: 'bms-session-id',
      userName: 'นาง ทดสอบ ระบบ',
      userRole: UserRole.NURSE,
      hospitalCode: '10670',
    });
  });

  it('returns an empty actor for a null session', () => {
    expect(auditActorFromSession(null)).toEqual({});
  });

  it('omits a missing name rather than emitting null', () => {
    const actor = auditActorFromSession(
      sessionWith({ id: 'sid', role: UserRole.ADMIN, hospitalCode: '00000' }),
    );
    expect(actor.userId).toBe('sid');
    expect('userName' in actor).toBe(false);
  });
});
