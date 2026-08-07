# Release C — Concurrency, Operational Resilience & Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prerequisites: Releases A and B complete (this plan builds on `session-guard.ts`, `referral-http.ts`, `FailingAdapter`, and the migration pattern). Read `2026-07-13-robustness-00-overview.md` first.

**Goal:** Exactly one winner for every concurrent state transition (referrals, video calls), Redis recovers automatically with honest degradation reporting, invalid configuration blocks readiness, the DB singleton survives concurrent cold starts, and lint/tests/build become clean blocking gates.

**Architecture:** Compare-and-set via `UPDATE … WHERE <expected state> RETURNING id` through `db.query()` (`db.execute()` returns void). Multi-write transitions wrapped in `db.transaction()`; SSE/timers fire only after commit. Redis gets bounded exponential backoff with single-flight reconnect (globalThis-pinned state, house style). Readiness is a separate endpoint from liveness.

**Tech Stack:** PostgreSQL/PGlite (`RETURNING`, `pg_advisory_xact_lock`, `DELETE … USING`), node-redis v5, Vitest 4 (`vi.useFakeTimers`, `Promise.allSettled` concurrency), ESLint 9 / eslint-config-next 16 (react-hooks v6).

## Global Constraints

- TDD: failing test first, red evidence, then fix — every task.
- Concurrency tests are deterministic: `Promise.allSettled` + winner/loser assertions on conditional-UPDATE results. No sleeps. (PGlite serializes writes — assert on RETURNING semantics, not interleaving.)
- Conditional-WHERE precedents already in-repo: `referral.ts` `autoArriveReferrals` (`AND status = 'INITIATED'`), `video-call.ts` `endCallIfEmpty` (`AND status = 'active'`).
- The SSE manager is `src/lib/sse.ts` (`class SseManager`), in-process only — do NOT add Redis pub/sub (project memory: prefer existing infra; single app container).
- Timers stay in the globalThis-pinned `__videoCallTimers` map; DB sweep remains the cross-restart backstop.
- Never suppress lint errors (constitution); the react-hooks v6 rules stay at error severity.
- Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `npx tsc --noEmit` after each task.

---

### Task C1: Conditional referral transitions with 409 conflicts and in-transaction audit

Context: accept/reject/transit/arrive use read-check-update with `WHERE id = ?` only — concurrent accept+reject both write (last-writer-wins with mixed columns, e.g. `status = REJECTED` but `accepted_at`/`accepted_by` populated). `confirmArrival` runs a second unguarded journey UPDATE with no transaction. Referral transitions have NO audit and state conflicts surface as generic 500s.

**Files:**
- Create: `tests/unit/services/referral-concurrency.test.ts`
- Modify: `src/services/referral.ts:47-122` (replace `assertReferralStatus` + 4 transitions)
- Modify: `src/lib/referral-http.ts` (409 mapping + audit actor pass-through)
- Modify: `src/app/api/referrals/[id]/{accept,reject,transit,arrive}/route.ts` (pass audit actor)

**Interfaces:**
- Produces: `class ReferralConflictError extends Error { currentStatus: string }` exported from `@/services/referral` → mapped to HTTP 409 `{ error: { code: 'STATE_CONFLICT', … } }` in `referralTransitionRoute`.
- Changed signatures (audit param optional — existing service tests keep passing):
  - `acceptReferral(db, referralId, acceptedBy, audit?: AuditActor)`
  - `rejectReferral(db, referralId, reason, suggestedAlternativeId?, audit?: AuditActor)`
  - `markInTransit(db, referralId, transportMode, audit?: AuditActor)`
  - `confirmArrival(db, referralId, receivingAn, audit?: AuditActor)`
- Semantics: transition + audit row commit in ONE transaction (spec 4.1.3 — deliberate departure from fire-and-forget `tryLogAccess`); duplicate requests for the already-reached status are idempotent successes; incompatible states throw `ReferralConflictError`.

- [ ] **Step 1: Write the failing concurrency tests**

```ts
// tests/unit/services/referral-concurrency.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { AncRiskLevel, ReferralStatus, UrgencyLevel } from '@/types/domain';
import { createJourney } from '@/services/journey';
import {
  initiateReferral,
  acceptReferral,
  rejectReferral,
  ReferralConflictError,
} from '@/services/referral';

let db: DatabaseAdapter;

async function seedReferral(): Promise<string> {
  const hosp = await db.query<{ id: string; hcode: string }>(
    `SELECT id, hcode FROM hospitals WHERE hcode IN ('10670','11004') ORDER BY hcode`,
  );
  const journey = await createJourney(db, {
    hospitalId: hosp[0].id, hn: 'HN-C1', personAncId: null, name: '', cid: '',
    cidHash: 'hash-c1', age: 30, gravida: 1, para: 0, lmp: null, edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  });
  const referral = await initiateReferral(db, {
    journeyId: journey.id,
    fromHospitalId: hosp[0].id,
    toHospitalId: hosp[1].id,
    reason: 'ทดสอบ',
    urgencyLevel: UrgencyLevel.URGENT,
  });
  return referral.id;
}

describe('referral transition concurrency', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  it('concurrent accept + reject: exactly one wins, loser gets ReferralConflictError', async () => {
    const id = await seedReferral();
    const results = await Promise.allSettled([
      acceptReferral(db, id, 'พว.เอ'),
      rejectReferral(db, id, 'เตียงเต็ม'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ReferralConflictError);

    // no mixed-column corruption: the losing transition wrote NOTHING
    const row = await db.query<{ status: string; accepted_by: string | null; rejection_reason: string | null }>(
      'SELECT status, accepted_by, rejection_reason FROM cached_referrals WHERE id = ?', [id]);
    if (row[0].status === ReferralStatus.ACCEPTED) {
      expect(row[0].rejection_reason).toBeNull();
    } else {
      expect(row[0].status).toBe(ReferralStatus.REJECTED);
      expect(row[0].accepted_by).toBeNull();
    }
  });

  it('duplicate accepts are idempotent — first actor sticks', async () => {
    const id = await seedReferral();
    await acceptReferral(db, id, 'พว.หนึ่ง');
    const second = await acceptReferral(db, id, 'พว.สอง'); // duplicate request
    expect(second.status).toBe(ReferralStatus.ACCEPTED);
    const row = await db.query<{ accepted_by: string }>(
      'SELECT accepted_by FROM cached_referrals WHERE id = ?', [id]);
    expect(row[0].accepted_by).toBe('พว.หนึ่ง');
  });

  it('accept writes its audit row atomically with the transition', async () => {
    const id = await seedReferral();
    await acceptReferral(db, id, 'พว.เอ', {
      userId: 'u-c1', userName: 'พว.เอ', userRole: 'NURSE', hospitalCode: '11004',
    });
    const audit = await db.query<{ resource_id: string }>(
      `SELECT resource_id FROM audit_logs WHERE action = 'referral_accept'`);
    expect(audit.length).toBe(1);
    expect(audit[0].resource_id).toBe(id);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/services/referral-concurrency.test.ts`
Expected: FAIL — both concurrent transitions fulfil (no conflict error exists); mixed columns present; no audit rows.

- [ ] **Step 3: Rewrite the transitions**

In `src/services/referral.ts`: add imports `import { logAccess } from '@/services/audit';` and `import type { AuditActor } from '@/lib/audit-actor';`. Delete `assertReferralStatus`. Add:

```ts
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
```

Replace the four transitions (accept shown fully; reject/transit follow the same template with their own SET columns and expected statuses — reject: `status = REJECTED, rejected_at, rejection_reason, suggested_alternative_id` expecting `INITIATED`, action `referral_reject`; transit: `status = IN_TRANSIT, departed_at, transport_mode` expecting `ACCEPTED`, action `referral_transit`):

```ts
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
      return resolveLostTransition(tx, referralId, ReferralStatus.ACCEPTED, ReferralStatus.INITIATED);
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
```

`confirmArrival` — conditional transition + journey ownership move + audit in ONE transaction:

