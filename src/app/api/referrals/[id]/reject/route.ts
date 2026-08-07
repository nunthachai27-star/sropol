// PATCH /api/referrals/[id]/reject — destination hospital rejects a referral.
import { referralTransitionRoute } from '@/lib/referral-http';
import { rejectReferral } from '@/services/referral';
import { auditActorFromSession } from '@/lib/audit-actor';

export const PATCH = referralTransitionRoute({
  side: 'to',
  requiredField: 'reason',
  logEvent: 'referral_reject_failed',
  run: (db, id, body, session) =>
    rejectReferral(
      db,
      id,
      String(body.reason),
      body.suggestedAlternativeId != null ? String(body.suggestedAlternativeId) : undefined,
      auditActorFromSession(session),
    ),
});
