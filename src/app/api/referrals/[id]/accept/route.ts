// PATCH /api/referrals/[id]/accept — destination hospital accepts a referral.
// Actor identity comes from the session; client-supplied acceptedBy is ignored.
import { referralTransitionRoute } from '@/lib/referral-http';
import { acceptReferral } from '@/services/referral';
import { auditActorFromSession } from '@/lib/audit-actor';

export const PATCH = referralTransitionRoute({
  side: 'to',
  requiredField: null,
  logEvent: 'referral_accept_failed',
  run: (db, id, _body, session) =>
    acceptReferral(db, id, session.user.name ?? session.user.id, auditActorFromSession(session)),
});