```ts
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
      return resolveLostTransition(tx, referralId, ReferralStatus.ARRIVED, ReferralStatus.IN_TRANSIT);
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
```

- [ ] **Step 4: Map 409 + pass the audit actor at the routes**

In `src/lib/referral-http.ts` add to the catch chain (import `ReferralConflictError` from `@/services/referral`):

```ts
      if (error instanceof ReferralConflictError) {
        return NextResponse.json(
          {
            error: {
              code: 'STATE_CONFLICT',
              message: error.message,
              details: { currentStatus: error.currentStatus },
            },
          },
          { status: 409 },
        );
      }
```

Update the four route files' `run` callbacks to pass `auditActorFromSession(session)` (import from `@/lib/audit-actor`), e.g. accept:

```ts
  run: (db, id, _body, session) =>
    acceptReferral(db, id, session.user.name ?? session.user.id, auditActorFromSession(session)),
```

(reject/transit/arrive analogous, appending the audit argument after their existing parameters.)

- [ ] **Step 5: Run tests + typecheck + adjacent suites**

Run: `npx vitest run tests/unit/services/referral-concurrency.test.ts tests/unit/services/referral.test.ts tests/unit/api/referrals.test.ts tests/unit/api/referral-authorization.test.ts tests/unit/services/referral-list.test.ts && npx tsc --noEmit`
Expected: PASS (the happy-path suites are unchanged by the optional audit param; `autoArriveReferrals` untouched).

- [ ] **Step 6: Commit**

```bash
git add src/services/referral.ts src/lib/referral-http.ts src/app/api/referrals tests/unit/services/referral-concurrency.test.ts
git commit -m "fix(concurrency): referral transitions are conditional compare-and-set

Read-check-update let concurrent accept+reject both write (mixed-column rows:
status REJECTED with accepted_by set). Transitions now use UPDATE..WHERE
status = <expected> RETURNING inside a transaction (confirmArrival moves
journey ownership atomically), duplicates are idempotent, losers get a 409
STATE_CONFLICT with an actionable Thai message, and each transition writes
its audit row in the same transaction.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C2: Concurrency-safe video-call lifecycle

Context (recon-corrected line numbers): `createCall` = ~6 independent statements, two concurrent creates by one user both pass `isBusy`; `acceptInvite` (208-242) / `declineInvite` (244-278) / `leaveCall` (280-308) / `ringTimeout` (521-542) check status in JS then UPDATE `WHERE id = ?` unconditionally; `endCall` (544-561) is unguarded while `endCallIfEmpty` (563-571) is guarded; `ringCandidates` (442-501) SELECT-then-INSERTs with no unique `(call_id, user_id)`.

**Files:**
- Create: `src/db/migrations/video-call-participants-unique.ts`
- Create: `tests/unit/db/video-call-participants-unique-migration.test.ts`
- Modify: `src/db/tables/video-call-participants.ts:36-39` (add unique index for fresh DBs)
- Modify: `src/app/api/startup.ts` (wire migration after the B3 migration)
- Modify: `src/services/video-call.ts` (createCall, inviteToCall, ringCandidates split, acceptInvite, declineInvite, leaveCall, ringTimeout, endCall)
- Modify: `tests/unit/services/video-call.test.ts` (race cases)

**Interfaces:**
- Produces: `migrateVideoCallParticipantsUnique(db)` — dedupes (keeps newest per `(call_id, user_id)`; participant rows are ephemeral operational data, not clinical — dedupe is safe here, unlike B3) then `CREATE UNIQUE INDEX IF NOT EXISTS uq_vcp_call_user`.
- Internal split: `ringCandidates` → `persistRingRows(tx, callId, inviter, candidates)` (DB writes, `ON CONFLICT (call_id, user_id) DO UPDATE`) + `announceRings(db, call, inviter, candidates, ringTimeoutMs)` (timers + SSE, **after commit**).
- Semantics: accept/decline/leave/timeout are conditional on their expected prior state (`ringing`/`ringing`/`joined`/`ringing`+call-active); duplicates of the already-reached state are idempotent; incompatible states throw `VideoCallError('INVALID_STATE', …)`; the DB transition must win BEFORE `clearRingTimer`/SSE.

- [ ] **Step 1: Write the failing migration test**

```ts
// tests/unit/db/video-call-participants-unique-migration.test.ts
import { describe, it, expect } from 'vitest';
import { createPgliteDb } from '../../helpers/createPgliteDb';
import { migrateVideoCallParticipantsUnique } from '@/db/migrations/video-call-participants-unique';

describe('migrateVideoCallParticipantsUnique', () => {
  it('dedupes (keeping the newest) then creates the unique index, idempotently', async () => {
    const db = await createPgliteDb();
    await db.execute(
      `INSERT INTO video_calls (id, room_id, created_by_user_id, created_by_name, created_by_hospital_code, status, created_at)
       VALUES ('c1', 'room-1', 'u-creator', 'ผู้สร้าง', '10670', 'active', NOW())`,
    );
    // two rows for the same (call, user) — the pre-index race artifact
    await db.execute(
      `INSERT INTO video_call_participants (id, call_id, user_id, name, hospital_code, hospital_name, role, status, invited_by_user_id, invited_at)
       VALUES ('p-old', 'c1', 'u-dup', 'ซ้ำ', '10670', 'รพ.', 'invitee', 'ringing', 'u-creator', '2026-07-13T00:00:00Z')`,
    );
    await db.execute(
      `INSERT INTO video_call_participants (id, call_id, user_id, name, hospital_code, hospital_name, role, status, invited_by_user_id, invited_at)
       VALUES ('p-new', 'c1', 'u-dup', 'ซ้ำ', '10670', 'รพ.', 'invitee', 'ringing', 'u-creator', '2026-07-13T01:00:00Z')`,
    );

    await migrateVideoCallParticipantsUnique(db);
    await migrateVideoCallParticipantsUnique(db); // idempotent

    const rows = await db.query<{ id: string }>(
      `SELECT id FROM video_call_participants WHERE call_id = 'c1' AND user_id = 'u-dup'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p-new');
    const idx = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_vcp_call_user'`,
    );
    expect(idx.length).toBe(1);
    await db.close();
  });
});
```

(If `video_calls`/`video_call_participants` `id` columns are `uuid`-typed, replace `'c1'`/`'p-old'`/`'p-new'` with fixed UUID literals — check the table definitions when editing.)

- [ ] **Step 2: Write the failing race tests**

Append to `tests/unit/services/video-call.test.ts` (reuse its harness: real PGlite + `SseManager.resetForTests()` + `clearCallTimersForTests()` + presence helpers; the file already builds calls via `createCall` with recorded online users):

```ts
  it('concurrent accept + decline: exactly one terminal participant state', async () => {
    const { callId } = await createRingingCallTo('u-b'); // reuse/extract the file's setup for a call ringing u-b
    const results = await Promise.allSettled([
      acceptInvite(db, callId, actorB),
      declineInvite(db, callId, actorB),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);
    const row = await db.query<{ status: string }>(
      `SELECT status FROM video_call_participants WHERE call_id = ? AND user_id = 'u-b'`,
      [callId],
    );
    expect(['joined', 'declined']).toContain(row[0].status);
  });

  it('two concurrent createCall by the same creator produce exactly one active call', async () => {
    const results = await Promise.allSettled([
      createCall(db, creatorActor, ['u-b']),
      createCall(db, creatorActor, ['u-b']),
    ]);
    const wins = results.filter((r) => r.status === 'fulfilled');
    const busy = results.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'BUSY',
    );
    expect(wins.length).toBe(1);
    expect(busy.length).toBe(1);
    const calls = await db.query(`SELECT id FROM video_calls WHERE status = 'active'`);
    expect(calls.length).toBe(1);
  });

  it('a failed ring INSERT rolls back the whole call (no creator-less/ghost call)', async () => {
    const failing = new FailingAdapter(db, /'invitee', 'ringing'/);
    await expect(createCall(failing, creatorActor, ['u-b'])).rejects.toThrow(/injected failure/);
    const calls = await db.query(`SELECT id FROM video_calls`);
    expect(calls.length).toBe(0);
  });

  it('duplicate concurrent invites of one user leave exactly one participant row', async () => {
    const { callId } = await createJoinedCallWith('u-b'); // creator + u-b joined
    await Promise.allSettled([
      inviteToCall(db, callId, actorB, ['u-c']),
      inviteToCall(db, callId, actorB, ['u-c']),
    ]);
    const rows = await db.query(
      `SELECT id FROM video_call_participants WHERE call_id = ? AND user_id = 'u-c'`,
      [callId],
    );
    expect(rows.length).toBe(1);
  });
