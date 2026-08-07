// PATCH /api/referrals/[id]/arrive — destination hospital confirms arrival.
import { referralTransitionRoute } from '@/lib/referral-http';
import { confirmArrival } from '@/services/referral';
import { auditActorFromSession } from '@/lib/audit-actor';

export const PATCH = referralTransitionRoute({
  side: 'to',
  requiredField: 'receivingAn',
  logEvent: 'referral_arrive_failed',
  run: (db, id, body, session) =>
    confirmArrival(db, id, String(body.receivingAn), auditActorFromSession(session)),
});
