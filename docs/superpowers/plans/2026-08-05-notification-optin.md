# Self-Service Notification Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each hospital user opt in/out of receiving MOPH Prompt (LINE) HIGH/EMERGENCY risk alerts, so only users who explicitly enable delivery receive them.

**Architecture:** Add a `notification_preferences` table keyed by `(user_cid, hospital_code)` carrying one `moph_line_enabled` boolean (Default OFF). Gate the existing admin-driven `resolveRecipients` through this table and merge authoritative self-subscribers. Surface a profile page (TopNavBar entry) reading/writing your own preference via a session-gated API route.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Postgres 16 (schema-sync DDL), Vitest (PGlite in-memory via `createTestDb()`), existing `pii-mask` (maskName/maskCid), existing `moph-alert-config`.

## Global Constraints

- **PDPA:** no plaintext name/CID stored in `notification_preferences`; profile page displays via `maskName`/`maskCid` only.
- **DB placeholders:** codebase canonicalizes on `?` placeholders (adapters rewrite `?` → `$N`). Never hand-write `$N` in service SQL.
- **No hardcoded conditions:** thresholds/URLs/toggles come from `src/config/*` or env, never literals in services/routes.
- **Constitution §V:** every user-facing op shows progress + actionable Thai errors.
- **TDD strict:** write the failing test first, run RED, implement, run GREEN, commit. Never bypass a failure.
- **CSRF:** every new mutation route must be added to `src/config/mutation-route-policy.ts` (`session-origin-checked`).
- **`?`-placeholder rule applies to ALL service SQL** in this plan (context-builder already confirms the pattern).
- Commands run from repo root `/home/manoi/docker/kk-lrms`.

---

## File Structure

- `src/db/tables/notification-preferences.ts` — new table definition (schema-sync DDL).
- `src/db/tables/index.ts` — register the table (both schema + reindex/seed arrays).
- `src/services/notification-preference.ts` — NEW service: preference get/upsert/subscribed-cids (pure service layer, no route).
- `src/services/risk-alert.ts` — gate `resolveRecipients` through preferences + merge self-subscribers (hospital_code resolution added).
- `src/app/api/profile/notification-preference/route.ts` — NEW session-gated GET/PUT.
- `src/config/mutation-route-policy.ts` — add the route as `session-origin-checked`.
- `src/app/(hospital)/profile/page.tsx` — NEW profile page (session-gated by (hospital) layout).
- `src/components/profile/NotificationPreferenceCard.tsx` — NEW client toggle card (Thai, optimistic + revert).
- `src/components/layout/TopNavBar.tsx` — add a user-area menu with a "การตั้งค่าการแจ้งเตือน" link (hospital variant).
- Tests:
  - `tests/unit/db/notification-preferences-table.test.ts`
  - `tests/unit/services/notification-preference.test.ts`
  - `tests/unit/services/risk-alert.test.ts` (extend existing — it already seeds consult doctors + monitors)
  - `tests/unit/api/profile-notification-preference.test.ts`
  - `tests/integration/profile-page.test.tsx`

---

## Task 1: `notification_preferences` table + registration

**Files:**
- Create: `src/db/tables/notification-preferences.ts`
- Modify: `src/db/tables/index.ts` (import + add to both exported arrays)
- Test: `tests/unit/db/notification-preferences-table.test.ts`

**Interfaces:**
- Consumes: `TableDefinition` from `../table-definition` (see any sibling, e.g. `hospital-consult-doctors.ts`).
- Produces: `notificationPreferencesTable: TableDefinition` — later tasks rely on the table existing via schema-sync; no direct import.

- [ ] **Step 1: Write the failing table test**