```

(Adapt `createRingingCallTo`/`createJoinedCallWith`/`creatorActor`/`actorB` to the file's existing fixture names — it already constructs exactly these situations for its sequential tests. Add `import { FailingAdapter } from '../../helpers/failingDb';`.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/db/video-call-participants-unique-migration.test.ts tests/unit/services/video-call.test.ts`
Expected: FAIL — migration module missing; both accept+decline fulfil; double-create yields two active calls; duplicate invites create two rows.

- [ ] **Step 4: Implement the migration + table index**

```ts
// src/db/migrations/video-call-participants-unique.ts
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

/**
 * One-shot idempotent migration: unique (call_id, user_id) on
 * video_call_participants. Pre-index race artifacts are deduped keeping the
 * NEWEST row (participant rows are ephemeral operational state, not clinical
 * data — safe to collapse, unlike maternal_journeys).
 */
export async function migrateVideoCallParticipantsUnique(db: DatabaseAdapter): Promise<void> {
  const tables = await db.getTableNames();
  if (!tables.includes('video_call_participants')) return;
  await db.execute(
    `DELETE FROM video_call_participants a
      USING video_call_participants b
      WHERE a.call_id = b.call_id AND a.user_id = b.user_id
        AND (a.invited_at < b.invited_at OR (a.invited_at = b.invited_at AND a.id < b.id))`,
  );
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_vcp_call_user
       ON video_call_participants (call_id, user_id)`,
  );
  logger.info('vcp_unique_index_migrated', {});
}
```

Wire into `src/app/api/startup.ts` after the B3 migration (`// 2d. …`). Add to `src/db/tables/video-call-participants.ts` indexes (fresh databases get it from SchemaSync):

```ts
    { name: 'uq_vcp_call_user', columns: ['call_id', 'user_id'], unique: true },
```

- [ ] **Step 5: Restructure `createCall`/`inviteToCall`/`ringCandidates`**

In `src/services/video-call.ts`:

1. Split `ringCandidates` into:
   - `persistRingRows(tx, callId, inviter, candidates)` — the DB half; replace its SELECT-then-INSERT/UPDATE per candidate with one atomic statement:
     ```ts
     await tx.execute(
       `INSERT INTO video_call_participants
          (id, call_id, user_id, name, hospital_code, hospital_name, role, status,
           invited_by_user_id, invited_at)
        VALUES (?, ?, ?, ?, ?, ?, 'invitee', 'ringing', ?, NOW())
        ON CONFLICT (call_id, user_id) DO UPDATE SET
          status = 'ringing',
          invited_by_user_id = EXCLUDED.invited_by_user_id,
          invited_at = NOW(),
          joined_at = NULL,
          left_at = NULL`,
       [uuidv4(), callId, presence.userId, presence.name, presence.hospitalCode,
        presence.hospitalName, inviter.userId],
     );
     ```
   - `announceRings(db, call, inviter, candidates, ringTimeoutMs)` — the post-commit half: move the existing per-candidate `armRingTimer(...)` + SSE sends here VERBATIM (timers must reference the outer `db`, never a tx adapter — they fire later).
2. `createCall` becomes: sweep + evaluate as today, then:
   ```ts
   const callId = uuidv4();
   const roomId = `kklrms-${uuidv4()}`;
   await db.transaction(async (tx) => {
     // Serialize per-creator creation: concurrent createCall() calls for the
     // same user queue on this xact-scoped advisory lock instead of both
     // passing the isBusy check.
     await tx.query(`SELECT pg_advisory_xact_lock(hashtext(?))`, [creator.userId]);
     if (await isBusy(tx, creator.userId)) {
       throw new VideoCallError(
         'BUSY',
         'คุณมีสายที่กำลังสนทนาหรือกำลังเรียกอยู่ กรุณาวางสายเดิมก่อนเริ่มสายใหม่',
       );
     }
     await tx.execute(/* existing video_calls INSERT, unchanged SQL */);
     await tx.execute(/* existing creator-participant INSERT, unchanged SQL */);
     await persistRingRows(tx, callId, creator, evaluation.candidates);
   });
   const invited = announceRings(
     db, { id: callId, roomId }, creator, evaluation.candidates,
     options.ringTimeoutMs ?? DEFAULT_RING_TIMEOUT_MS,
   );
   return { callId, roomId, invited, skipped: evaluation.skipped };
   ```
   (move the original `isBusy` call inside the transaction; drop the pre-transaction one.)
3. `inviteToCall`: same split — persist inside `db.transaction`, announce after.

- [ ] **Step 6: Make every transition conditional; timers/SSE after the DB wins**

1. `acceptInvite`: keep the `loadHeader` active-check and `requireParticipant` (FORBIDDEN for strangers), then replace the check+UPDATE with:
   ```ts
   const won = await db.query<{ id: string; name: string }>(
     `UPDATE video_call_participants
         SET status = 'joined', joined_at = NOW(), left_at = NULL
       WHERE call_id = ? AND user_id = ? AND status = 'ringing'
       RETURNING id, name`,
     [callId, actor.userId],
   );
   if (won.length === 0) {
     const me = await requireParticipant(db, callId, actor.userId);
     if (me.status === 'joined') return { roomId: header.room_id }; // idempotent duplicate
     throw new VideoCallError('INVALID_STATE', `ไม่สามารถรับสายได้ — สถานะของคุณคือ "${me.status}"`);
   }
   clearRingTimer(callId, actor.userId); // ONLY after the DB transition wins
   ```
   followed by the existing `notifyJoined` + `sendToUser` calls.
2. `declineInvite`: same pattern — `SET status = 'declined', left_at = NOW() … AND status = 'ringing' RETURNING id, name`; idempotent when `me.status === 'declined'`; `clearRingTimer` after the win; keep its existing notifications/endCallIfEmpty behavior.
3. `leaveCall`: `SET status = 'left', left_at = NOW() … AND status = 'joined' RETURNING id, name`; idempotent no-op when already `left`; then the existing `countJoined` → `endCall`/`notifyJoined` branch.
4. `ringTimeout`: replace SELECT-then-UPDATE with one conditional statement:
   ```ts
   const won = await db.query<{ id: string; name: string }>(
     `UPDATE video_call_participants AS p
         SET status = 'missed', left_at = NOW()
        FROM video_calls c
       WHERE c.id = p.call_id AND c.status = 'active'
         AND p.call_id = ? AND p.user_id = ? AND p.status = 'ringing'
       RETURNING p.id, p.name`,
     [callId, userId],
   );
   if (won.length === 0) return; // answered/declined/cancelled first
   ```
   then the existing notify/`sendToUser`/`endCallIfEmpty` using `won[0].name`.
5. `endCall`: guard the header flip so only one caller proceeds to cancel rings:
   ```ts
   const won = await db.query<{ id: string }>(
     `UPDATE video_calls SET status = 'ended', ended_at = NOW()
       WHERE id = ? AND status = 'active' RETURNING id`,
     [header.id],
   );
   if (won.length === 0) return; // a concurrent leaver already ended it
   ```
   (rest of the ring-cancellation loop unchanged; `endCallIfEmpty` already guarded.)

- [ ] **Step 7: Run tests + typecheck + full call suites**

Run: `npx vitest run tests/unit/db/video-call-participants-unique-migration.test.ts tests/unit/services/video-call.test.ts tests/unit/api/video-calls.test.ts tests/integration/video-call-smoke.test.ts && npx tsc --noEmit`
Expected: PASS (the 477-line sequential suite is the behavioral safety net — re-invite flips the same row, INVALID_STATE double-accept, ring-timeout via real timers must all still pass).

- [ ] **Step 8: Commit**

```bash
git add src/services/video-call.ts src/db/migrations/video-call-participants-unique.ts src/db/tables/video-call-participants.ts src/app/api/startup.ts tests/unit/db/video-call-participants-unique-migration.test.ts tests/unit/services/video-call.test.ts
git commit -m "fix(concurrency): video-call lifecycle is transactional and conditional

createCall wrote ~6 independent statements (double-create put a user in two
active calls; a mid-create failure left ghost calls); accept/decline/leave/
timeout updated unconditionally after JS checks; duplicate invites created
duplicate participant rows. Creation now runs in one transaction under a
per-creator advisory lock, (call_id,user_id) is unique (dedupe migration +
index), every transition is compare-and-set with idempotent duplicates, and
timers/SSE fire only after the DB transition wins.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C3: Redis recovery with bounded backoff + honest cache status

Context: one failed initial `connect()` sets a permanent per-process disable flag; `cacheStatus()` reports `available: true` even on the memory fallback; post-connect command failures are NOT caught (they propagate to callers). Consumers of shared state: presence (`presence:users:*` — feeds admin online-users AND video-call ring candidates) and sync progress-store; dashboard cache is safely process-local.

**Files:**
- Create: `tests/unit/lib/cache.test.ts`
- Modify: `src/lib/cache.ts` (whole connection/fallback layer)

**Interfaces:**
- Changed: `cacheStatus(): Promise<{ backend: 'redis' | 'memory'; available: boolean; degraded: boolean; degradedSince: string | null }>` — `degraded: true` iff Redis is configured but unavailable (consumed by health in C4).
- Produces: `resetCacheForTests(): void` — clears client, retry state, and memory store (pattern: `SseManager.resetForTests`).
- Semantics: reconnect uses bounded exponential backoff with jitter (base 5 s, cap 5 min), single-flight (one in-flight connect per process), automatic recovery (`redis_recovered` log), and per-command try/catch falling back to the memory store (`redis_command_failed_using_memory` log) instead of throwing to presence/progress callers.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/lib/cache.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockClient = {
  isOpen: false,
  on: vi.fn(),
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  scanIterator: vi.fn(),
  del: vi.fn(),
};
vi.mock('redis', () => ({ createClient: vi.fn(() => mockClient) }));

import { cacheGetJson, cacheSetJson, cacheStatus, resetCacheForTests } from '@/lib/cache';

describe('cache Redis recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCacheForTests();
    vi.clearAllMocks();
    mockClient.isOpen = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('memory fallback works with TTL when REDIS_URL is unset', async () => {
    await cacheSetJson('k', { a: 1 }, 60);
    expect(await cacheGetJson('k')).toEqual({ a: 1 });
    vi.advanceTimersByTime(61_000);
    expect(await cacheGetJson('k')).toBeNull();
  });

  it('backs off after a failed connect instead of retrying every call — and instead of disabling forever', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));

    await cacheSetJson('k', 1, 60);          // attempt #1 fails -> memory
    await cacheSetJson('k', 2, 60);          // inside backoff window: NO new attempt
    expect(mockClient.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60_000);      // past max backoff
    mockClient.connect.mockImplementation(async () => {
      mockClient.isOpen = true;
    });
    mockClient.set.mockResolvedValue('OK');
    await cacheSetJson('k', 3, 60);          // attempt #2 succeeds -> redis again
    expect(mockClient.connect).toHaveBeenCalledTimes(2);
    const status = await cacheStatus();
    expect(status.backend).toBe('redis');
    expect(status.degraded).toBe(false);
  });

  it('reports degraded=true while configured Redis is unavailable', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    await cacheSetJson('k', 1, 60);
    const status = await cacheStatus();
    expect(status.backend).toBe('memory');
    expect(status.degraded).toBe(true);
    expect(status.degradedSince).not.toBeNull();
  });

  it('single-flight: concurrent calls during connect trigger one attempt', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    await Promise.all([cacheGetJson('a'), cacheGetJson('b'), cacheGetJson('c')]);
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('a post-connect command failure falls back to memory instead of throwing', async () => {
    vi.stubEnv('REDIS_URL', 'redis://test:6379');
    mockClient.isOpen = true;
    mockClient.get.mockRejectedValue(new Error('socket closed'));
    mockClient.set.mockRejectedValue(new Error('socket closed'));
    await expect(cacheSetJson('k', { a: 1 }, 60)).resolves.toBeUndefined();
    await expect(cacheGetJson('k')).resolves.toEqual({ a: 1 }); // served from memory
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/cache.test.ts`
Expected: FAIL — second connect attempt never happens (permanent disable); `degraded` field missing; command failure rejects.

- [ ] **Step 3: Rewrite the connection layer**

In `src/lib/cache.ts` replace the globals + `getRedisClient` + `getRaw`/`setRaw` + `cacheStatus` (keep `namespaced`, the memory store, and `cacheKeys`/`cacheDelPattern` structure with the redis-v5 `scanIterator` batch-flatten comment — but wrap their redis command sections in the same try/catch fallback):

```ts
interface RedisRetryState {
  attempt: number;
  disabledUntil: number;
  degradedSince: number | null;
  connecting: Promise<RedisClient | null> | null;
}

declare global {
  var __kkLrmsRedisClient: RedisClient | undefined;
  var __kkLrmsRedisRetry: RedisRetryState | undefined;
  var __kkLrmsMemoryCache: Map<string, MemoryEntry> | undefined;
}

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000;

function retryState(): RedisRetryState {
  if (!globalThis.__kkLrmsRedisRetry) {
    globalThis.__kkLrmsRedisRetry = {
      attempt: 0,
      disabledUntil: 0,
      degradedSince: null,
      connecting: null,
    };
  }
  return globalThis.__kkLrmsRedisRetry;
}

function newRedisClient(url: string): RedisClient {
  const client = createClient({ url });
  // attach ONCE at creation (re-attaching per call leaked listeners before)
  client.on('error', (error) => {
    logger.warn('redis_client_error', { error });
  });
  globalThis.__kkLrmsRedisClient = client;
  return client;
}

async function getRedisClient(): Promise<RedisClient | null> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl || redisUrl === 'memory') return null;

  const existing = globalThis.__kkLrmsRedisClient;
  if (existing?.isOpen) return existing;

  const state = retryState();
  if (Date.now() < state.disabledUntil) return null;   // inside backoff window
  if (state.connecting) return state.connecting;        // single-flight

  state.connecting = (async () => {
    const client = globalThis.__kkLrmsRedisClient ?? newRedisClient(redisUrl);
    try {
      if (!client.isOpen) await client.connect();
      if (state.attempt > 0) {
        logger.info('redis_recovered', {
          attempts: state.attempt,
          downMs: state.degradedSince ? Date.now() - state.degradedSince : null,
        });
      }
      state.attempt = 0;
      state.disabledUntil = 0;
      state.degradedSince = null;
      return client;
    } catch (error) {
      state.attempt += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (state.attempt - 1));
      const jittered = backoff * (0.5 + Math.random() * 0.5);
      state.disabledUntil = Date.now() + jittered;
      state.degradedSince = state.degradedSince ?? Date.now();
      logger.warn('redis_unavailable_using_memory_cache', {
        attempt: state.attempt,
        retryInMs: Math.round(jittered),
        error,
      });
      return null;
    } finally {
      state.connecting = null;
    }
  })();
  return state.connecting;
}

async function getRaw(key: string): Promise<string | null> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    try {
      return await redis.get(fullKey);
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'get', error });
    }
  }
  cleanupExpiredMemory();
  return memoryStore().get(fullKey)?.value ?? null;
}

async function setRaw(key: string, value: string, ttlSeconds: number): Promise<void> {
  const fullKey = namespaced(key);
  const redis = await getRedisClient();
  if (redis) {
    try {
      await redis.set(fullKey, value, { EX: ttlSeconds });
      return;
    } catch (error) {
      logger.warn('redis_command_failed_using_memory', { op: 'set', error });
    }
  }
  memoryStore().set(fullKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheStatus(): Promise<{
  backend: 'redis' | 'memory';
  available: boolean;
  degraded: boolean;
  degradedSince: string | null;
}> {
  const redisUrl = process.env.REDIS_URL?.trim();
  const configured = Boolean(redisUrl && redisUrl !== 'memory');
  const redis = configured ? await getRedisClient() : null;
  if (redis) {
    return { backend: 'redis', available: true, degraded: false, degradedSince: null };
  }
  const since = retryState().degradedSince;
  return {
    backend: 'memory',
    available: true,
    degraded: configured,
    degradedSince: configured && since ? new Date(since).toISOString() : null,
  };
}

/** Tear down client + retry state + memory store so tests start clean. */
export function resetCacheForTests(): void {
  globalThis.__kkLrmsRedisClient = undefined;
  globalThis.__kkLrmsRedisRetry = undefined;
  globalThis.__kkLrmsMemoryCache = undefined;
}
```