```ts
// tests/unit/db/notification-preferences-table.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';

let db: DatabaseAdapter;
process.env.ENCRYPTION_KEY = generateKey();

describe('notification_preferences table', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.close?.();
  });

  it('is created by schema sync with the opt-in columns + unique (user_cid, hospital_code)', async () => {
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO notification_preferences
         (id, user_cid, hospital_code, moph_line_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['n1', '3320500282121', '10670', true, now, now],
    );
    await db.execute(
      `INSERT INTO notification_preferences
         (id, user_cid, hospital_code, moph_line_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['n2', '3320500282128', '10671', false, now, now],
    );
    const rows = await db.query<{ user_cid: string; moph_line_enabled: boolean }>(
      `SELECT user_cid, moph_line_enabled FROM notification_preferences ORDER BY user_cid`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_cid: '3320500282121', moph_line_enabled: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db/notification-preferences-table.test.ts`
Expected: FAIL — `relation "notification_preferences" does not exist`.

- [ ] **Step 3: Create the table definition**

```ts
// src/db/tables/notification-preferences.ts
// Per-user MOPH LINE risk-alert opt-in (spec 2026-08-05-notification-optin-design).
// PDPA-safe: no plaintext name/full CID — only the 13-digit CID that maps to
// recipient_cid, scoped to the hospital the user belongs to.
import type { TableDefinition } from '../table-definition';

export const notificationPreferencesTable: TableDefinition = {
  name: 'notification_preferences',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'user_cid', type: 'string', maxLength: 13 },
    { name: 'hospital_code', type: 'string', maxLength: 10 },
    { name: 'moph_line_enabled', type: 'boolean', defaultValue: true },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_np_unique_user_hospital', columns: ['user_cid', 'hospital_code'], unique: true },
    { name: 'idx_np_hospital_enabled', columns: ['hospital_code', 'moph_line_enabled'] },
  ],
};
```

- [ ] **Step 4: Register in `src/db/tables/index.ts`**

Add to the imports and to BOTH arrays the file exports (the sibling `mophCenterMonitorsTable` is registered in two places — the schema array and the secondary/seed array; mirror it exactly):

```ts
import { notificationPreferencesTable } from './notification-preferences';
// ...in the schema tables array:
notificationPreferencesTable,
// ...in the secondary array (matching where mophCenterMonitorsTable appears):
notificationPreferencesTable,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/db/notification-preferences-table.test.ts`
Expected: PASS (2 rows returned, no relation error).

- [ ] **Step 6: Full check + commit**

Run: `npx tsc --noEmit && npx eslint src/db/tables/notification-preferences.ts src/db/tables/index.ts tests/unit/db/notification-preferences-table.test.ts`
Then:
```bash
git add src/db/tables/notification-preferences.ts src/db/tables/index.ts tests/unit/db/notification-preferences-table.test.ts
git commit -m "feat(notifications): notification_preferences table (schema-sync)"
```

---

## Task 2: notification-preference service layer

**Files:**
- Create: `src/services/notification-preference.ts`
- Test: `tests/unit/services/notification-preference.test.ts`

**Interfaces:**
- Consumes: `DatabaseAdapter`, `createTestDb()`.
- Produces (used by Task 3 router and Task 4 API):
  - `interface NotificationPreference { userCid: string; hospitalCode: string; mophLineEnabled: boolean; }`
  - `getNotificationPreference(db, userCid, hospitalCode): Promise<NotificationPreference | null>` (null = not subscribed / Default OFF)
  - `upsertNotificationPreference(db, userCid, hospitalCode, enabled): Promise<NotificationPreference>`
  - `enabledSubscriberCids(db, hospitalCode): Promise<{ cid: string }[]>` — CIDs with moph_line_enabled=true for the hospital (self-subscribers + opted-in staff)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/services/notification-preference.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import {
  getNotificationPreference,
  upsertNotificationPreference,
  enabledSubscriberCids,
} from '@/services/notification-preference';

let db: DatabaseAdapter;
process.env.ENCRYPTION_KEY = generateKey();

describe('notification-preference service', () => {
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.close?.();
  });

  it('get returns null when no row (Default OFF)', async () => {
    const p = await getNotificationPreference(db, '3320500282121', '10670');
    expect(p).toBeNull();
  });

  it('upsert creates then updates the row (idempotent by (cid,hcode))', async () => {
    const created = await upsertNotificationPreference(db, '3320500282121', '10670', true);
    expect(created.mophLineEnabled).toBe(true);
    const updated = await upsertNotificationPreference(db, '3320500282121', '10670', false);
    expect(updated.mophLineEnabled).toBe(false);
    const rows = await db.query<{ user_cid: string }>(
      `SELECT user_cid FROM notification_preferences WHERE user_cid = ?`,
      ['3320500282121'],
    );
    expect(rows).toHaveLength(1);
  });

  it('enabledSubscriberCids returns only enabled rows for the hospital', async () => {
    await upsertNotificationPreference(db, '3320500282121', '10670', true);
    await upsertNotificationPreference(db, '1111111111112', '10670', false);
    await upsertNotificationPreference(db, '3333333333334', '99999', true); // other hospital
    const cids = await enabledSubscriberCids(db, '10670');
    expect(cids.map((c) => c.cid)).toEqual(['3320500282121']);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/unit/services/notification-preference.test.ts`