(Delete the old `__kkLrmsRedisDisabled` global entirely.)

- [ ] **Step 4: Run tests + typecheck + consumers**

Run: `npx vitest run tests/unit/lib/cache.test.ts tests/unit/services/video-call.test.ts tests/unit/api/video-calls.test.ts && npx tsc --noEmit`
Expected: PASS (video-call suites exercise the memory backend via `cacheDelPattern` cleanup — unchanged behavior with REDIS_URL unset).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts tests/unit/lib/cache.test.ts
git commit -m "fix(ops): Redis recovers with bounded backoff instead of permanent disable

One failed initial connect disabled Redis for the process lifetime while
cacheStatus() still claimed available:true, and post-connect command failures
threw raw errors at presence/progress callers. Reconnects now use single-
flight exponential backoff with jitter (5s..5min), recovery is automatic and
logged, commands fall back to the memory store on failure, and cacheStatus()
reports degraded/degradedSince truthfully for health reporting.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C4: Startup config validation, liveness vs readiness, honest health

**Files:**
- Create: `src/lib/startup-config.ts` + `tests/unit/lib/startup-config.test.ts`
- Create: `src/app/api/health/ready/route.ts`
- Modify: `src/lib/encryption.ts:42-51` (hex-charset validation)
- Modify: `src/app/api/startup.ts` (validate config FIRST)
- Modify: `src/services/health.ts` (cache + grace states), `tests/unit/api/health.test.ts`
- Modify: `docker-compose.yml` (app healthcheck)
- Modify: `tests/unit/lib/encryption.test.ts` (key-format cases)

**Interfaces:**
- Produces: `validateStartupConfig(env?: NodeJS.ProcessEnv): void` in `@/lib/startup-config` — throws a single aggregated `Error` listing every problem: `ENCRYPTION_KEY` must match `^[0-9a-fA-F]{64}$` and decode to 32 bytes (required in production; if set elsewhere must be valid), `DATABASE_URL` required when not running PGlite.
- Changed: `getEncryptionKey()` — also rejects non-hex 64-char strings (previously only length-checked, so `Buffer.from(key,'hex')` silently produced a short key and `createCipheriv` blew up mid-request).
- Changed: `HealthStatus` gains `cache: { backend: 'redis' | 'memory'; degraded: boolean; degradedSince: string | null }` and `degradedReasons: string[]`; status is `degraded` when Redis is configured-but-unavailable, any hospital is OFFLINE, or `total > 0 && online === 0` (reason `no_hospitals_online` — the explicit grace-state).
- Produces: `GET /api/health/ready` — 200 only when `ensureInit()` (which now validates config first) and a live `SELECT 1` succeed; 503 otherwise. `/api/health` remains liveness/status. Middleware `PUBLIC_PATHS` already covers it (`/api/health` startsWith).

- [ ] **Step 1: Write failing config-validation tests**

```ts
// tests/unit/lib/startup-config.test.ts
import { describe, it, expect } from 'vitest';
import { validateStartupConfig } from '@/lib/startup-config';

const VALID_KEY = 'a'.repeat(64);

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'production', ENCRYPTION_KEY: VALID_KEY, DATABASE_URL: 'postgres://x', ...overrides } as NodeJS.ProcessEnv;
}

describe('validateStartupConfig', () => {
  it('passes a valid production config', () => {
    expect(() => validateStartupConfig(env({}))).not.toThrow();
  });
  it('rejects a missing ENCRYPTION_KEY in production', () => {
    expect(() => validateStartupConfig(env({ ENCRYPTION_KEY: undefined }))).toThrow(/ENCRYPTION_KEY/);
  });
  it('rejects a 64-char NON-HEX key', () => {
    expect(() => validateStartupConfig(env({ ENCRYPTION_KEY: 'z'.repeat(64) }))).toThrow(/hex/);
  });
  it('rejects a wrong-length key', () => {
    expect(() => validateStartupConfig(env({ ENCRYPTION_KEY: 'ab'.repeat(16) }))).toThrow(/64/);
  });
  it('requires DATABASE_URL when PGlite is off', () => {
    expect(() => validateStartupConfig(env({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
  });
  it('does not require DATABASE_URL under PGlite/test', () => {
    expect(() =>
      validateStartupConfig(env({ DATABASE_URL: undefined, USE_PGLITE: 'true' })),
    ).not.toThrow();
  });
  it('aggregates every problem into one actionable error', () => {
    expect(() =>
      validateStartupConfig(env({ ENCRYPTION_KEY: 'bad', DATABASE_URL: undefined })),
    ).toThrow(/ENCRYPTION_KEY[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*ENCRYPTION_KEY/);
  });
});
```

Add to `tests/unit/lib/encryption.test.ts`:

```ts
  it('getEncryptionKey rejects a 64-char non-hex string', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'z'.repeat(64));
    expect(() => getEncryptionKey()).toThrow(/hex/);
    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/startup-config.test.ts tests/unit/lib/encryption.test.ts`
Expected: FAIL — module missing; non-hex key accepted.

- [ ] **Step 3: Implement config validation**

```ts
// src/lib/startup-config.ts
// Startup configuration validation — runs FIRST in initializeApp() so an
// invalid deployment never becomes ready, let alone ingests clinical data.
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function validateStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const usePglite = env.USE_PGLITE === 'true' || env.NODE_ENV === 'test';

  const key = env.ENCRYPTION_KEY;
  if (!key) {
    if (isProduction) errors.push('ENCRYPTION_KEY is required in production');
  } else if (!HEX_64.test(key) || Buffer.from(key, 'hex').length !== 32) {
    errors.push('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  if (!usePglite && !env.DATABASE_URL) {
    errors.push('DATABASE_URL is required when not running PGlite');
  }

  if (errors.length > 0) {
    throw new Error(`Startup configuration invalid: ${errors.join('; ')}`);
  }
}
```

In `src/lib/encryption.ts` extend `getEncryptionKey`:

```ts
const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  if (!HEX_64.test(key)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return key;
}
```

In `src/app/api/startup.ts`, first statement inside the `try` (before `getDatabase()`):

```ts
    // 0. Config validation — an invalid deployment must fail before any DB
    // connection or clinical ingest (readiness stays 503 via ensureInit).
    validateStartupConfig();
```

- [ ] **Step 4: Extend health + add readiness + compose healthcheck**

`src/services/health.ts` — extend the interface and computation (import `cacheStatus` from `@/lib/cache`):

```ts
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: 'connected' | 'disconnected';
  cache: { backend: 'redis' | 'memory'; degraded: boolean; degradedSince: string | null };
  uptime: number;
  timestamp: string;
  hospitalConnections: { total: number; online: number; offline: number; unknown: number };
  degradedReasons: string[];
}
```

and after the existing DB/hospital block:

```ts
  const cache = await cacheStatus();
  const degradedReasons: string[] = [];
  if (hospitalConnections.offline > 0) degradedReasons.push('hospitals_offline');
  if (cache.degraded) degradedReasons.push('redis_unavailable');
  if (hospitalConnections.total > 0 && hospitalConnections.online === 0) {
    // Grace-state: nothing has synced (yet) — never present this as healthy.
    degradedReasons.push('no_hospitals_online');
  }
  const status: HealthStatus['status'] =
    dbStatus === 'disconnected' ? 'unhealthy' : degradedReasons.length > 0 ? 'degraded' : 'healthy';

  return {
    status,
    database: dbStatus,
    cache: { backend: cache.backend, degraded: cache.degraded, degradedSince: cache.degradedSince },
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    hospitalConnections,
    degradedReasons,
  };
```

Update `tests/unit/api/health.test.ts`: the seeded 26-hospitals-all-UNKNOWN fixture now expects `status: 'degraded'` with `degradedReasons` containing `'no_hospitals_online'` (deliberate spec change), plus a new case: seed one hospital `connection_status = 'ONLINE'` → `status: 'healthy'`.

```ts
// src/app/api/health/ready/route.ts
// Readiness: 200 only when startup (config validation + migrations + seeds)
// succeeded AND the database answers. Liveness stays at /api/health.
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();
    await db.query('SELECT 1 as ok');
    return NextResponse.json({ ready: true, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      {
        ready: false,
        reason: error instanceof Error ? error.message : 'unknown initialization failure',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
```

`docker-compose.yml` app service — add (node:20-alpine has no curl; global fetch does the job; `start_period` tolerates Next.js cold start + first `ensureInit`):

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 90s
```

- [ ] **Step 5: Run tests + typecheck + compose validation**

Run: `npx vitest run tests/unit/lib/startup-config.test.ts tests/unit/lib/encryption.test.ts tests/unit/api/health.test.ts && npx tsc --noEmit && docker compose config -q`
Expected: PASS (compose config validates).

- [ ] **Step 6: Commit**

```bash
git add src/lib/startup-config.ts src/lib/encryption.ts src/app/api/startup.ts src/services/health.ts src/app/api/health/ready tests/unit/lib/startup-config.test.ts tests/unit/lib/encryption.test.ts tests/unit/api/health.test.ts docker-compose.yml
git commit -m "feat(ops): startup config validation + readiness endpoint + honest health

ENCRYPTION_KEY was validated lazily (length only — a 64-char non-hex key
exploded mid-request in createCipheriv) and nothing gated readiness on
configuration. initializeApp now validates config first; /api/health/ready
reports readiness separately from liveness and gates the new compose
healthcheck; /api/health reports cache degradation and an explicit
no_hospitals_online grace state instead of claiming healthy with zero usable
integrations.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C5: Truthful BMS error classification + no guessed database dialect

Context: `BmsSessionClient.executeQuery` maps EVERY thrown error (DNS `ENOTFOUND`, `ECONNREFUSED`, TLS, JSON parse) to code `TIMEOUT`; `getSessionId`/`validateSession` do the inverse (real timeouts become `CONNECTION_ERROR`). The onboarding `detectDatabaseType()` returns `'mysql'` on ANY failure and the route persists that guess into `hospital_bms_config.database_type` (overwriting a previously correct value on re-onboard).

**Files:**
- Modify: `src/lib/bms-session.ts:97-155` (+ shared classifier; `getDatabaseType` → nullable detection)
- Modify: `tests/unit/lib/bms-session.test.ts` (classification cases)
- Modify: `src/app/api/onboarding/hosxp-sync/route.ts:41-64, 210-262` (no-guess persist, 422)

**Interfaces:**
- Produces (private in `bms-session.ts`): `classifyTransportError(error: unknown): BmsApiError` — `TimeoutError`/`AbortError` → `TIMEOUT`; otherwise `CONNECTION_ERROR` with a cause-specific message prefix (`DNS lookup failed` for `ENOTFOUND`/`EAI_AGAIN`, `connection refused` for `ECONNREFUSED`, `TLS error` for `ERR_TLS_*`/cert codes, `invalid JSON response` for `SyntaxError`, else `network error`). Used by all three catch blocks.
- Changed: `BmsSessionClient.getDatabaseType(...)` → returns `Promise<DatabaseDialect | null>` (null on failure); the route consumes it (deleting its duplicated local `detectDatabaseType` — DRY) and returns `422 { error: 'db_type_detection_failed', stage: 'detect', detail: <Thai actionable> }` instead of persisting a guess.

- [ ] **Step 1: Write failing classification tests**

Append to `tests/unit/lib/bms-session.test.ts` (it already mocks global fetch):

```ts
  it('classifies an AbortSignal timeout as TIMEOUT', async () => {
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.mocked(fetch).mockRejectedValueOnce(timeoutError);
    await expect(client.executeQuery('SELECT 1', BMS_URL, 'jwt')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('classifies DNS failure as CONNECTION_ERROR with a DNS message, not TIMEOUT', async () => {
    const dnsError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND' },
    });
    vi.mocked(fetch).mockRejectedValueOnce(dnsError);
    await expect(client.executeQuery('SELECT 1', BMS_URL, 'jwt')).rejects.toMatchObject({
      code: 'CONNECTION_ERROR',
      message: expect.stringContaining('DNS lookup failed'),
    });
  });

  it('classifies a malformed 200 response as CONNECTION_ERROR (invalid JSON), not TIMEOUT', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as never);
    await expect(client.executeQuery('SELECT 1', BMS_URL, 'jwt')).rejects.toMatchObject({
      code: 'CONNECTION_ERROR',
      message: expect.stringContaining('invalid JSON response'),
    });
  });

  it('getDatabaseType returns null (not a mysql guess) when detection fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    }));
    await expect(client.getDatabaseType(BMS_URL, 'jwt')).resolves.toBeNull();
  });
```