Expected: FAIL — cannot resolve module `@/services/notification-preference`.

- [ ] **Step 3: Implement the service**

```ts
// src/services/notification-preference.ts
// Per-user MOPH LINE alert opt-in (spec 2026-08-05-notification-optin-design).
// Default OFF: absence of a row = not receiving. Self-subscribe is
// authoritative (bypasses admin lists). PDPA-safe: CID only.
import type { DatabaseAdapter } from '@/db/adapter';

export interface NotificationPreference {
  userCid: string;
  hospitalCode: string;
  mophLineEnabled: boolean;
}

function rowToPref(r: {
  user_cid: string;
  hospital_code: string;
  moph_line_enabled: boolean;
}): NotificationPreference {
  return { userCid: r.user_cid, hospitalCode: r.hospital_code, mophLineEnabled: r.moph_line_enabled };
}

export async function getNotificationPreference(
  db: DatabaseAdapter,
  userCid: string,
  hospitalCode: string,
): Promise<NotificationPreference | null> {
  const rows = await db.query<{
    user_cid: string;
    hospital_code: string;
    moph_line_enabled: boolean;
  }>(
    `SELECT user_cid, hospital_code, moph_line_enabled
     FROM notification_preferences
     WHERE user_cid = ? AND hospital_code = ?`,
    [userCid, hospitalCode],
  );
  return rows[0] ? rowToPref(rows[0]) : null;
}

export async function upsertNotificationPreference(
  db: DatabaseAdapter,
  userCid: string,
  hospitalCode: string,
  enabled: boolean,
): Promise<NotificationPreference> {
  const now = new Date().toISOString();
  const existing = await getNotificationPreference(db, userCid, hospitalCode);
  if (existing) {
    await db.execute(
      `UPDATE notification_preferences SET moph_line_enabled = ?, updated_at = ?
       WHERE user_cid = ? AND hospital_code = ?`,
      [enabled, now, userCid, hospitalCode],
    );
    return { userCid, hospitalCode, mophLineEnabled: enabled };
  }
  const { randomUUID } = await import('crypto');
  await db.execute(
    `INSERT INTO notification_preferences
       (id, user_cid, hospital_code, moph_line_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), userCid, hospitalCode, enabled, now, now],
  );
  return { userCid, hospitalCode, mophLineEnabled: enabled };
}