(match the file's existing `client`/`BMS_URL` fixture names and fetch-mocking idiom.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/bms-session.test.ts`
Expected: FAIL — DNS/parse cases come back as `TIMEOUT`; `getDatabaseType` resolves `'mysql'` (or throws, depending on current shape).

- [ ] **Step 3: Implement the classifier**

In `src/lib/bms-session.ts` add:

```ts
function classifyTransportError(error: unknown): BmsApiError {
  const err = error as Error & { cause?: { code?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { code: 'TIMEOUT', message: `Request timed out: ${err.message}`, statusCode: 0 };
  }
  const causeCode = String(err?.cause?.code ?? '');
  const detail =
    causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN'
      ? 'DNS lookup failed'
      : causeCode === 'ECONNREFUSED'
        ? 'connection refused'
        : causeCode.startsWith('ERR_TLS') || causeCode === 'CERT_HAS_EXPIRED' || causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT'
          ? 'TLS error'
          : err instanceof SyntaxError
            ? 'invalid JSON response'
            : 'network error';
  return {
    code: 'CONNECTION_ERROR',
    message: `${detail}: ${err?.message ?? String(error)}`,
    statusCode: 0,
  };
}
```

Replace all three catch blocks (`executeQuery` 139-146, `getSessionId` 47-54, `validateSession` 87-94) with:

```ts
    } catch (error) {
      if (error instanceof BmsApiErrorClass) throw error;
      throw new BmsApiErrorClass(classifyTransportError(error));
    }
```

Change `getDatabaseType` (149-155) to return `Promise<DatabaseDialect | null>`: on any `BmsApiErrorClass`, `logger.warn('bms_db_type_detect_failed', { code: error.code })` and return `null`; on success apply the existing `version.includes('postgresql') ? 'postgresql' : 'mysql'` heuristic.

- [ ] **Step 4: Stop persisting guesses in the onboarding route**

In `src/app/api/onboarding/hosxp-sync/route.ts`: delete the local `detectDatabaseType` (41-64); at the resolution site (~210):

```ts
    const databaseType =
      normalizeDatabaseType(body.databaseType) ??
      (await new BmsSessionClient(apiUrl).getDatabaseType(apiUrl, bearerToken));
    if (!databaseType) {
      return NextResponse.json(
        {
          error: 'db_type_detection_failed',
          stage: 'detect',
          detail:
            'ตรวจสอบชนิดฐานข้อมูล HOSxP อัตโนมัติไม่สำเร็จ — โปรดระบุ databaseType (mysql หรือ postgresql) มากับคำขอแล้วลองใหม่',
        },
        { status: 422 },
      );
    }
```

(match `getDatabaseType`'s actual parameter list when editing — it must carry the same `appIdentifier`/`marketplaceToken` options the deleted local helper passed; extend its signature if needed so no capability is lost.) The UPDATE/INSERT persist block below now only ever receives a confirmed or user-supplied dialect.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/lib/bms-session.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bms-session.ts src/app/api/onboarding/hosxp-sync/route.ts tests/unit/lib/bms-session.test.ts
git commit -m "fix(ops): truthful BMS error codes; never persist a guessed DB dialect

executeQuery labelled every transport failure (DNS, refused connection, TLS,
JSON parse) as TIMEOUT while getSessionId/validateSession inverted the bug
(real timeouts as CONNECTION_ERROR). A shared classifier now branches on
DOMException TimeoutError and undici cause codes. Failed dialect detection
returns null and the onboarding route responds 422 asking for an explicit
databaseType instead of silently persisting 'mysql' into hospital_bms_config.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C6: Serialize database singleton initialization

Context correction vs the review: failed init IS retryable today (instance stays null). The real defect: only the resolved instance is memoized, so concurrent cold-start callers each construct an adapter across the `await import(...)` suspension — last writer wins, losers leak. Fix = memoize the in-flight promise with clear-on-rejection, copying `src/lib/ensure-init.ts` verbatim.

**Files:**
- Modify: `src/db/connection.ts:19-78`
- Modify: `tests/unit/db/driver-type.test.ts` (concurrency + retry cases)

**Interfaces:**
- Unchanged public API: `getDatabase(): Promise<DatabaseAdapter>`, `closeDatabase()`, `resetDatabaseInstance()`, `isPgliteEnabled()`, `getDriverType()`. Internal `DbSingleton` becomes `{ promise: Promise<DatabaseAdapter> | null }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/db/driver-type.test.ts` (it already uses `resetDatabaseInstance` in afterEach):

```ts
  it('concurrent cold-start calls share ONE adapter instance', async () => {
    resetDatabaseInstance();
    const [a, b, c] = await Promise.all([getDatabase(), getDatabase(), getDatabase()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('a failed initialization is retryable without an explicit reset', async () => {
    resetDatabaseInstance();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('USE_PGLITE', 'false');
    vi.stubEnv('DATABASE_URL', '');
    await expect(getDatabase()).rejects.toThrow(/DATABASE_URL/);
    vi.unstubAllEnvs(); // back to test env -> PGlite branch
    const db = await getDatabase(); // no reset — the rejected promise must have self-cleared
    expect(db).toBeDefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/db/driver-type.test.ts`
Expected: the concurrency test may pass by luck on fast paths, but the current code has no promise memoization — capture the red/inconclusive output, then make it deterministic with the rewrite.

- [ ] **Step 3: Rewrite the singleton**

Replace the singleton section of `src/db/connection.ts`:

```ts
interface DbSingleton {
  promise: Promise<DatabaseAdapter> | null;
}

const _global = global as unknown as { __dbSingleton?: DbSingleton };
const _singleton: DbSingleton = _global.__dbSingleton ?? { promise: null };
if (!_global.__dbSingleton) _global.__dbSingleton = _singleton;

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (!_singleton.promise) {
    // Memoize the IN-FLIGHT promise (not just the instance) so concurrent
    // cold-start callers await one construction; clear on rejection so a
    // later call can retry (same pattern as src/lib/ensure-init.ts).
    _singleton.promise = createAdapter().catch((error) => {
      _singleton.promise = null;
      throw error;
    });
  }
  return _singleton.promise;
}

async function createAdapter(): Promise<DatabaseAdapter> {
  if (isPgliteEnabled()) {
    const { PgliteAdapter, createPglite } = await import('./pglite-adapter');
    const path = process.env.PGLITE_PATH ?? './.pglite-data';
    if (process.env.NODE_ENV !== 'test') {
      logger.info('pglite_connected', { path });
    }
    return new PgliteAdapter(createPglite(path));
  }
  if (process.env.NODE_ENV === 'test') {
    const { PgliteAdapter, createPglite } = await import('./pglite-adapter');
    return new PgliteAdapter(createPglite());
  }
  const { PostgresAdapter } = await import('./postgres-adapter');
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return new PostgresAdapter(url);
}

export async function closeDatabase(): Promise<void> {
  const pending = _singleton.promise;
  _singleton.promise = null;
  if (!pending) return;
  try {
    const instance = await pending;
    await instance.close();
  } catch {
    // initialization had failed — nothing to close
  }
}

// For testing: reset the singleton
export function resetDatabaseInstance(): void {
  _singleton.promise = null;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/unit/db/driver-type.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/connection.ts tests/unit/db/driver-type.test.ts
git commit -m "fix(ops): DB singleton memoizes the in-flight init promise

Concurrent cold-start calls each constructed an adapter across the dynamic
import suspension (last writer wins, losers leaked pools). getDatabase now
memoizes the in-flight promise and clears it on rejection so failed init
stays retryable — the exact ensure-init.ts pattern.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C7: Lint to zero errors and zero warnings

Verified inventory (12 errors from 8 source lines + 4 warnings; CI's Lint step is currently red on all of them):

| File:line | Rule | Fix strategy |
|---|---|---|
| `AnchoredDropdown.tsx:39` | set-state-in-effect | drop the `setPos(null)` reset — render guard already hides when `!open`; layout-effect re-measure repaints before paint on reopen |
| `DraggableChips.tsx:143,144` (6 diagnostics) | refs | fold `moved` into the existing `drag` state; keep `movedRef` for event handlers only |
| `LookupAutocomplete.tsx:93,103` | set-state-in-effect | render-phase adjust for re-seeding (state compare); derive the visible list instead of clearing via effect |
| `ComplicationsTab.tsx:96` | set-state-in-effect | render-phase adjust with a `seededFor` state guard |
| `MedicationsTab.tsx:101`, `StageMedTab.tsx:115` | set-state-in-effect | same derived-list fix applied to their private LookupPickers |
| `HighRiskPatientList.tsx:236,243` | no-html-link-for-pages (warn) | `<a>` → `next/link` `<Link>` |
| `smoke-tab-update/route.ts:231`, `bms-browser-client.ts:834` | unused eslint-disable (warn) | delete the stale directives |

DRY note (deliberate, documented deviation): MedicationsTab/StageMedTab carry near-verbatim copies of LookupAutocomplete. Consolidating onto the shared component is the constitution-III end state, but it changes item shapes (`payload` vs `value`) under lint-gate work — this task applies the minimal behavioral-parity fix to all three copies and files the consolidation as an explicit follow-up (`TODO(constitution-III)` comments referencing this plan).

**Files:**
- Create: `tests/unit/components/maternity/shared/LookupAutocomplete.test.tsx`
- Modify: the 8 files in the table above

- [ ] **Step 1: Snapshot the red state**

Run: `npm run lint`
Expected: FAIL, `✖ 16 problems (12 errors, 4 warnings)`. Save the output — it is the red evidence for the whole task.

- [ ] **Step 2: Write behavioral tests for the riskiest refactor (LookupAutocomplete)**

```tsx
// tests/unit/components/maternity/shared/LookupAutocomplete.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LookupAutocomplete } from '@/components/maternity/shared/LookupAutocomplete';

// Mirror the component's actual LookupItem shape when writing these items.
const items = [{ value: '1', primary: 'Paracetamol', secondary: '500mg' }];

describe('LookupAutocomplete', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('debounces typing, then fetches and shows results', async () => {
    const fetchFn = vi.fn(async () => items);
    render(
      <LookupAutocomplete
        ariaLabel="ค้นหายา"
        placeholder="พิมพ์ชื่อยา"
        value=""
        valueLabel=""
        fetch={fetchFn}
        onPick={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('ค้นหายา'), { target: { value: 'Para' } });
    expect(fetchFn).not.toHaveBeenCalled(); // debounce window
    vi.advanceTimersByTime(350);
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('Para'));
  });

  it('re-seeds the input when the parent commits a new value', async () => {
    const { rerender } = render(
      <LookupAutocomplete
        ariaLabel="ค้นหายา" placeholder="" value="" valueLabel=""
        fetch={async () => []} onPick={() => {}}
      />,
    );
    rerender(
      <LookupAutocomplete
        ariaLabel="ค้นหายา" placeholder="" value="42" valueLabel="Paracetamol"
        fetch={async () => []} onPick={() => {}}
      />,
    );
    expect((screen.getByLabelText('ค้นหายา') as HTMLInputElement).value).toBe('Paracetamol');
  });
});
```

Run: `npx vitest run tests/unit/components/maternity/shared/LookupAutocomplete.test.tsx`
Expected: PASS against the CURRENT implementation (characterization tests locking behavior before the refactor).

- [ ] **Step 3: Fix the shared primitives**

`AnchoredDropdown.tsx` (line 39): replace the early branch body:

```ts
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      // No sync setState here (react-hooks/set-state-in-effect): the render
      // guard `if (!open || !pos) return null` hides the closed dropdown, and
      // reopening re-measures below before paint, so stale pos never shows.
      return;
    }