export async function enabledSubscriberCids(
  db: DatabaseAdapter,
  hospitalCode: string,
): Promise<{ cid: string }[]> {
  return db.query<{ cid: string }>(
    `SELECT user_cid AS cid FROM notification_preferences
     WHERE hospital_code = ? AND moph_line_enabled = true`,
    [hospitalCode],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/notification-preference.test.ts`
Expected: PASS.

- [ ] **Step 5: tsc/lint + commit**

Run: `npx tsc --noEmit && npx eslint src/services/notification-preference.ts tests/unit/services/notification-preference.test.ts`
```bash
git add src/services/notification-preference.ts tests/unit/services/notification-preference.test.ts
git commit -m "feat(notifications): notification-preference service (get/upsert/subscribers)"
```

---

## Task 3: gate `resolveRecipients` through preferences + self-subscribers

**Files:**
- Modify: `src/services/risk-alert.ts` (resolveRecipients + hospital-code resolution)
- Test: `tests/unit/services/risk-alert.test.ts` (extend existing file — it already seeds consult doctors + monitors)

**Interfaces:**
- Consumes: `enabledSubscriberCids(db, hospitalCode)` from Task 2.
- Produces: unchanged public API (`enqueueHighRiskAlert`, `enqueueEmergencyAlert`) — behavior change only. `resolveRecipients` internally resolves `hospitalCode` from `hospitalId` via the hospitals table if not passed (callers currently only pass `hospitalId` + `province`).

- [ ] **Step 1: Write the failing opt-in tests** (append to `tests/unit/services/risk-alert.test.ts`)

Read the existing file first to learn: the hospital hcode seeded in `beforeEach` (use it as `HOSPITAL_HCODE`), the `AlertEventContext` fixture the sibling tests pass (copy it as `ctxFixture()`), and import `upsertNotificationPreference` from Task 2.

```ts
describe('risk-alert recipient opt-in (notification_preferences gate)', () => {
  it('Default OFF: a seeded consult doctor with no pref row is NOT a recipient', async () => {
    await enqueueHighRiskAlert(db, ctxFixture());
    const rows = await db.query<{ id: string }>(`SELECT id FROM moph_alert_log`);
    expect(rows).toHaveLength(0);
  });

  it('enabled pref row for an admin-listed CID becomes a recipient', async () => {
    await upsertNotificationPreference(db, '3320500282121', HOSPITAL_HCODE, true);
    await enqueueHighRiskAlert(db, ctxFixture());
    const rows = await db.query<{ recipient_cid: string }>(
      `SELECT recipient_cid FROM moph_alert_log`,
    );
    expect(rows.map((r) => r.recipient_cid)).toContain('3320500282121');
  });

  it('self-subscriber (enabled row, not admin-listed) is a recipient (authoritative)', async () => {
    await upsertNotificationPreference(db, '5555555555555', HOSPITAL_HCODE, true);
    await enqueueHighRiskAlert(db, ctxFixture());
    const rows = await db.query<{ recipient_cid: string }>(
      `SELECT recipient_cid FROM moph_alert_log`,
    );
    expect(rows.map((r) => r.recipient_cid)).toContain('5555555555555');
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/unit/services/risk-alert.test.ts`
Expected: First new test FAILS (currently enqueues rows with Default-ON semantics).

- [ ] **Step 3: Modify `resolveRecipients`** in `src/services/risk-alert.ts`

Keep the existing `staff`/`center` candidate queries and the `Recipient`/`isValidCid` helpers unchanged. Replace the current "filter invalid CIDs + return" tail with the opt-in gate:

```ts
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
  // ...existing staff + center queries build `all: Recipient[]`...

  // Default OFF: admin-listed CIDs ONLY deliver when they have an enabled pref
  // row; PLUS authoritative self-subscribers (pref rows not on any admin list).
  const enabled = new Set((await enabledSubscriberCids(db, hospitalCode)).map((r) => r.cid));
  const allowed: Recipient[] = all.filter((r) => enabled.has(r.cid));
  for (const cid of enabled) {
    if (!all.some((r) => r.cid === cid)) {
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
```
> `Recipient`/`isValidCid`/`logger` already exist in the file. Read the actual current `resolveRecipients` body before editing — keep its staff/center queries intact; only change the tail that currently validates `all` and returns, to instead apply the `enabled` gate.

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/unit/services/risk-alert.test.ts`
Expected: all existing tests + the 3 new pass. Existing tests that currently assert Default-ON delivery must seed an enabled pref row for the seeded CIDs in their setup — update them to uphold the new contract (don't weaken assertions; a seeded admin-listed CID only delivers when opted in).

- [ ] **Step 5: tsc/lint + commit**

Run: `npx tsc --noEmit && npx eslint src/services/risk-alert.ts tests/unit/services/risk-alert.test.ts`
```bash
git add src/services/risk-alert.ts tests/unit/services/risk-alert.test.ts
git commit -m "feat(notifications): gate MOPH recipients through per-user opt-in (Default OFF)"
```

---

## Task 4: API route GET/PUT + CSRF manifest

**Files:**
- Create: `src/app/api/profile/notification-preference/route.ts`
- Modify: `src/config/mutation-route-policy.ts`
- Test: `tests/unit/api/profile-notification-preference.test.ts`

**Interfaces:**
- Consumes: `auth()` from `@/lib/auth`, `getDatabase()` from `@/db/connection`, `ensureInit()` from `@/lib/ensure-init`, `getNotificationPreference`/`upsertNotificationPreference` (Task 2), `testSessionUser` helper.
- Produces: `GET`/`PUT` handlers (Next.js route); body `{ mophLineEnabled: boolean }`; response `{ userCid, hospitalCode, mophLineEnabled }`.

- [ ] **Step 1: Write the failing API test**

```ts
// tests/unit/api/profile-notification-preference.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { generateKey } from '@/lib/encryption';
import { testSessionUser } from '../../helpers/session';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? generateKey();

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { GET, PUT } from '@/app/api/profile/notification-preference/route';

function req(method: string, body?: unknown): Request {
  return new Request('http://test/api/profile/notification-preference', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('GET/PUT /api/profile/notification-preference', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = testSessionUser({ hospitalCode: '10670' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET 401 when anonymous', async () => {
    mockSessionUser = null;
    const res = await GET(req('GET') as never);
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('GET 200 with mophLineEnabled=false when no row (Default OFF)', async () => {
    const res = await GET(req('GET') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      userCid: '1100500090006', // testSessionUser default userCid
      hospitalCode: '10670',
      mophLineEnabled: false,
    });
  });

  it('PUT upserts from session identity (body cannot set CID)', async () => {
    const res = await PUT(req('PUT', { mophLineEnabled: true }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      userCid: '1100500090006',
      hospitalCode: '10670',
      mophLineEnabled: true,
    });
    const rows = await db.query<{ user_cid: string }>(
      'SELECT user_cid FROM notification_preferences',
    );
    expect(rows[0].user_cid).toBe('1100500090006');
  });

  it('PUT 400 on non-boolean body and 401 when anonymous', async () => {
    const bad = await PUT(req('PUT', { mophLineEnabled: 'yes' }) as never);
    expect(bad.status).toBe(400);
    mockSessionUser = null;
    const anon = await PUT(req('PUT', { mophLineEnabled: true }) as never);
    expect(anon.status).toBeGreaterThanOrEqual(401);
  });
});
```
> `testSessionUser()` default `userCid` is `'1100500090006'` (see `tests/helpers/session.ts`). Mirror the mock/lifecycle pattern exactly.

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/unit/api/profile-notification-preference.test.ts`
Expected: FAIL — cannot resolve module `@/app/api/profile/notification-preference/route`.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/profile/notification-preference/route.ts
// Session-gated per-user MOPH LINE opt-in (spec 2026-08-05-notification-optin).
// Identity comes from the session (userCid + hospitalCode) — the body can only
// set the boolean, never the CID, so no cross-account tampering.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import {
  getNotificationPreference,
  upsertNotificationPreference,
} from '@/services/notification-preference';

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userCid = String(session.user.userCid ?? '');
  const hospitalCode = String(session.user.hospitalCode ?? '');
  await ensureInit();
  const db = await getDatabase();
  const pref = await getNotificationPreference(db, userCid, hospitalCode);
  return NextResponse.json({
    userCid,
    hospitalCode,
    mophLineEnabled: pref?.mophLineEnabled ?? false,
  });
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userCid = String(session.user.userCid ?? '');
  const hospitalCode = String(session.user.hospitalCode ?? '');
  let body: { mophLineEnabled?: unknown };
  try {
    body = (await request.json()) as { mophLineEnabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (typeof body.mophLineEnabled !== 'boolean') {
    return NextResponse.json({ error: 'mophLineEnabled boolean required' }, { status: 400 });
  }
  await ensureInit();
  const db = await getDatabase();
  const saved = await upsertNotificationPreference(
    db,
    userCid,
    hospitalCode,
    body.mophLineEnabled,
  );
  return NextResponse.json({
    userCid: saved.userCid,
    hospitalCode: saved.hospitalCode,
    mophLineEnabled: saved.mophLineEnabled,
  });
}
```

- [ ] **Step 4: Add CSRF manifest entry** in `src/config/mutation-route-policy.ts`

Add a line (near the hospital routes):
```ts
'src/app/api/profile/notification-preference/route.ts': 'session-origin-checked',
```

- [ ] **Step 5: Run tests + manifest test + tsc/lint**

Run: `npx vitest run tests/unit/api/profile-notification-preference.test.ts tests/unit/security/mutation-route-manifest.test.ts`
Expected: PASS (route tests green; manifest test green — added above).

Run: `npx tsc --noEmit && npx eslint src/app/api/profile/notification-preference/route.ts src/config/mutation-route-policy.ts tests/unit/api/profile-notification-preference.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/profile/notification-preference/route.ts src/config/mutation-route-policy.ts tests/unit/api/profile-notification-preference.test.ts
git commit -m "feat(notifications): session-gated profile notification-preference API + CSRF entry"
```

---

## Task 5: Profile page UI + TopNavBar entry

**Files:**
- Create: `src/app/(hospital)/profile/page.tsx` (server component; (hospital) layout already session-gated)
- Create: `src/components/profile/NotificationPreferenceCard.tsx` (client component)
- Modify: `src/components/layout/TopNavBar.tsx` (user-area link, hospital variant)
- Test: `tests/integration/profile-page.test.tsx`

**Interfaces:**
- Consumes: `auth()` server-side for the masked identity header; `maskName`/`maskCid` from `@/lib/pii-mask`; the API route from Task 4.
- Produces: a Thai profile page rendering masked identity + one MOPH LINE toggle; a TopNavBar anchor to it.

- [ ] **Step 1: Write the failing integration test** (mirror `tests/integration/hospital-maternity-ward-page.test.tsx` harness)

```tsx
// tests/integration/profile-page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePage } from '@/app/(hospital)/profile/page';

vi.mock('@/lib/auth', () => ({
  auth: async () => ({
    user: {
      name: 'นาย ชัยพร สุรเตมีย์กุล',
      userCid: '3320500282121',
      hospitalCode: '10670',
      hospitalName: 'รพ.ทดสอบ',
      role: 'NURSE',
    },
  }),
}));

const fetched = vi.fn(async (_url: string, init?: { body?: string }) => ({
  ok: true,
  async json() {
    return init?.body?.includes('"mophLineEnabled":true')
      ? { userCid: '3320500282121', hospitalCode: '10670', mophLineEnabled: true }
      : { userCid: '3320500282121', hospitalCode: '10670', mophLineEnabled: false };
  },
}));
vi.stubGlobal('fetch', fetched);

describe('profile notification page', () => {
  it('renders masked identity + toggle and flips on click', async () => {
    render(<ProfilePage />);
    // masked CID: first char + 8 X + last 4
    await screen.findByText(/3X{8}2121/);
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveProperty('aria-checked', false);
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveProperty('aria-checked', true));
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/integration/profile-page.test.tsx`
Expected: FAIL — cannot resolve the page module.

- [ ] **Step 3: Implement the page + client card**

```tsx
// src/app/(hospital)/profile/page.tsx  (server component; layout already auth-gated)
import { auth } from '@/lib/auth';
import { maskName, maskCid } from '@/lib/pii-mask';
import { NotificationPreferenceCard } from '@/components/profile/NotificationPreferenceCard';

export default async function ProfilePage() {
  const session = await auth();
  const user = session?.user;
  const displayName = maskName(user?.name);
  const displayCid = maskCid(user?.userCid);
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">โปรไฟล์และการแจ้งเตือน</h1>
      <section className="rounded-2xl border border-slate-200 p-4">
        <p className="text-sm text-slate-500">{user?.hospitalName ?? ''}</p>
        <p className="text-base font-medium">{displayName}</p>
        <p className="text-xs text-slate-400">CID {displayCid}</p>
      </section>
      <NotificationPreferenceCard />
    </main>
  );
}
```

```tsx
// src/components/profile/NotificationPreferenceCard.tsx ('use client')
// Single MOPH LINE opt-in toggle (spec 2026-08-05). Optimistic with revert on
// error; actionable Thai error (constitution §V).
'use client';
import { useEffect, useState } from 'react';

export function NotificationPreferenceCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/profile/notification-preference')
      .then((r) => {
        if (!r.ok) throw new Error('http');
        return r.json() as Promise<{ mophLineEnabled: boolean }>;
      })
      .then((b) => setEnabled(b.mophLineEnabled))
      .catch(() => setError('โหลดการตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง'));
  }, []);

  async function toggle() {
    if (enabled === null || busy) return;
    const previous = enabled;
    const next = !enabled;
    setEnabled(next);
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/profile/notification-preference', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mophLineEnabled: next }),
      });
      if (!res.ok) throw new Error('http');
      const body = (await res.json()) as { mophLineEnabled: boolean };
      setEnabled(body.mophLineEnabled);
    } catch {
      setEnabled(previous); // optimistic revert
      setError('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">รับการแจ้งเตือน MOPH ทาง LINE</p>
          <p className="text-xs text-slate-500">ผู้ป่วยเสี่ยงสูง / ฉุกเฉิน</p>
        </div>
        <button
          role="switch"
          aria-checked={enabled === true}
          disabled={enabled === null || busy}
          onClick={() => void toggle()}
          className={`relative h-7 w-14 rounded-full transition ${enabled ? 'bg-teal-600' : 'bg-slate-300'}`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
              enabled ? 'left-8' : 'left-1'
            }`}
          />
        </button>
      </div>
      {busy && <p className="mt-2 text-xs text-slate-500">กำลังบันทึก…</p>}
      {error && (
        <p className="mt-2 text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add TopNavBar entry** (modify `src/components/layout/TopNavBar.tsx`)

In the right-hand identity area, add a small link (mirror existing link styling; keep the compact navy-bar height):
```tsx
<Link href="/profile" className="...">
  การตั้งค่าการแจ้งเตือน
</Link>
```

- [ ] **Step 5: Run tests + tsc/lint**

Run: `npx vitest run tests/integration/profile-page.test.tsx`
Expected: PASS (toggle renders + flips; masked CID regex matches `3` + 8 X + `2121`).

Run: `npx tsc --noEmit && npx eslint "src/app/(hospital)/profile/page.tsx" src/components/profile/NotificationPreferenceCard.tsx src/components/layout/TopNavBar.tsx tests/integration/profile-page.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add "src/app/(hospital)/profile/page.tsx" src/components/profile/NotificationPreferenceCard.tsx src/components/layout/TopNavBar.tsx tests/integration/profile-page.test.tsx
git commit -m "feat(notifications): profile page + TopNavBar entry for MOPH LINE opt-in"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Full suite + lint + tsc**

Run: `npx tsc --noEmit && npm run lint && npm test > /tmp/optin-final.log 2>&1; echo EXIT=$? >> /tmp/optin-final.log`
Expected: 0 test failures (only the known pre-existing vitest worker-crash "1 error" may remain; do not suppress it).

- [ ] **Step 2: Self-review against spec**

- Spec "Default OFF": covered by Task 3 (no-pref → excluded) + Task 2 (get returns null).
- Spec "authoritative self-subscribe": covered by Task 3 (enabled subscriber not on admin list → `self_subscribed` recipient).
- Spec "PDPA (no plaintext name/CID stored)": covered — table stores CID only; UI masks.
- Spec "profile page + TopNavBar entry": covered by Task 5.
- Spec "API session identity, body can't set CID": covered by Task 4 + test.
- Spec "CSRF manifest": covered by Task 4.
- Spec "silence risk release note": NOT code — include in the PR/commit description (after deploy no one receives until they opt in).

- [ ] **Step 3: Commit any leftover**

```bash
git add -A && git commit -m "chore(notifications): final lint/test alignment"
```