```

`DraggableChips.tsx`: extend the drag state and use it during render:

```ts
  const [drag, setDrag] = useState<
    { startX: number; startVal: number; preview: string; clamped: boolean; moved: boolean } | null
  >(null);
```

- `onPointerDown`: include `moved: false` in the initial `setDrag` object.
- `onPointerMove`: where it currently does `movedRef.current = true` + `setDrag(...)`, include `moved: true` in the new drag object (keep `movedRef.current = true` — handlers may read/write refs legally; only the RENDER read was illegal).
- Lines 143-144 become:
  ```ts
        drag && drag.moved && !drag.clamped && 'scale-110 shadow-lg ring-2 ring-cyan-400',
        drag && drag.moved && drag.clamped && 'scale-110 shadow-lg ring-2 ring-amber-400 cursor-not-allowed',
  ```

`LookupAutocomplete.tsx`: convert `committedRef`/`lastPickedRef` to state and derive the visible list:

```ts
  const [query, setQuery] = useState(valueLabel || value);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [lastPicked, setLastPicked] = useState(valueLabel || value);
  const [committed, setCommitted] = useState(value);

  // Render-phase adjust (react.dev "you might not need an effect"): re-seed
  // when the parent commits a new value.
  if (value !== committed) {
    setCommitted(value);
    const seed = valueLabel || value;
    setQuery(seed);
    setLastPicked(seed);
  }

  const trimmed = query.trim();
  const searchActive = trimmed.length > 0 && trimmed !== lastPicked;
  const visibleItems = searchActive ? items : []; // derived — no effect-clear needed

  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(trimmed)
        .then((rows) => { if (!cancelled) setItems(rows); })
        .catch(() => { if (!cancelled) setItems([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmed, searchActive, fetch]);
```

Update the rest of the component: render from `visibleItems`; in the pick handler replace `lastPickedRef.current = …` with `setLastPicked(…)`; delete both refs.

- [ ] **Step 4: Fix the tab pickers + warnings**

- `ComplicationsTab.tsx` (ComplicationPicker): delete the seeding effect; add above the return:
  ```ts
  const [seededFor, setSeededFor] = useState('');
  if (selectedName && selectedName !== seededFor && query === '') {
    setSeededFor(selectedName);
    setQuery(selectedName);
  }
  ```
- `MedicationsTab.tsx` + `StageMedTab.tsx` (private LookupPickers): apply the same `searchActive`/`visibleItems` derivation as LookupAutocomplete above (their effects are near-verbatim copies), and add `// TODO(constitution-III): consolidate onto shared/LookupAutocomplete — see docs/superpowers/plans/2026-07-13-robustness-c-concurrency-ops-quality.md C7`.
- `HighRiskPatientList.tsx:236-249`: `import Link from 'next/link';` and swap both `<a href="/pregnancies?…">` for `<Link href="/pregnancies?…">` (props otherwise identical).
- Delete `src/app/api/dev/smoke-tab-update/route.ts:231` and `src/lib/bms-browser-client.ts:834` (the two unused `eslint-disable` lines).

- [ ] **Step 5: Verify green everywhere**

Run: `npm run lint && npx vitest run tests/unit/components && npx tsc --noEmit`
Expected: lint exits 0 with **0 errors and 0 warnings**; all component suites pass (ComplicationsTab/MedicationsTab/StageMedTab/DischargeTab/HighRiskPatientList tests are the behavioral safety net).

- [ ] **Step 6: Commit**

```bash
git add src/components/maternity/shared src/components/maternity/tabs src/components/dashboard/HighRiskPatientList.tsx src/app/api/dev/smoke-tab-update/route.ts src/lib/bms-browser-client.ts tests/unit/components/maternity/shared
git commit -m "fix(quality): zero lint errors — react-hooks v6 compliance

Replaces sync setState-in-effect with render-phase adjusts and derived lists
(AnchoredDropdown, LookupAutocomplete, ComplicationsTab, MedicationsTab,
StageMedTab), folds the drag 'moved' flag into state instead of reading a ref
during render (DraggableChips), swaps raw <a> for next/link, and removes two
stale eslint-disable directives. CI's Lint gate is green again.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task C8: act() warning sweep + Release C verification and deployment

- [ ] **Step 1: Sweep act() warnings**

Run: `npm test 2>&1 | tee /tmp/test-output.log; grep -n "not wrapped in act" /tmp/test-output.log | sort -u`
For each unique component/test pair reported: fix the TEST (never the component) by awaiting the state settle — replace `getBy*` immediately after an interaction with `await screen.findBy*(...)`, wrap timer-driven updates in `await waitFor(...)` or advance fake timers inside `act(async () => { vi.advanceTimersByTime(n) })`. Re-run until `grep -c "not wrapped in act" /tmp/test-output.log` is 0.

- [ ] **Step 2: Full gates**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build && npx playwright test`
Expected: all green (Playwright: dashboard/admin/video-call-media specs; the media spec self-skips if jitsi1.hosxp.net is unreachable — that skip is acceptable, note it in the evidence).

- [ ] **Step 3: Commit the sweep**

```bash
git add tests/
git commit -m "test(quality): eliminate React act() warnings

Awaits state transitions and timers correctly (findBy*/waitFor/fake-timer
act blocks) so the suite runs without unhandled async updates.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Deploy Release C (requires operator approval)**

```bash
docker tag $(docker compose images -q app) kk-lrms-app:rollback-$(date +%F)-release-c || true
git push origin main
npm run deploy
docker compose ps   # app should reach status "healthy" via the new healthcheck
```

- [ ] **Step 5: Controlled Redis outage drill (Release C stop condition)**

```bash
BASE=https://kk-lrms.bmscloud.in.th
curl -s $BASE/api/health | python3 -m json.tool          # baseline: cache.backend=redis
docker compose stop redis
sleep 10
curl -s $BASE/api/health | python3 -m json.tool          # expect status=degraded, cache.degraded=true, degradedReasons includes redis_unavailable
docker compose start redis
sleep 40                                                  # one backoff window
curl -s $BASE/api/health | python3 -m json.tool          # expect cache.backend=redis, degraded=false — WITHOUT app restart
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/health/ready   # expect 200
```

**Stop condition:** if the app does not return to `cache.backend=redis` without a restart, or degraded state was not reported during the outage, halt and investigate before sign-off. Record all four curl outputs as the release evidence. Finally, re-run `./scripts/verify-release-a.sh $BASE` to confirm Release A guarantees still hold, and record the complete evidence set (probe outputs, rollback tags, healthcheck status) per the spec's release checklist.
