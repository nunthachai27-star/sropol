# Release A — Security Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-07-13-robustness-00-overview.md` first for program context and recon corrections.

**Goal:** Close every P0 access path: production data-wipe routes fail closed, admin access fails closed, cookie-auth mutations get CSRF origin validation, referral APIs (session + webhook) enforce hospital tenancy, and the public CID PHI oracle is removed.

**Architecture:** Handler-level guards are the primary authorization control (middleware stays as defense in depth). All guards follow the existing `requireAdmin(): Promise<Session | NextResponse>` shape. Destructive wipes become transactional via `DatabaseAdapter.transaction()`. Error bodies follow the repo's two conventions: `apiError()` from `src/lib/api-errors.ts` for webhook/public APIs, inline `{ error: { code, message, details } }` for session referral routes.

**Tech Stack:** Next.js 15 App Router route handlers, NextAuth v5 (`auth()` from `@/lib/auth`), PGlite test harness, Vitest 4.

## Global Constraints

- TDD is non-negotiable (constitution II): every task writes its failing test first and records the red output before fixing.
- SQL uses `?` placeholders (adapters rewrite to `$N`). `db.execute()` returns `void`; row-count checks need `db.query('… RETURNING id')`.
- Never import `@/lib/auth` (Node) from `src/middleware.ts` (Edge). Edge-safe modules: `admin-access.ts`, `security-headers.ts`, `logger.ts`, and the new `request-origin.ts`.
- Error messages must be actionable Thai (constitution V). New public-API error codes go into the `ApiErrors` table in `src/lib/api-errors.ts`, never inlined.
- Do NOT tighten `frame-ancestors *` / add X-Frame-Options in `src/lib/security-headers.ts` — cross-origin iframe embedding is a product requirement pinned by `tests/unit/middleware-headers.test.ts`.
- Route-handler unit tests use the three-mock preamble (mocks BEFORE route import):
  ```ts
  let db: DatabaseAdapter;
  let mockSessionUser: Record<string, unknown> | null = null;
  vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
  vi.mock('@/lib/auth', () => ({ auth: async () => (mockSessionUser ? { user: mockSessionUser } : null) }));
  vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));
  ```
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- After each task: `npx tsc --noEmit` must pass. `npm run lint` has 12 pre-existing errors until Release C task C7 — do not add new ones (run `npx eslint <changed files>` per task).

---

### Task A1: Fail-closed simulation flag + production compose default (EMERGENCY CONTAINMENT)

This task alone closes the confirmed production data-wipe exposure and may be deployed ahead of the rest of Release A.

**Files:**
- Modify: `docker-compose.yml:55` (the `DEV_SIMULATION_ENABLED` default)
- Modify: `src/lib/feature-flags.ts:18-23`
- Modify: `src/middleware.ts:42-44` (stale comment only)
- Create: `tests/unit/lib/feature-flags.test.ts`

**Interfaces:**
- Produces: `isSimulationEnabled(): boolean` — unchanged signature, new semantics: **always `false` when `NODE_ENV === 'production'`, no env override**. Outside production: enabled unless `DEV_SIMULATION_ENABLED === 'false'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/feature-flags.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isSimulationEnabled } from '@/lib/feature-flags';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isSimulationEnabled', () => {
  it('is ALWAYS false in production, even when the flag says true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_SIMULATION_ENABLED', 'true');
    expect(isSimulationEnabled()).toBe(false);
  });

  it('is false in production with the flag unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_SIMULATION_ENABLED', '');
    expect(isSimulationEnabled()).toBe(false);
  });

  it('defaults to enabled outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_SIMULATION_ENABLED', '');
    expect(isSimulationEnabled()).toBe(true);
  });

  it('can be explicitly disabled outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_SIMULATION_ENABLED', 'false');
    expect(isSimulationEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/feature-flags.test.ts`
Expected: FAIL — first test gets `true` (the `flag === 'true'` branch currently wins over NODE_ENV).

- [ ] **Step 3: Implement the fail-closed flag**

Replace the function body in `src/lib/feature-flags.ts` (keep the file header; rewrite the doc comment so it no longer claims the prod override is intentional):

```ts
/**
 * Destructive dev-simulation surface (/api/dev/simulate/*).
 *
 * FAIL CLOSED: never enabled in production, regardless of environment
 * variables — these routes wipe clinical tables. Outside production the
 * simulation is on by default and can be turned off with
 * DEV_SIMULATION_ENABLED=false.
 */
export function isSimulationEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.DEV_SIMULATION_ENABLED !== 'false';
}
```

- [ ] **Step 4: Flip the compose default**

In `docker-compose.yml` line 55 change:

```yaml
      DEV_SIMULATION_ENABLED: ${DEV_SIMULATION_ENABLED:-true}
```

to:

```yaml
      DEV_SIMULATION_ENABLED: ${DEV_SIMULATION_ENABLED:-false}
```

(The code change in Step 3 already makes the flag inert in production; the compose flip removes the misleading default and protects any future non-prod compose reuse.)

- [ ] **Step 5: Fix the stale middleware comment**

In `src/middleware.ts` lines 42-44 replace the comment above `DEV_ONLY_API_PATHS` with:

```ts
// Dev-only API routes. In production isSimulationEnabled() is hard-false and
// every handler 404s via simulationGuard(); this unauthenticated middleware
// bypass additionally only applies when NODE_ENV !== 'production'.
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/lib/feature-flags.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/feature-flags.ts docker-compose.yml src/middleware.ts tests/unit/lib/feature-flags.test.ts
git commit -m "fix(security): simulation routes fail closed in production

DEV_SIMULATION_ENABLED defaulted to true in the production compose file and
isSimulationEnabled() let the flag override NODE_ENV, leaving the
/api/dev/simulate/* data-wipe routes reachable by any authenticated user in
prod. The flag is now hard-false in production and the compose default is
flipped. Emergency containment per docs/imorovement-2026-07-13.md.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Deploy note (containment gate):** this commit may be deployed immediately after review: tag current image `rollback-$(date +%F)-a1`, run `npm run deploy`, then `curl -s -o /dev/null -w '%{http_code}' -X POST https://kk-lrms.bmscloud.in.th/api/dev/simulate/clear` — any non-2xx (302/404) is acceptable; 200 is a stop-ship failure.

---

### Task A2: Admin authorization on all simulation routes + shared session test helper

**Files:**
- Create: `tests/helpers/session.ts`
- Create: `tests/unit/api/dev-simulate-guard.test.ts`
- Modify: `src/app/api/dev/simulate/_guard.ts` (whole file, 11 lines)
- Modify: all 8 route files under `src/app/api/dev/simulate/` — `clear/route.ts`, `reset-onboarding/route.ts`, `start/route.ts`, `stop/route.ts`, `status/route.ts`, `inspect/route.ts`, `models/route.ts`, `smoke/route.ts` (guard call site only)
- Modify: `src/middleware.ts:35-41` (add `/api/dev` to `READONLY_BLOCKED_API_PREFIXES`)

**Interfaces:**
- Consumes: `requireAdmin(): Promise<Session | NextResponse>` from `@/lib/admin-guard`; `isSimulationEnabled()` from Task A1.
- Produces: `simulationGuard(): Promise<Session | NextResponse>` (was sync `NextResponse | null`) — returns 404 when simulation disabled, else delegates to `requireAdmin()`. Call sites become `const guard = await simulationGuard(); if (guard instanceof NextResponse) return guard;` and may use `guard` as the admin `Session` (Task A3 needs it).
- Produces: `testSessionUser(input)` in `tests/helpers/session.ts` — correctly-typed session-user fabricator (existing tests use invalid literals like `role: 'user'`, `accessMode: 'full'` that silently pass accessMode gates).

- [ ] **Step 1: Create the typed session helper**

```ts
// tests/helpers/session.ts
import { UserRole } from '@/types/domain';

/**
 * Session-user fabricator with REAL domain values. Never use ad-hoc literals
 * like role: 'user' or accessMode: 'full' — they are outside the type domain
 * and silently pass accessMode/role gates, masking authorization regressions.
 */
export function testSessionUser(input: {
  hospitalCode: string;
  id?: string;
  name?: string;
  userCid?: string;
  role?: UserRole;
  hospitalName?: string;
  accessMode?: 'readwrite' | 'readonly';
}) {
  return {
    id: input.id ?? `u-${input.hospitalCode}`,
    name: input.name ?? 'พว.ทดสอบ ระบบ',
    userCid: input.userCid ?? '1100500090006',
    role: input.role ?? UserRole.NURSE,
    hospitalCode: input.hospitalCode,
    hospitalName: input.hospitalName ?? `รพ.${input.hospitalCode}`,
    tunnelUrl: '',
    databaseType: '',
    authProvider: 'bms' as const,
    accessMode: input.accessMode ?? ('readwrite' as const),
  };
}
```

- [ ] **Step 2: Write the failing route-authorization tests**

```ts
// tests/unit/api/dev-simulate-guard.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { UserRole } from '@/types/domain';
import { testSessionUser } from '../../helpers/session';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({ auth: async () => (mockSessionUser ? { user: mockSessionUser } : null) }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST as clearRoute } from '@/app/api/dev/simulate/clear/route';

describe('simulation route authorization', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = null;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_SIMULATION_ENABLED', 'true');
    vi.stubEnv('ADMIN_ALLOWED_CIDS', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('404s under production defaults regardless of session', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const res = await clearRoute();
    expect(res.status).toBe(404);
  });

  it('401s without a session even when simulation is enabled', async () => {
    const res = await clearRoute();
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin session', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.NURSE });
    const res = await clearRoute();
    expect(res.status).toBe(403);
  });

  it('403s for a readonly session even with the ADMIN role', async () => {
    mockSessionUser = testSessionUser({
      hospitalCode: '10670',
      role: UserRole.ADMIN,
      accessMode: 'readonly',
    });
    const res = await clearRoute();
    expect(res.status).toBe(403);
  });

  it('allows an admin readwrite session in development', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const res = await clearRoute();
    expect(res.status).toBe(200);
  });
});
```

Note: `clear/route.ts` also imports the dev-simulation orchestrator/pool/api-key modules. If importing the route under vitest fails on those side effects, read `src/app/api/dev/simulate/clear/route.ts:35-62` and add `vi.mock(...)` stubs for exactly the functions the route calls from `@/services/dev-simulation/orchestrator`, `@/services/dev-simulation/pool`, and `@/services/dev-simulation/api-keys` (match the real call names — do not guess).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/api/dev-simulate-guard.test.ts`
Expected: FAIL — 401/403 cases return 200 today (guard checks only the flag, `instanceof` call sites don't exist yet).

- [ ] **Step 4: Rewrite the guard**

```ts
// src/app/api/dev/simulate/_guard.ts — whole file
// Shared guard for /api/dev/simulate/* routes.
// Two gates, both mandatory: (1) simulation feature enabled (hard-false in
// production), (2) handler-level admin authorization — middleware is defense
// in depth, not the authorization decision.
// Returns the admin Session on success (callers use it for audit identity),
// otherwise a NextResponse the caller must return directly.
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { isSimulationEnabled } from '@/lib/feature-flags';
import { requireAdmin } from '@/lib/admin-guard';

export async function simulationGuard(): Promise<Session | NextResponse> {
  if (!isSimulationEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return requireAdmin();
}
```

- [ ] **Step 5: Update all 8 call sites**

In each of `clear`, `reset-onboarding`, `start`, `stop`, `status`, `inspect`, `models`, `smoke` route files, replace:

```ts
  const guard = simulationGuard();
  if (guard) return guard;
```

with:

```ts
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;
```

(`NextResponse` is already imported in every one of these files. In `smoke/route.ts` the guard call is at line ~77, not the first statement — same replacement.)

- [ ] **Step 6: Middleware defense in depth**

In `src/middleware.ts` add `'/api/dev'` to the readonly block list:

```ts
const READONLY_BLOCKED_API_PREFIXES = [
  '/api/admin',
  '/api/onboarding',
  '/api/sync/trigger',
  '/api/referrals',
  '/api/hospital/audit-log',
  '/api/dev',
];
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/unit/api/dev-simulate-guard.test.ts tests/unit/dev-simulation && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/helpers/session.ts tests/unit/api/dev-simulate-guard.test.ts src/app/api/dev/simulate src/middleware.ts
git commit -m "fix(security): require handler-level admin auth on all simulation routes

simulationGuard() checked only the feature flag — any authenticated user
(including readonly ProviderID sessions) could invoke the wipe routes when the
flag was on. The guard now composes requireAdmin() and returns the admin
session for audit use; readonly sessions are additionally blocked at the
middleware for all /api/dev paths.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A3: Transactional wipes + audit events for clear and reset-onboarding

**Files:**
- Create: `tests/helpers/failingDb.ts`
- Modify: `tests/unit/api/dev-simulate-guard.test.ts` (add rollback + audit cases)
- Modify: `src/app/api/dev/simulate/clear/route.ts:35-140`
- Modify: `src/app/api/dev/simulate/reset-onboarding/route.ts:49-137`

**Interfaces:**
- Consumes: `simulationGuard()` returning `Session` (Task A2); `db.transaction<T>(fn)` (both adapters, no nesting, tx adapter only inside); `tryLogAccess(db, entry)` from `@/services/audit`; `auditActorFromSession(session)` from `@/lib/audit-actor`.
- Produces: `FailingAdapter` test helper (reused by Release B task B3) — wraps a real adapter, throws on SQL matching a regex, propagates itself into transactions so injected failures trigger real ROLLBACKs.

- [ ] **Step 1: Create the failure-injection helper**

```ts
// tests/helpers/failingDb.ts
import { DatabaseAdapter, type ColumnInfo } from '@/db/adapter';

/**
 * Wraps a real adapter and throws on any execute/query whose SQL matches
 * `failOn`. transaction() re-wraps the tx adapter, so an injected failure
 * inside db.transaction() exercises a real ROLLBACK on PGlite/Postgres.
 */
export class FailingAdapter extends DatabaseAdapter {
  constructor(
    private readonly inner: DatabaseAdapter,
    private readonly failOn: RegExp,
  ) {
    super();
  }

  private check(sql: string): void {
    if (this.failOn.test(sql)) {
      throw new Error(`injected failure on: ${sql.slice(0, 80)}`);
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    this.check(sql);
    return this.inner.execute(sql, params);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    this.check(sql);
    return this.inner.query<T>(sql, params);
  }

  getTableNames(): Promise<string[]> {
    return this.inner.getTableNames();
  }

  getColumnInfo(table: string): Promise<ColumnInfo[]> {
    return this.inner.getColumnInfo(table);
  }

  transaction<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.inner.transaction((tx) => fn(new FailingAdapter(tx, this.failOn)));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
```

- [ ] **Step 2: Add failing rollback + audit tests**

Append to `tests/unit/api/dev-simulate-guard.test.ts` (inside the existing describe; imports added at top: `import { FailingAdapter } from '../../helpers/failingDb';`, `import { createJourney } from '@/services/journey';`, `import { AncRiskLevel } from '@/types/domain';`):

```ts
  async function seedOneJourney(target: DatabaseAdapter): Promise<string> {
    const hosp = await target.query<{ id: string }>(
      `SELECT id FROM hospitals WHERE hcode = ?`,
      ['10670'],
    );
    const journey = await createJourney(target, {
      hospitalId: hosp[0].id,
      hn: 'HN-A3',
      personAncId: null,
      name: '',
      cid: '',
      cidHash: 'hash-a3',
      age: 28,
      gravida: 1,
      para: 0,
      lmp: null,
      edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });
    return journey.id;
  }

  it('rolls back the ENTIRE wipe when one DELETE fails', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const real = db;
    await seedOneJourney(real);
    db = new FailingAdapter(real, /DELETE FROM cached_patients/);

    const res = await clearRoute();
    expect(res.status).toBe(500);

    // cpd_scores/vitals DELETEs ran before the injected failure — the
    // transaction must have rolled them back together with everything else.
    const journeys = await real.query<{ n: number }>(
      `SELECT COUNT(*) as n FROM maternal_journeys`,
    );
    expect(Number(journeys[0].n)).toBe(1);
    db = real;
  });

  it('writes an audit_logs row with actor identity and row counts on success', async () => {
    mockSessionUser = testSessionUser({
      hospitalCode: '10670',
      role: UserRole.ADMIN,
      id: 'admin-a3',
      name: 'ผอ.ทดสอบ',
    });
    await seedOneJourney(db);

    const res = await clearRoute();
    expect(res.status).toBe(200);

    const audit = await db.query<{ action: string; user_id: string; metadata: unknown }>(
      `SELECT action, user_id, metadata FROM audit_logs WHERE action = ?`,
      ['dev_simulation_clear'],
    );
    expect(audit.length).toBe(1);
    expect(audit[0].user_id).toBe('admin-a3');
    const meta =
      typeof audit[0].metadata === 'string'
        ? JSON.parse(audit[0].metadata as string)
        : (audit[0].metadata as Record<string, unknown>);
    expect(meta.counts).toBeDefined();
    expect((meta.counts as Record<string, number>).maternal_journeys).toBe(1);
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/api/dev-simulate-guard.test.ts`
Expected: FAIL — rollback test finds 0 journeys (partial wipe committed) and/or route throws unhandled; audit test finds 0 audit rows.

- [ ] **Step 4: Make `clear` transactional + audited**

In `src/app/api/dev/simulate/clear/route.ts`: add imports

```ts
import { v4 as uuidv4 } from 'uuid';
import { tryLogAccess } from '@/services/audit';
import { auditActorFromSession } from '@/lib/audit-actor';
```

then restructure `POST` so that (a) the guard result is kept as `session`, (b) the whole body after `getDatabase()` is inside `try/catch`, (c) the count+DELETE loop and the sim-key DELETE run inside one transaction, (d) an audit row is written after commit:

```ts
export async function POST() {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const requestId = uuidv4();

  try {
    // ... existing orchestrator-stop + clearDevApiKeyCache + resetPool block, unchanged ...
    await ensureInit();
    const db = await getDatabase();

    const tables = [
      'cpd_scores',
      'cached_vital_signs',
      'cached_partograph_observations',
      'cached_anc_risks',
      'cached_anc_visits',
      'cached_newborns',
      'cached_referrals',
      'cached_patients',
      'maternal_journeys',
    ];

    const counts: Record<string, number> = {};
    await db.transaction(async (tx) => {
      for (const t of tables) {
        const before = await tx.query<{ n: number }>(`SELECT COUNT(*) as n FROM ${t}`);
        counts[t] = Number(before[0]?.n ?? 0);
        await tx.execute(`DELETE FROM ${t}`);
      }
      // keep the existing sim-labelled webhook key cleanup inside the same tx:
      await tx.execute(`DELETE FROM webhook_api_keys WHERE label LIKE 'sim:dev:%'`);
    });

    await tryLogAccess(db, {
      ...auditActorFromSession(session),
      action: 'dev_simulation_clear',
      resourceType: 'simulation',
      metadata: { requestId, environment: process.env.NODE_ENV, counts },
    });

    // ... existing logger.warn('sim_data_cleared', ...) + SSE broadcast + response, unchanged,
    //     but add requestId to the JSON response body ...
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('sim_data_clear_failed', { requestId, error: message });
    return NextResponse.json(
      { ok: false, error: 'clear failed — no data was deleted (transaction rolled back)', requestId },
      { status: 500 },
    );
  }
}
```

Preserve the existing leftover-key count / SSE / response logic; only the deletion mechanics, guard usage, audit call, and try/catch are new. (`Session` type import is not needed — `guard` narrows via `instanceof`.)

- [ ] **Step 5: Make `reset-onboarding` transactional + audited**

Same pattern in `src/app/api/dev/simulate/reset-onboarding/route.ts`: keep `FK_DEPENDENT_TABLES` as-is; inside the existing `try`, replace the sequential DELETE loop + `DELETE FROM hospitals` with:

```ts
    const counts: Record<string, number> = {};
    await db.transaction(async (tx) => {
      for (const t of FK_DEPENDENT_TABLES) {
        const before = await tx.query<{ n: number }>(`SELECT COUNT(*) as n FROM ${t}`);
        counts[t] = Number(before[0]?.n ?? 0);
        await tx.execute(`DELETE FROM ${t}`);
      }
      // HARD delete hospitals — registry truly empty after this.
      await tx.execute('DELETE FROM hospitals');
    });

    await tryLogAccess(db, {
      ...auditActorFromSession(session),
      action: 'dev_simulation_reset_onboarding',
      resourceType: 'simulation',
      metadata: { requestId, environment: process.env.NODE_ENV, counts },
    });
```

with `const session = guard;` + `const requestId = uuidv4();` after the guard, the same three imports as Step 4, and the existing catch block extended to state that the transaction rolled back (`error: 'reset-onboarding failed — no data was deleted (transaction rolled back)'`).

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/unit/api/dev-simulate-guard.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/failingDb.ts tests/unit/api/dev-simulate-guard.test.ts src/app/api/dev/simulate/clear/route.ts src/app/api/dev/simulate/reset-onboarding/route.ts
git commit -m "fix(security): simulation wipes are transactional and audited

A mid-loop failure previously left a partially wiped database (clear had no
try/catch at all). Both wipe routes now run inside one transaction and write
an audit_logs event with actor identity, request id, environment and per-table
row counts. Adds FailingAdapter test helper for rollback injection.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A4: Production admin access fails closed + role-mapping tightening + denial logging

**Files:**
- Modify: `tests/unit/lib/admin-access.test.ts` (flip 2 fail-open assertions, add production cases)
- Modify: `tests/unit/lib/auth.test.ts:15-32` (add subordinate-title cases)
- Modify: `src/lib/admin-access.ts:46-57`
- Modify: `src/lib/auth-utils.ts:5-14`
- Modify: `src/lib/admin-guard.ts:45-60` (denial logging)
- Modify: `src/middleware.ts:109-119` (denial logging)
- Modify: `.env.example` (fail-open text), `.env.production.example` (add `ADMIN_ALLOWED_CIDS`)

**Interfaces:**
- Produces: `isAdminAuthorized(identity, allowedCids?, isProduction?)` — new optional third parameter `isProduction: boolean = process.env.NODE_ENV === 'production'`. Empty allow-list now means: **deny in production**, role-only gate preserved outside production (dev/test back-compat).
- Produces: `mapPositionToRole(position)` — unchanged signature; subordinate/deputy/assistant director titles no longer map to ADMIN.

- [ ] **Step 1: Flip and extend the admin-access tests**

In `tests/unit/lib/admin-access.test.ts` replace the two fail-open tests:

```ts
  it('accepts an ADMIN with an empty allow-list OUTSIDE production only', () => {
    expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1' }, [], false)).toBe(true);
  });

  it('rejects an ADMIN with an empty allow-list IN production (fail closed)', () => {
    expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1' }, [], true)).toBe(false);
    expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '' }, [], true)).toBe(false);
    expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: undefined }, [], true)).toBe(false);
  });

  it('still enforces the CID gate in production when the list is non-empty', () => {
    expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '1' }, ['1'], true)).toBe(true);
    expect(isAdminAuthorized({ role: UserRole.ADMIN, userCid: '2' }, ['1'], true)).toBe(false);
  });
```

(Keep every other existing case; they pass `allowedCids` explicitly and are production-independent.)

In `tests/unit/lib/auth.test.ts` add to the `mapPositionToRole` block:

```ts
  it('does not promote subordinate director titles to ADMIN', () => {
    expect(mapPositionToRole('Deputy Director')).not.toBe(UserRole.ADMIN);
    expect(mapPositionToRole('Assistant Director')).not.toBe(UserRole.ADMIN);
    expect(mapPositionToRole('รองผู้อำนวยการ')).not.toBe(UserRole.ADMIN);
    expect(mapPositionToRole('ผู้ช่วยผู้อำนวยการ')).not.toBe(UserRole.ADMIN);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/admin-access.test.ts tests/unit/lib/auth.test.ts`
Expected: FAIL — production empty-list cases return `true`; 'Deputy Director' maps to ADMIN.

- [ ] **Step 3: Implement fail-closed predicate**

In `src/lib/admin-access.ts` replace `isAdminAuthorized` (keep the docblock, updating gate 3's description):

```ts
export function isAdminAuthorized(
  identity: AdminIdentity,
  allowedCids: string[] = parseAdminAllowedCids(),
  isProduction: boolean = process.env.NODE_ENV === 'production',
): boolean {
  if (identity.role !== UserRole.ADMIN) return false;
  if (identity.accessMode === 'readonly') return false;
  if (allowedCids.length === 0) {
    // Fail closed: production with no allow-list has NO CID-authorized
    // administrators. The role-only gate survives only outside production.
    return !isProduction;
  }
  const cid = identity.userCid ?? '';
  return Boolean(cid) && allowedCids.includes(cid);
}
```

- [ ] **Step 4: Tighten the role mapping**

In `src/lib/auth-utils.ts` replace `mapPositionToRole`:

```ts
// Subordinate leadership titles must not inherit the director's ADMIN role.
const DIRECTOR_EXCLUSIONS = ['deputy', 'assistant', 'vice', 'รอง', 'ผู้ช่วย'];

export function mapPositionToRole(position: string): UserRole {
  const lower = position.toLowerCase();
  const isDirector = lower.includes('director') || lower.includes('ผู้อำนวยการ');
  const isSubordinate = DIRECTOR_EXCLUSIONS.some((p) => lower.includes(p));
  if (isDirector && !isSubordinate) {
    return UserRole.ADMIN;
  }
  if (lower.includes('doctor') || lower.includes('แพทย์') || lower.includes('สูติ')) {
    return UserRole.OBSTETRICIAN;
  }
  return UserRole.NURSE;
}
```

- [ ] **Step 5: Log denied admin decisions in both callers**

`src/lib/admin-access.ts` must stay Edge-pure (its header forbids logger) — log in the callers. `src/lib/logger.ts` auto-redacts any context key containing `cid` (PDPA); pass the last 4 digits under a non-matching key.

In `src/lib/admin-guard.ts` add `import { logger } from '@/lib/logger';` and, in the denial branch before returning 403:

```ts
    logger.warn('admin_access_denied', {
      role: session.user.role,
      accessMode: session.user.accessMode,
      userIdLast4: session.user.userCid?.slice(-4) ?? '',
      hospitalCode: session.user.hospitalCode,
    });
```

In `src/middleware.ts` add `import { logger } from '@/lib/logger';` (logger is dependency-free/Edge-safe) and in the admin-gate denial branch before the redirect:

```ts
      logger.warn('admin_access_denied_middleware', {
        pathname,
        role: session.user.role,
        accessMode: session.user.accessMode,
        userIdLast4: session.user.userCid?.slice(-4) ?? '',
      });
```

- [ ] **Step 6: Update env documentation**

- `.env.example`: replace the "Empty / unset = role-only gate (back-compat)" text with: `# Empty/unset = NO admin access in production (fail closed). Outside production the role-only gate applies for local development.`
- `.env.production.example`: add `ADMIN_ALLOWED_CIDS=` with a comment `# REQUIRED for admin access in production: comma-separated Thai CIDs of authorized administrators.`

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/unit/lib/admin-access.test.ts tests/unit/lib/auth.test.ts tests/unit/lib/auth-utils-bypass.test.ts tests/unit/lib/hospital-access-guard.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/admin-access.ts src/lib/auth-utils.ts src/lib/admin-guard.ts src/middleware.ts tests/unit/lib/admin-access.test.ts tests/unit/lib/auth.test.ts .env.example .env.production.example
git commit -m "fix(security): admin access fails closed in production

Empty ADMIN_ALLOWED_CIDS silently degraded to a role-only gate, and any BMS
position containing 'director'/'ผู้อำนวยการ' (including deputies/assistants)
minted the ADMIN role. Production now denies admin with an empty allow-list,
subordinate titles no longer promote, and denied decisions are logged (CID
last-4 only, PDPA-safe).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A5: CSRF origin validation + mutation-route policy manifest

Context: the session cookie is deliberately `SameSite=None; Secure` in production (iframe embedding), so it travels on cross-site requests. No Origin/Sec-Fetch-Site check exists anywhere. The gate lives in the Edge middleware (runs before every handler, satisfying "rejected before any database access"); webhook and `/api/auth` routes are in `PUBLIC_PATHS` and unaffected.

**Files:**
- Create: `src/lib/request-origin.ts` (Edge-safe, pure)
- Create: `tests/unit/lib/request-origin.test.ts`
- Create: `src/config/mutation-route-policy.ts`
- Create: `tests/unit/security/mutation-route-manifest.test.ts`
- Modify: `src/middleware.ts` (origin gate for non-GET after the public-path checks)
- Modify: `.env.example` (document `CSRF_TRUSTED_ORIGINS`)

**Interfaces:**
- Produces: `isRequestOriginTrusted(input: { method: string; origin: string | null; secFetchSite: string | null; requestOrigin: string }, trusted?: string[]): boolean` and `parseTrustedOrigins(nextauthUrl?, extra?): string[]` in `@/lib/request-origin`.
- Produces: `MUTATION_ROUTE_POLICIES: Record<string, MutationRoutePolicy>` in `@/config/mutation-route-policy` — repo-relative `route.ts` path → policy.

- [ ] **Step 1: Write failing unit tests for the pure origin check**

```ts
// tests/unit/lib/request-origin.test.ts
import { describe, it, expect } from 'vitest';
import { isRequestOriginTrusted, parseTrustedOrigins } from '@/lib/request-origin';

const APP = 'https://kk-lrms.bmscloud.in.th';

describe('parseTrustedOrigins', () => {
  it('derives the app origin from NEXTAUTH_URL and appends extras', () => {
    expect(parseTrustedOrigins(`${APP}/`, 'https://embedder.example.com, https://two.example.com')).toEqual([
      APP,
      'https://embedder.example.com',
      'https://two.example.com',
    ]);
  });
  it('skips invalid URLs instead of throwing', () => {
    expect(parseTrustedOrigins('not a url', 'also-bad')).toEqual([]);
  });
});

describe('isRequestOriginTrusted', () => {
  const base = { requestOrigin: APP };
  it('always allows safe methods', () => {
    expect(
      isRequestOriginTrusted(
        { method: 'GET', origin: 'https://evil.example.com', secFetchSite: 'cross-site', ...base },
        [APP],
      ),
    ).toBe(true);
  });
  it('rejects a cross-site Origin on POST', () => {
    expect(
      isRequestOriginTrusted(
        { method: 'POST', origin: 'https://evil.example.com', secFetchSite: 'cross-site', ...base },
        [APP],
      ),
    ).toBe(false);
  });
  it('allows the configured app origin', () => {
    expect(
      isRequestOriginTrusted({ method: 'POST', origin: APP, secFetchSite: 'same-origin', ...base }, [APP]),
    ).toBe(true);
  });
  it('allows Origin matching the request host even if NEXTAUTH_URL is misconfigured', () => {
    expect(
      isRequestOriginTrusted({ method: 'POST', origin: APP, secFetchSite: null, ...base }, []),
    ).toBe(true);
  });
  it('rejects cross-site Sec-Fetch-Site when Origin is absent', () => {
    expect(
      isRequestOriginTrusted({ method: 'POST', origin: null, secFetchSite: 'cross-site', ...base }, [APP]),
    ).toBe(false);
  });
  it('allows non-browser clients that send neither header (curl, HOSxP Pascal)', () => {
    expect(
      isRequestOriginTrusted({ method: 'POST', origin: null, secFetchSite: null, ...base }, [APP]),
    ).toBe(true);
  });
});

describe('isJsonContentType', () => {
  it('accepts application/json with or without charset', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
  });
  it('rejects form content types (CSRF simple-request vectors)', () => {
    expect(isJsonContentType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonContentType('multipart/form-data; boundary=x')).toBe(false);
    expect(isJsonContentType('text/plain')).toBe(false);
  });
});
```

(add `isJsonContentType` to the import at the top of the test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/request-origin.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the Edge-safe module**

```ts
// src/lib/request-origin.ts
// CSRF origin validation for cookie-authenticated mutations.
// Edge-pure: no Node-only imports — consumed by src/middleware.ts.
// The session cookie is SameSite=None (iframe embedding requirement), so the
// browser attaches it to cross-site requests; this check is the CSRF control.

export interface OriginCheckInput {
  method: string;
  /** Origin request header (null when the client did not send one). */
  origin: string | null;
  /** Sec-Fetch-Site request header (modern browsers only). */
  secFetchSite: string | null;
  /** Origin the request actually arrived on (req.nextUrl.origin). */
  requestOrigin: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseTrustedOrigins(
  nextauthUrl: string | undefined = process.env.NEXTAUTH_URL,
  extra: string | undefined = process.env.CSRF_TRUSTED_ORIGINS,
): string[] {
  const origins: string[] = [];
  if (nextauthUrl) {
    try {
      origins.push(new URL(nextauthUrl).origin);
    } catch {
      // invalid NEXTAUTH_URL contributes no trusted origin
    }
  }
  for (const raw of (extra ?? '').split(',')) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      origins.push(new URL(candidate).origin);
    } catch {
      // skip malformed entries
    }
  }
  return origins;
}

export function isRequestOriginTrusted(
  input: OriginCheckInput,
  trusted: string[] = parseTrustedOrigins(),
): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (input.origin) {
    // OWASP: Origin must match the target origin or an explicit allow-list.
    return input.origin === input.requestOrigin || trusted.includes(input.origin);
  }
  if (input.secFetchSite) {
    return input.secFetchSite !== 'cross-site';
  }
  // Neither header: non-browser client (curl, HOSxP Delphi). Browsers always
  // send at least one of them on credentialed cross-site requests.
  return true;
}

/**
 * Content-type gate for JSON-only mutation handlers (spec 1.2.5): form
 * content types (urlencoded/multipart/text-plain) are CSRF "simple request"
 * vectors and are never legitimate for these routes. Applied per-route (the
 * repo has multipart upload routes, so this must NOT be a global gate).
 */
export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}
```

- [ ] **Step 4: Enforce in middleware**

In `src/middleware.ts` add `import { isRequestOriginTrusted } from '@/lib/request-origin';` and insert **after** the `PUBLIC_PATHS` / dev-bypass checks and **before** the `const session = req.auth;` line:

```ts
  // CSRF: cookie-authenticated mutations must come from a trusted origin.
  // Public paths (webhooks, /api/auth) never reach this point.
  if (
    !isRequestOriginTrusted({
      method: req.method,
      origin: req.headers.get('origin'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      requestOrigin: req.nextUrl.origin,
    })
  ) {
    return addSecurityHeaders(
      NextResponse.json(
        {
          error: 'csrf_origin_rejected',
          message: 'คำขอถูกปฏิเสธ: ต้นทางของคำขอ (Origin) ไม่ได้รับอนุญาต',
          suggestedAction: 'โปรดใช้งานผ่านหน้าเว็บ KK-LRMS โดยตรง',
        },
        { status: 403 },
      ),
    );
  }
```

Add to `.env.example`:

```
# Optional comma-separated extra origins allowed to send cookie-authenticated
# mutations (e.g. a trusted embedder that calls our APIs directly). The app's
# own origin (from NEXTAUTH_URL) and the request host are always trusted.
CSRF_TRUSTED_ORIGINS=""
```

- [ ] **Step 5: Write the failing mutation-route manifest test**

```ts
// tests/unit/security/mutation-route-manifest.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { MUTATION_ROUTE_POLICIES } from '@/config/mutation-route-policy';

const API_ROOT = join(process.cwd(), 'src/app/api');
const MUTATION_EXPORT =
  /export\s+(?:async\s+function|function|const)\s+(POST|PUT|PATCH|DELETE)\b|export\s*\{[^}]*\b(POST|PUT|PATCH|DELETE)\b[^}]*\}/;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

function repoPath(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, '/');
}

describe('mutation route CSRF-policy manifest', () => {
  it('every mutation route declares an explicit policy', () => {
    const missing: string[] = [];
    for (const file of findRouteFiles(API_ROOT)) {
      if (!MUTATION_EXPORT.test(readFileSync(file, 'utf8'))) continue;
      const key = repoPath(file);
      if (!(key in MUTATION_ROUTE_POLICIES)) missing.push(key);
    }
    expect(
      missing,
      `Mutation routes without a declared CSRF policy — add each to src/config/mutation-route-policy.ts:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('manifest has no stale entries', () => {
    const files = new Set(findRouteFiles(API_ROOT).map(repoPath));
    const stale = Object.keys(MUTATION_ROUTE_POLICIES).filter((k) => !files.has(k));
    expect(stale).toEqual([]);
  });
});
```

And the manifest seed:

```ts
// src/config/mutation-route-policy.ts
/**
 * CSRF policy manifest: EVERY route.ts under src/app/api that exports
 * POST/PUT/PATCH/DELETE must appear here with a deliberate policy.
 * tests/unit/security/mutation-route-manifest.test.ts fails the build when a
 * new mutation route is added without one.
 *
 * - session-origin-checked: cookie session auth; middleware Origin gate applies.
 * - bearer-api-key:         machine endpoint (webhook key); no browser CSRF surface.
 * - auth-endpoint:          credential exchange handled by NextAuth/BMS validation.
 * - dev-simulation-guard:   admin + feature-flag gated; hard-404 in production.
 * - public-by-design:       intentionally session-free (documented consumer).
 */
export type MutationRoutePolicy =
  | 'session-origin-checked'
  | 'bearer-api-key'
  | 'auth-endpoint'
  | 'dev-simulation-guard'
  | 'public-by-design';

export const MUTATION_ROUTE_POLICIES: Record<string, MutationRoutePolicy> = {
  'src/app/api/referrals/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/accept/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/reject/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/transit/route.ts': 'session-origin-checked',
  'src/app/api/referrals/[id]/arrive/route.ts': 'session-origin-checked',
  // check/route.ts is public until Task A8 locks it down — A8 flips this
  // entry to 'bearer-api-key' in the same commit as the route change.
  'src/app/api/referrals/check/route.ts': 'public-by-design',
  'src/app/api/webhooks/patient-data/route.ts': 'bearer-api-key',
  'src/app/api/auth/bms-session/route.ts': 'auth-endpoint',
  'src/app/api/auth/hospital-preflight/route.ts': 'auth-endpoint',
  'src/app/api/calls/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/invite/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/accept/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/decline/route.ts': 'session-origin-checked',
  'src/app/api/calls/[id]/leave/route.ts': 'session-origin-checked',
  'src/app/api/presence/heartbeat/route.ts': 'session-origin-checked',
  'src/app/api/sync/trigger/route.ts': 'session-origin-checked',
  'src/app/api/sync/browser-push/route.ts': 'session-origin-checked',
  'src/app/api/sync/browser-authenticity/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/confirm-push/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/hosxp-sync/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/webhook-key/route.ts': 'session-origin-checked',
  'src/app/api/onboarding/log/route.ts': 'session-origin-checked',
  'src/app/api/hospital/audit-log/route.ts': 'session-origin-checked',
  'src/app/api/dev/simulate/start/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/simulate/stop/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/simulate/clear/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/simulate/reset-onboarding/route.ts': 'dev-simulation-guard',
  'src/app/api/dev/smoke-tab-update/route.ts': 'dev-simulation-guard',
  // /api/admin/* mutation routes: populate from the red run of this test —
  // every one is 'session-origin-checked' (they all use requireAdmin()).
};
```

- [ ] **Step 6: Red run — complete the manifest from the test output**

Run: `npx vitest run tests/unit/security/mutation-route-manifest.test.ts`
Expected: FAIL listing the `/api/admin/*` (and any other) mutation routes not yet in the manifest. Add every listed path with policy `'session-origin-checked'` (verify each uses `requireAdmin()`/`auth()`; anything else needs a deliberate policy decision, not a default).

- [ ] **Step 7: Run everything green + typecheck**

Run: `npx vitest run tests/unit/lib/request-origin.test.ts tests/unit/security/mutation-route-manifest.test.ts tests/unit/middleware-headers.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/request-origin.ts src/config/mutation-route-policy.ts src/middleware.ts tests/unit/lib/request-origin.test.ts tests/unit/security/mutation-route-manifest.test.ts .env.example
git commit -m "feat(security): CSRF origin validation for cookie-authenticated mutations

The session cookie is SameSite=None (iframe embedding), so cross-site pages
could fire authenticated mutations. Non-GET requests to non-public paths now
require a trusted Origin (app origin, request host, or CSRF_TRUSTED_ORIGINS)
or a non-cross-site Sec-Fetch-Site; clients sending neither header (HOSxP
Delphi, curl) are unaffected. A mutation-route manifest test fails CI when a
new mutation route lacks an explicit CSRF policy.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A6: Bind session referral APIs to the session hospital

Context: none of the five referral handlers reads the session at all; hospital and actor identity come from the request body/query. Unit mismatch: `cached_referrals.from_hospital_id/to_hospital_id` are `hospitals.id` UUIDs; the session carries only `hospitalCode` (hcode string) — an hcode→id lookup is required. No in-repo frontend calls these mutation endpoints (UI reads `/api/dashboard/referrals/*`), so contract changes break no in-repo caller.

Transition authorization table (produced by this task, enforced by route + service):

| Action | Allowed party |
|---|---|
| create (POST /api/referrals) | source hospital; journey must currently be at that hospital |
| transit | source hospital (`from_hospital_id`) |
| accept, reject, arrive | destination hospital (`to_hospital_id`) |
| list (GET) | own hospital only (`?hospital` param ignored) |

**Files:**
- Create: `src/lib/session-guard.ts`
- Create: `src/services/hospital-lookup.ts`
- Create: `src/lib/referral-http.ts`
- Create: `tests/unit/api/referral-authorization.test.ts`
- Modify: `src/app/api/referrals/route.ts` (whole file)
- Modify: `src/app/api/referrals/[id]/accept/route.ts`, `reject/route.ts`, `transit/route.ts`, `arrive/route.ts` (whole files)
- Modify: `src/services/referral.ts` (add `assertReferralParty` + `ReferralAccessError`)

**Interfaces:**
- Produces: `requireSession(): Promise<Session | NextResponse>` (401 only) and `requireReadWriteSession(): Promise<Session | NextResponse>` (401 / 403-readonly) in `@/lib/session-guard`.
- Produces: `getHospitalIdByHcode(db: DatabaseAdapter, hcode: string): Promise<string | null>` in `@/services/hospital-lookup` (extracts the 4 duplicated inline lookups; sweep of old sites happens opportunistically, not in this task).
- Produces: `assertReferralParty(db, referralId, hospitalId, side: 'from' | 'to'): Promise<void>` and `class ReferralAccessError extends Error { code: 'NOT_FOUND' | 'FORBIDDEN' }` in `@/services/referral`.
- Produces: `referralTransitionRoute(spec)` factory in `@/lib/referral-http` (mirrors `callTransitionRoute` in `src/lib/video-call-http.ts`).
- Contract change: `acceptedBy`/`initiatedBy`/`fromHospitalId` request fields are IGNORED; actor = `session.user.name ?? session.user.id`, hospital = session's hospital.

- [ ] **Step 1: Write the failing authorization tests**

```ts
// tests/unit/api/referral-authorization.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { AncRiskLevel, ReferralStatus } from '@/types/domain';
import { testSessionUser } from '../../helpers/session';
import { createJourney } from '@/services/journey';
import { initiateReferral, acceptReferral, markInTransit } from '@/services/referral';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({ auth: async () => (mockSessionUser ? { user: mockSessionUser } : null) }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST as createRoute, GET as listRoute } from '@/app/api/referrals/route';
import { PATCH as acceptRoute } from '@/app/api/referrals/[id]/accept/route';
import { PATCH as arriveRoute } from '@/app/api/referrals/[id]/arrive/route';

const HCODE_A = '10670'; // source
const HCODE_B = '11004'; // destination

async function hospitalId(hcode: string): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  return rows[0].id;
}

async function seedJourneyAt(hcode: string): Promise<string> {
  const journey = await createJourney(db, {
    hospitalId: await hospitalId(hcode),
    hn: `HN-${hcode}`,
    personAncId: null,
    name: '',
    cid: '',
    cidHash: `hash-${hcode}`,
    age: 30,
    gravida: 1,
    para: 0,
    lmp: null,
    edc: null,
    ancRiskLevel: AncRiskLevel.LOW,
  });
  return journey.id;
}

function jsonRequest(url: string, body: unknown, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('referral session-hospital binding', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = null;
  });

  it('401s referral creation without a session', async () => {
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId: 'x', toHospitalId: 'y', reason: 'r', urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it('403s referral creation for a readonly session', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, accessMode: 'readonly' });
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId: 'x', toHospitalId: 'y', reason: 'r', urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it('415s a form-encoded body on this JSON-only handler (CSRF simple-request vector)', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A });
    const res = await createRoute(
      new Request('http://test/api/referrals', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'journeyId=x&toHospitalId=y',
      }) as never,
    );
    expect(res.status).toBe(415);
  });

  it('binds from_hospital to the SESSION hospital, ignoring body fromHospitalId', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A, name: 'พว.เอ ทดสอบ' });
    const journeyId = await seedJourneyAt(HCODE_A);
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId,
        fromHospitalId: await hospitalId(HCODE_B), // attacker-controlled — must be ignored
        toHospitalId: await hospitalId(HCODE_B),
        reason: 'ส่งต่อทดสอบ',
        urgencyLevel: 'URGENT',
        initiatedBy: 'attacker',
      }) as never,
    );
    expect(res.status).toBe(201);
    const rows = await db.query<{ from_hospital_id: string; initiated_by: string }>(
      'SELECT from_hospital_id, initiated_by FROM cached_referrals WHERE journey_id = ?',
      [journeyId],
    );
    expect(rows[0].from_hospital_id).toBe(await hospitalId(HCODE_A));
    expect(rows[0].initiated_by).toBe('พว.เอ ทดสอบ');
  });

  it('403s creation when the journey is at another hospital, creating no row', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_B });
    const journeyId = await seedJourneyAt(HCODE_A);
    const res = await createRoute(
      jsonRequest('http://test/api/referrals', {
        journeyId,
        toHospitalId: await hospitalId(HCODE_A),
        reason: 'r',
        urgencyLevel: 'URGENT',
      }) as never,
    );
    expect(res.status).toBe(403);
    const rows = await db.query('SELECT id FROM cached_referrals WHERE journey_id = ?', [journeyId]);
    expect(rows.length).toBe(0);
  });

  it('403s accept from a hospital that is not the destination, leaving status unchanged', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_A }); // source tries to accept
    const res = await acceptRoute(
      jsonRequest(`http://test/api/referrals/${referral.id}/accept`, {}, 'PATCH') as never,
      params(referral.id),
    );
    expect(res.status).toBe(403);
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM cached_referrals WHERE id = ?',
      [referral.id],
    );
    expect(rows[0].status).toBe(ReferralStatus.INITIATED);
  });

  it('lets the destination hospital accept, stamping the session actor', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    mockSessionUser = testSessionUser({ hospitalCode: HCODE_B, name: 'พว.บี ทดสอบ' });
    const res = await acceptRoute(
      jsonRequest(`http://test/api/referrals/${referral.id}/accept`, { acceptedBy: 'attacker' }, 'PATCH') as never,
      params(referral.id),
    );
    expect(res.status).toBe(200);
    const rows = await db.query<{ status: string; accepted_by: string }>(
      'SELECT status, accepted_by FROM cached_referrals WHERE id = ?',
      [referral.id],
    );
    expect(rows[0].status).toBe(ReferralStatus.ACCEPTED);
    expect(rows[0].accepted_by).toBe('พว.บี ทดสอบ');
  });

  it('403s arrive from a third hospital and does not move journey ownership', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    const referral = await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    await acceptReferral(db, referral.id, 'พว.บี');
    await markInTransit(db, referral.id, 'ambulance');
    mockSessionUser = testSessionUser({ hospitalCode: '10998' }); // neither party
    const res = await arriveRoute(
      jsonRequest(`http://test/api/referrals/${referral.id}/arrive`, { receivingAn: 'AN1' }, 'PATCH') as never,
      params(referral.id),
    );
    expect(res.status).toBe(403);
    const journeyRows = await db.query<{ current_hospital_id: string }>(
      'SELECT current_hospital_id FROM maternal_journeys WHERE id = ?',
      [journeyId],
    );
    expect(journeyRows[0].current_hospital_id).toBe(await hospitalId(HCODE_A));
  });

  it('GET list is scoped to the session hospital and ignores ?hospital', async () => {
    const journeyId = await seedJourneyAt(HCODE_A);
    await initiateReferral(db, {
      journeyId,
      fromHospitalId: await hospitalId(HCODE_A),
      toHospitalId: await hospitalId(HCODE_B),
      reason: 'r',
      urgencyLevel: 'URGENT' as never,
    });
    mockSessionUser = testSessionUser({ hospitalCode: '10998' }); // unrelated hospital
    const res = await listRoute(
      new Request(
        `http://test/api/referrals?hospital=${await hospitalId(HCODE_A)}&dir=out`,
      ) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]); // param ignored — unrelated hospital sees nothing
  });
});
```

(Note: hcode `'10998'` must be one of the 26 seeded KK hospitals — if seeding differs, pick any third hcode from `src/config/hospitals.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/referral-authorization.test.ts`
Expected: FAIL — 401/403 cases return 2xx today; the binding/actor assertions see body values.

- [ ] **Step 3: Implement the session guards**

```ts
// src/lib/session-guard.ts
// Handler-level session guards, mirroring the requireAdmin() shape:
// return the Session on success or a ready-to-return NextResponse.
// Node-side (imports @/lib/auth) — NEVER import from src/middleware.ts.
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';

const UNAUTHENTICATED_BODY = {
  error: 'Unauthorized',
  code: 'UNAUTHENTICATED',
  message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
  suggestedAction: 'เข้าสู่ระบบผ่านหน้า /login แล้วลองใหม่อีกครั้ง',
};

const READONLY_BODY = {
  error: 'Forbidden',
  code: 'READONLY_SESSION',
  message: 'บัญชีของคุณเป็นแบบอ่านอย่างเดียว ไม่สามารถแก้ไขข้อมูลได้',
  suggestedAction: 'เข้าสู่ระบบด้วย BMS Session เพื่อรับสิทธิ์แก้ไขข้อมูล',
};

export async function requireSession(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }
  return session;
}

export async function requireReadWriteSession(): Promise<Session | NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  if (session.user.accessMode === 'readonly') {
    return NextResponse.json(READONLY_BODY, { status: 403 });
  }
  return session;
}
```

```ts
// src/services/hospital-lookup.ts
// Shared hcode -> hospitals.id resolution (extracts the inline one-liner
// duplicated in dashboard.ts, journey-list.ts, webhook.ts, orchestrator.ts).
import type { DatabaseAdapter } from '@/db/adapter';

export async function getHospitalIdByHcode(
  db: DatabaseAdapter,
  hcode: string,
): Promise<string | null> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [hcode]);
  return rows.length > 0 ? rows[0].id : null;
}
```

- [ ] **Step 4: Add the party check to the referral service**

In `src/services/referral.ts` add after the imports:

```ts
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
    throw new ReferralAccessError(
      'FORBIDDEN',
      'โรงพยาบาลของคุณไม่มีสิทธิ์ดำเนินการกับใบส่งต่อนี้',
    );
  }
}
```

- [ ] **Step 5: Build the transition-route factory**

```ts
// src/lib/referral-http.ts
// Shared factory for the four referral transition routes (mirrors
// callTransitionRoute in src/lib/video-call-http.ts). Centralizes: session
// guard, hcode->id resolution, party authorization, error mapping.
import { NextResponse, type NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import type { DatabaseAdapter } from '@/db/adapter';
import type { CachedReferral } from '@/types/domain';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireReadWriteSession } from '@/lib/session-guard';
import { getHospitalIdByHcode } from '@/services/hospital-lookup';
import { assertReferralParty, ReferralAccessError } from '@/services/referral';
import { isJsonContentType } from '@/lib/request-origin';
import { logger } from '@/lib/logger';

const UNSUPPORTED_CONTENT_TYPE_BODY = {
  error: {
    code: 'UNSUPPORTED_CONTENT_TYPE',
    message: 'ต้องส่งข้อมูลเป็น application/json เท่านั้น',
    details: null,
  },
};

export interface ReferralTransitionSpec {
  /** Which referral party may perform this transition. */
  side: 'from' | 'to';
  /** Body field that must be present (null = no required field). */
  requiredField: string | null;
  logEvent: string;
  run: (
    db: DatabaseAdapter,
    referralId: string,
    body: Record<string, unknown>,
    session: Session,
  ) => Promise<CachedReferral>;
}

export function referralTransitionRoute(spec: ReferralTransitionSpec) {
  return async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> {
    try {
      await ensureInit();
      const guard = await requireReadWriteSession();
      if (guard instanceof NextResponse) return guard;
      const session = guard;

      // JSON-only handler: form content types are CSRF simple-request vectors.
      const contentType = request.headers.get('content-type');
      if (contentType !== null && !isJsonContentType(contentType)) {
        return NextResponse.json(UNSUPPORTED_CONTENT_TYPE_BODY, { status: 415 });
      }

      const { id } = await params;
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      if (spec.requiredField && !body[spec.requiredField]) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: `${spec.requiredField} จำเป็นต้องระบุ`,
              details: null,
            },
          },
          { status: 400 },
        );
      }

      const db = await getDatabase();
      const hospitalId = await getHospitalIdByHcode(db, session.user.hospitalCode);
      if (!hospitalId) {
        return NextResponse.json(
          {
            error: {
              code: 'HOSPITAL_NOT_REGISTERED',
              message: `โรงพยาบาล ${session.user.hospitalCode} ไม่ได้ลงทะเบียนในระบบ`,
              details: null,
            },
          },
          { status: 403 },
        );
      }
      await assertReferralParty(db, id, hospitalId, spec.side);
      const referral = await spec.run(db, id, body, session);
      return NextResponse.json(referral);
    } catch (error) {
      if (error instanceof ReferralAccessError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message, details: null } },
          { status: error.code === 'NOT_FOUND' ? 404 : 403 },
        );
      }
      logger.error(spec.logEvent, { error });
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
        { status: 500 },
      );
    }
  };
}
```

- [ ] **Step 6: Rewrite the five route files**

`src/app/api/referrals/[id]/accept/route.ts` (whole file):

```ts
// PATCH /api/referrals/[id]/accept — destination hospital accepts a referral.
// Actor identity comes from the session; client-supplied acceptedBy is ignored.
import { referralTransitionRoute } from '@/lib/referral-http';
import { acceptReferral } from '@/services/referral';

export const PATCH = referralTransitionRoute({
  side: 'to',
  requiredField: null,
  logEvent: 'referral_accept_failed',
  run: (db, id, _body, session) =>
    acceptReferral(db, id, session.user.name ?? session.user.id),
});
```

`src/app/api/referrals/[id]/reject/route.ts` (whole file):

```ts
// PATCH /api/referrals/[id]/reject — destination hospital rejects a referral.
import { referralTransitionRoute } from '@/lib/referral-http';
import { rejectReferral } from '@/services/referral';

export const PATCH = referralTransitionRoute({
  side: 'to',
  requiredField: 'reason',
  logEvent: 'referral_reject_failed',
  run: (db, id, body) =>
    rejectReferral(
      db,
      id,
      String(body.reason),
      body.suggestedAlternativeId != null ? String(body.suggestedAlternativeId) : undefined,
    ),
});
```

`src/app/api/referrals/[id]/transit/route.ts` (whole file):

```ts
// PATCH /api/referrals/[id]/transit — SOURCE hospital marks the patient in transit.
import { referralTransitionRoute } from '@/lib/referral-http';
import { markInTransit } from '@/services/referral';

export const PATCH = referralTransitionRoute({
  side: 'from',
  requiredField: 'transportMode',
  logEvent: 'referral_transit_failed',
  run: (db, id, body) => markInTransit(db, id, String(body.transportMode)),
});
```

`src/app/api/referrals/[id]/arrive/route.ts` (whole file):

```ts
// PATCH /api/referrals/[id]/arrive — destination hospital confirms arrival.
import { referralTransitionRoute } from '@/lib/referral-http';
import { confirmArrival } from '@/services/referral';

export const PATCH = referralTransitionRoute({
  side: 'to',
  requiredField: 'receivingAn',
  logEvent: 'referral_arrive_failed',
  run: (db, id, body) => confirmArrival(db, id, String(body.receivingAn)),
});
```

`src/app/api/referrals/route.ts` (whole file):

```ts
// POST /api/referrals — initiate referral (source = session hospital).
// GET  /api/referrals — list own hospital's pending referrals.
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireSession, requireReadWriteSession } from '@/lib/session-guard';
import { getHospitalIdByHcode } from '@/services/hospital-lookup';
import { initiateReferral, getPendingReferrals } from '@/services/referral';
import { isJsonContentType } from '@/lib/request-origin';
import { UrgencyLevel } from '@/types/domain';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const guard = await requireReadWriteSession();
    if (guard instanceof NextResponse) return guard;
    const session = guard;

    // JSON-only handler: form content types are CSRF simple-request vectors.
    const contentType = request.headers.get('content-type');
    if (contentType !== null && !isJsonContentType(contentType)) {
      return NextResponse.json(
        {
          error: {
            code: 'UNSUPPORTED_CONTENT_TYPE',
            message: 'ต้องส่งข้อมูลเป็น application/json เท่านั้น',
            details: null,
          },
        },
        { status: 415 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const { journeyId, toHospitalId, reason, urgencyLevel } = body;

    if (!journeyId || !toHospitalId || !reason || !urgencyLevel) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'journeyId, toHospitalId, reason และ urgencyLevel จำเป็นต้องระบุ',
            details: null,
          },
        },
        { status: 400 },
      );
    }
    if (!Object.values(UrgencyLevel).includes(urgencyLevel as UrgencyLevel)) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'urgencyLevel ไม่ถูกต้อง ต้องเป็น ROUTINE, URGENT หรือ EMERGENCY',
            details: null,
          },
        },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const fromHospitalId = await getHospitalIdByHcode(db, session.user.hospitalCode);
    if (!fromHospitalId) {
      return NextResponse.json(
        {
          error: {
            code: 'HOSPITAL_NOT_REGISTERED',
            message: `โรงพยาบาล ${session.user.hospitalCode} ไม่ได้ลงทะเบียนในระบบ`,
            details: null,
          },
        },
        { status: 403 },
      );
    }

    // The journey must currently be at the session's hospital.
    const journeyRows = await db.query<{ current_hospital_id: string }>(
      'SELECT current_hospital_id FROM maternal_journeys WHERE id = ?',
      [String(journeyId)],
    );
    if (journeyRows.length === 0) {
      return NextResponse.json(
        { error: { code: 'JOURNEY_NOT_FOUND', message: 'ไม่พบข้อมูลการตั้งครรภ์ที่ระบุ', details: null } },
        { status: 404 },
      );
    }
    if (journeyRows[0].current_hospital_id !== fromHospitalId) {
      return NextResponse.json(
        {
          error: {
            code: 'JOURNEY_NOT_AT_HOSPITAL',
            message: 'ผู้ป่วยรายนี้ไม่ได้อยู่ในความดูแลของโรงพยาบาลคุณ จึงไม่สามารถส่งต่อได้',
            details: null,
          },
        },
        { status: 403 },
      );
    }

    const referral = await initiateReferral(db, {
      journeyId: String(journeyId),
      fromHospitalId,
      toHospitalId: String(toHospitalId),
      reason: String(reason),
      diagnosisCode: body.diagnosisCode != null ? String(body.diagnosisCode) : undefined,
      urgencyLevel: urgencyLevel as UrgencyLevel,
      initiatedBy: session.user.name ?? session.user.id,
    });
    return NextResponse.json(referral, { status: 201 });
  } catch (error) {
    logger.error('referral_create_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureInit();
    const guard = await requireSession();
    if (guard instanceof NextResponse) return guard;
    const session = guard;

    const { searchParams } = new URL(request.url);
    const dir = searchParams.get('dir');
    if (dir !== 'in' && dir !== 'out') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'dir ต้องเป็น in หรือ out', details: null } },
        { status: 400 },
      );
    }

    const db = await getDatabase();
    const hospitalId = await getHospitalIdByHcode(db, session.user.hospitalCode);
    if (!hospitalId) {
      return NextResponse.json([]); // unregistered hospital sees nothing
    }
    const referrals = await getPendingReferrals(db, hospitalId, dir);
    return NextResponse.json(referrals);
  } catch (error) {
    logger.error('referral_list_failed', { error });
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่', details: null } },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 7: Run tests + typecheck + adjacent suites**

Run: `npx vitest run tests/unit/api/referral-authorization.test.ts tests/unit/api/referrals.test.ts tests/unit/services/referral.test.ts && npx tsc --noEmit`
Expected: PASS. (`referrals.test.ts` and `referral.test.ts` exercise the service layer directly and must keep passing unchanged.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/session-guard.ts src/services/hospital-lookup.ts src/lib/referral-http.ts src/services/referral.ts src/app/api/referrals tests/unit/api/referral-authorization.test.ts
git commit -m "fix(security): bind referral APIs to the session hospital

The five referral handlers read no session at all — any authenticated user
could create/accept/reject/transit/arrive any referral (arrive also moves
journey ownership) and list any hospital's queue. Hospital and actor identity
now derive from the session (hcode->hospitals.id lookup), a transition
authorization table is enforced (source: create/transit; destination:
accept/reject/arrive), and client-supplied actor fields are ignored.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A7: Webhook referral updates bound to the authenticated hospital

Context: `processReferralUpdate` declares the authenticated hospital as `_hospitalId` and never reads it; the referral is located purely from attacker-supplied `fromHospitalCode` + `referralId`. Any valid webhook key can accept/reject/transit/arrive/delete any referral between any two hospitals; the ARRIVED branch also re-assigns journey ownership. Unknown statuses skip DB writes but still broadcast a fabricated SSE event and return `success: true`.

Authorization table: status updates (`ACCEPTED | REJECTED | IN_TRANSIT | ARRIVED`) → destination hospital only (the update webhook is documented as sent by รพ.ปลายทาง). `action: 'delete'` → either party (source retraction or destination cleanup); third parties never. Ownership violations return the same non-disclosing 404 as a nonexistent referral.

**Files:**
- Modify: `tests/integration/webhook-security-boundary.test.ts` (add referral_update boundary describe)
- Modify: `src/services/webhook.ts:1535-1636` (`processReferralUpdate`)
- Modify: `src/app/api/webhooks/patient-data/route.ts:121-137` (status/action validation, error mapping)
- Modify: `src/lib/api-errors.ts` (3 new codes)
- Modify: `tests/integration/webhook-anc-referral.test.ts` (Scenario 6 "not found" now throws `WebhookReferralError`)

**Interfaces:**
- Produces: `class WebhookReferralError extends Error { code: 'REFERRAL_NOT_FOUND' | 'INVALID_REFERRAL_STATUS' | 'INVALID_REFERRAL_ACTION' }` exported from `@/services/webhook`.
- Changed: `processReferralUpdate(db, authenticatedHospitalId, payload, sseManager)` — parameter renamed from `_hospitalId` and now enforced.
- Produces: `ApiErrors` entries `REFERRAL_NOT_FOUND` (404), `INVALID_REFERRAL_STATUS` (400), `INVALID_REFERRAL_ACTION` (400).

- [ ] **Step 1: Write the failing cross-tenant tests**

Append a describe block to `tests/integration/webhook-security-boundary.test.ts`, reusing its existing harness (`createTestDb` + `SeedOrchestrator` + `createApiKey` + `buildRequest` + `vi.spyOn(connection, 'getDatabase')`). Hospitals: A=`99901` (source), B=`99902` (destination), C=`99903` (attacker) — mint one API key per hospital with `createApiKey(db, <hospital id>, 'boundary-test')`.

```ts
describe('referral_update tenant boundary', () => {
  let hospA: { id: string; hcode: string };
  let hospB: { id: string; hcode: string };
  let keyB: string;
  let keyC: string;
  let referralId: string;
  let journeyId: string;

  beforeEach(async () => {
    // db seeded by the file-level beforeEach; resolve the three hospitals
    const rows = await db.query<{ id: string; hcode: string }>(
      `SELECT id, hcode FROM hospitals WHERE hcode IN ('99901','99902','99903')`,
    );
    hospA = rows.find((r) => r.hcode === '99901')!;
    hospB = rows.find((r) => r.hcode === '99902')!;
    const hospC = rows.find((r) => r.hcode === '99903')!;
    keyB = (await createApiKey(db, hospB.id, 'boundary-b')).rawKey;
    keyC = (await createApiKey(db, hospC.id, 'boundary-c')).rawKey;

    const journey = await createJourney(db, {
      hospitalId: hospA.id, hn: 'HN-A7', personAncId: null, name: '', cid: '',
      cidHash: 'hash-a7', age: 30, gravida: 1, para: 0, lmp: null, edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });
    journeyId = journey.id;
    referralId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cached_referrals
         (id, journey_id, refer_number, from_hospital_id, to_hospital_id, status,
          reason, urgency_level, initiated_at, created_at, updated_at)
       VALUES (?, ?, 'RF-A7', ?, ?, 'INITIATED', 'ทดสอบ', 'URGENT', ?, ?, ?)`,
      [referralId, journeyId, hospA.id, hospB.id, now, now, now],
    );
  });

  function updatePayload(status: string, extra: Record<string, unknown> = {}) {
    return {
      type: 'referral_update',
      referralId: 'RF-A7',
      fromHospitalCode: '99901',
      status,
      ...extra,
    };
  }

  it('404s a third hospital updating another pair referral, with no mutation and no SSE', async () => {
    const sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
    const res = await postWebhook(keyC, updatePayload('REJECTED'));
    expect(res.status).toBe(404);
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM cached_referrals WHERE id = ?', [referralId]);
    expect(rows[0].status).toBe('INITIATED');
    expect(sseSpy).not.toHaveBeenCalled();
  });

  it('404s the SOURCE hospital sending a status update (destination-only)', async () => {
    const keyA = (await createApiKey(db, hospA.id, 'boundary-a')).rawKey;
    const res = await postWebhook(keyA, updatePayload('ACCEPTED'));
    expect(res.status).toBe(404);
  });

  it('allows the destination hospital to accept', async () => {
    const res = await postWebhook(keyB, updatePayload('ACCEPTED'));
    expect(res.status).toBe(200);
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM cached_referrals WHERE id = ?', [referralId]);
    expect(rows[0].status).toBe('ACCEPTED');
  });

  it('400s an unknown status with no mutation and no broadcast', async () => {
    const sseSpy = vi.spyOn(SseManager.getInstance(), 'broadcast');
    const res = await postWebhook(keyB, updatePayload('TOTALLY_FAKE'));
    expect(res.status).toBe(400);
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM cached_referrals WHERE id = ?', [referralId]);
    expect(rows[0].status).toBe('INITIATED');
    expect(sseSpy).not.toHaveBeenCalled();
  });

  it('rejects a third hospital deleting the referral; parties may delete', async () => {
    const resC = await postWebhook(keyC, updatePayload('', { action: 'delete' }));
    expect(resC.status).toBe(404);
    expect(
      (await db.query('SELECT id FROM cached_referrals WHERE id = ?', [referralId])).length,
    ).toBe(1);

    const resB = await postWebhook(keyB, updatePayload('', { action: 'delete' }));
    expect(resB.status).toBe(200);
    expect(
      (await db.query('SELECT id FROM cached_referrals WHERE id = ?', [referralId])).length,
    ).toBe(0);
  });
});
```

`postWebhook(rawKey, body)` = the file's existing `buildRequest` + dynamic route import pattern (`POST(buildRequest(body, rawKey))`); match its exact helper names when editing. Add missing imports (`createJourney`, `AncRiskLevel`, `SseManager`; `crypto.randomUUID` is global).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/webhook-security-boundary.test.ts`
Expected: FAIL — cross-tenant update currently succeeds (200, status mutated), unknown status returns 200 with an SSE broadcast.

- [ ] **Step 3: Add error codes**

In `src/lib/api-errors.ts` add to the `ApiErrors` table:

```ts
  REFERRAL_NOT_FOUND: {
    error: 'Referral not found',
    code: 'REFERRAL_NOT_FOUND',
    message: 'ไม่พบใบส่งต่อที่ระบุ หรือโรงพยาบาลของคุณไม่มีสิทธิ์ดำเนินการกับใบส่งต่อนี้',
    suggestedAction: 'ตรวจสอบ referralId และ fromHospitalCode แล้วลองใหม่อีกครั้ง',
  },
  INVALID_REFERRAL_STATUS: {
    error: 'Invalid referral status',
    code: 'INVALID_REFERRAL_STATUS',
    message: 'สถานะใบส่งต่อไม่ถูกต้อง ต้องเป็น ACCEPTED, IN_TRANSIT, ARRIVED หรือ REJECTED',
    suggestedAction: 'แก้ไขค่า status ให้ตรงตามที่กำหนดแล้วส่งใหม่',
  },
  INVALID_REFERRAL_ACTION: {
    error: 'Invalid referral action',
    code: 'INVALID_REFERRAL_ACTION',
    message: 'action ไม่ถูกต้อง ต้องเป็น update หรือ delete',
    suggestedAction: 'แก้ไขค่า action ให้ตรงตามที่กำหนดแล้วส่งใหม่',
  },
```

- [ ] **Step 4: Enforce tenancy in the service**

In `src/services/webhook.ts`, above `processReferralUpdate`, add:

```ts
export class WebhookReferralError extends Error {
  constructor(
    public readonly code: 'REFERRAL_NOT_FOUND' | 'INVALID_REFERRAL_STATUS' | 'INVALID_REFERRAL_ACTION',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookReferralError';
  }
}

// Single status whitelist derived from the domain enum (constitution IV —
// INITIATED is never a valid inbound update).
const REFERRAL_UPDATE_STATUSES: ReadonlySet<string> = new Set([
  ReferralStatus.ACCEPTED,
  ReferralStatus.REJECTED,
  ReferralStatus.IN_TRANSIT,
  ReferralStatus.ARRIVED,
]);
```

(`ReferralStatus` import: add to the existing `@/types/domain` import.) Then rewrite `processReferralUpdate`:

1. Rename `_hospitalId` → `authenticatedHospitalId`.
2. First statements:
   ```ts
   const action = payload.action ?? 'update';
   if (action !== 'update' && action !== 'delete') {
     throw new WebhookReferralError('INVALID_REFERRAL_ACTION', `action "${payload.action}" ไม่ถูกต้อง`);
   }
   if (action === 'update' && !REFERRAL_UPDATE_STATUSES.has(payload.status)) {
     throw new WebhookReferralError('INVALID_REFERRAL_STATUS', `status "${payload.status}" ไม่ถูกต้อง`);
   }
   ```
3. `resolveHospitalByHcode` failure → `throw new WebhookReferralError('REFERRAL_NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ')` (non-disclosing — do not reveal whether the hospital or the referral is what failed).
4. Delete branch: look up `from_hospital_id`/`to_hospital_id` first; require `authenticatedHospitalId === fromHospital.id || authenticatedHospitalId === row.to_hospital_id`; empty lookup or mismatch → `REFERRAL_NOT_FOUND`. Broadcast only after the DELETE executes.
5. Update branch: after the existing compound-key lookup, `if (existing.length === 0 || existing[0].to_hospital_id !== authenticatedHospitalId) throw new WebhookReferralError('REFERRAL_NOT_FOUND', 'ไม่พบใบส่งต่อที่ระบุ');`
6. The four status branches stay as-is (whitelist above guarantees exactly one matches). The `sseManager.broadcast(...)` at the end now only ever runs after a successful DB write.

- [ ] **Step 5: Validate + map errors at the route**

In `src/app/api/webhooks/patient-data/route.ts`, `referral_update` block: extend the `missing` check with enumerated validation before invoking the service:

```ts
      if (
        referralPayload.action !== undefined &&
        referralPayload.action !== 'update' &&
        referralPayload.action !== 'delete'
      ) {
        return NextResponse.json(apiError('INVALID_REFERRAL_ACTION', { received: referralPayload.action }), { status: 400 });
      }
      if (
        referralPayload.action !== 'delete' &&
        !['ACCEPTED', 'REJECTED', 'IN_TRANSIT', 'ARRIVED'].includes(referralPayload.status)
      ) {
        return NextResponse.json(apiError('INVALID_REFERRAL_STATUS', { received: referralPayload.status }), { status: 400 });
      }
```

and in the route's catch block, before the generic 500:

```ts
    if (error instanceof WebhookReferralError) {
      const status = error.code === 'REFERRAL_NOT_FOUND' ? 404 : 400;
      return NextResponse.json(apiError(error.code), { status });
    }
```

(`WebhookReferralError` import from `@/services/webhook`.)

- [ ] **Step 6: Update pinned tests**

In `tests/integration/webhook-anc-referral.test.ts` Scenario 6, the "throws when referral not found" case now throws `WebhookReferralError` with code `REFERRAL_NOT_FOUND` — update the assertion to `await expect(...).rejects.toMatchObject({ code: 'REFERRAL_NOT_FOUND' })`. Scenario 6/7 calls already pass the true destination id, so they keep passing.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/integration/webhook-security-boundary.test.ts tests/integration/webhook-anc-referral.test.ts tests/integration/hosxp-simulated-validation.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/webhook.ts src/app/api/webhooks/patient-data/route.ts src/lib/api-errors.ts tests/integration/webhook-security-boundary.test.ts tests/integration/webhook-anc-referral.test.ts
git commit -m "fix(security): webhook referral updates enforce hospital tenancy

processReferralUpdate ignored the authenticated hospital (_hospitalId) — any
valid webhook key could transition or delete any referral between any two
hospitals, including re-assigning journey ownership via ARRIVED. Status
updates now require the destination hospital, deletes require a referral
party, unknown statuses/actions are rejected before any write, ownership
violations return a non-disclosing 404, and SSE fires only after committed
writes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A8: Remove the public PHI oracle at /api/referrals/check

Recorded intended behavior (Phase 0 item 4): the only real consumer is the HOSxP Delphi client (`docs/hosxp/KKLRMSWebhookUnit.pas`), which gates referral sends on `canRefer`, logs `reason`, ignores every other field, **already sends its webhook Bearer key on this call**, and fails open when the endpoint errors. Therefore: require the existing webhook Bearer auth (no client change needed), minimize the response to `{ canRefer, reason, activeReferrals }`, validate CID checksum, and rate-limit per hospital.

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `tests/unit/lib/rate-limit.test.ts`
- Create: `tests/unit/api/referral-check-auth.test.ts`
- Modify: `src/app/api/referrals/check/route.ts` (rewrite handler; keep decision logic)
- Modify: `src/lib/api-errors.ts` (add `RATE_LIMITED`)
- Modify: `docs/WEBHOOK-SPEC.md` (~line 948-1050: now Bearer-authenticated, minimized response)
- Modify: `tests/fixtures/hosxp-simulated/send-webhooks.sh:56-79` (`referral_check()` sends `Authorization: Bearer $API_KEY`)

**Interfaces:**
- Consumes: `validateApiKey(db, rawKey)` from `@/services/webhook`; `diagnoseCid`/`describeCidFailure` from `@/lib/cid`; `cacheGetJson`/`cacheSetJson` from `@/lib/cache`.
- Produces: `checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }>` in `@/lib/rate-limit` (fixed-window counter on the cache layer; best-effort — the read-modify-write is not atomic, which is acceptable for abuse telemetry).
- Contract change: response shape is exactly `{ canRefer: boolean; reason: string; activeReferrals: number }`. `patient` and `labor` objects are REMOVED.

- [ ] **Step 1: Write failing rate-limit unit tests**

```ts
// tests/unit/lib/rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from '@/lib/rate-limit';
import { cacheDelPattern } from '@/lib/cache';

describe('checkRateLimit', () => {
  beforeEach(async () => {
    await cacheDelPattern('ratelimit:*');
  });

  it('allows up to the limit then rejects within the window', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit('test-key', 3, 60);
      expect(r.allowed).toBe(true);
    }
    const rejected = await checkRateLimit('test-key', 3, 60);
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
  });

  it('isolates keys', async () => {
    await checkRateLimit('key-a', 1, 60);
    const other = await checkRateLimit('key-b', 1, 60);
    expect(other.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing route tests**

```ts
// tests/unit/api/referral-check-auth.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { createApiKey } from '@/services/webhook';
import { cacheDelPattern } from '@/lib/cache';

let db: DatabaseAdapter;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { POST } from '@/app/api/referrals/check/route';

const VALID_CID = '1100500090006'; // checksum-valid synthetic CID (existing test fixture)

function checkRequest(body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new Request('http://test/api/referrals/check', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/referrals/check — auth + minimization', () => {
  let apiKey: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    await cacheDelPattern('ratelimit:*');
    const hosp = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = '10670'`);
    apiKey = (await createApiKey(db, hosp[0].id, 'check-test')).rawKey;
  });

  it('401s without a Bearer key', async () => {
    const res = await POST(checkRequest({ cid: VALID_CID }) as never);
    expect(res.status).toBe(401);
  });

  it('401s with an invalid key', async () => {
    const res = await POST(checkRequest({ cid: VALID_CID }, 'kklrms_' + '0'.repeat(40)) as never);
    expect(res.status).toBe(401);
  });

  it('400s a 13-char CID with an invalid checksum', async () => {
    const res = await POST(checkRequest({ cid: '1234567890123' }, apiKey) as never);
    expect(res.status).toBe(400);
  });

  it('returns ONLY canRefer/reason/activeReferrals — no patient or labor PHI', async () => {
    const res = await POST(checkRequest({ cid: VALID_CID }, apiKey) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['activeReferrals', 'canRefer', 'reason']);
  });

  it('429s after the per-hospital limit inside one window', async () => {
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) {
      last = await POST(checkRequest({ cid: VALID_CID }, apiKey) as never);
    }
    expect(last!.status).toBe(429);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/lib/rate-limit.test.ts tests/unit/api/referral-check-auth.test.ts`
Expected: FAIL — rate-limit module missing; route returns 200 without auth and leaks `patient`/`labor`.

- [ ] **Step 4: Implement the rate limiter**

```ts
// src/lib/rate-limit.ts
// Fixed-window rate limiter on the shared cache layer (Redis in prod,
// in-memory in tests). Best-effort: the read-increment-write is not atomic;
// adequate for abuse containment + telemetry, not for billing-grade quotas.
import { cacheGetJson, cacheSetJson } from '@/lib/cache';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucket = `ratelimit:${key}:${windowId}`;
  const current = (await cacheGetJson<number>(bucket)) ?? 0;
  if (current >= limit) {
    return { allowed: false, remaining: 0 };
  }
  await cacheSetJson(bucket, current + 1, windowSeconds);
  return { allowed: true, remaining: limit - current - 1 };
}
```

Add to `ApiErrors` in `src/lib/api-errors.ts`:

```ts
  RATE_LIMITED: {
    error: 'Too many requests',
    code: 'RATE_LIMITED',
    message: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    suggestedAction: 'ลดความถี่ของการเรียก API แล้วลองใหม่ภายหลัง',
  },
```

- [ ] **Step 5: Rewrite the check route**

In `src/app/api/referrals/check/route.ts`: replace the `CheckResult` interface and the top of `POST`; keep the three existing SQL queries and the canRefer/reason decision chain verbatim (they feed the decision; they are no longer echoed):

```ts
import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api-errors';
import { validateApiKey } from '@/services/webhook';
import { diagnoseCid, describeCidFailure } from '@/lib/cid';
import { checkRateLimit } from '@/lib/rate-limit';

// Minimized contract (2026-07-13 PHI review): the only consumer is the HOSxP
// referral gate, which uses canRefer + reason. Maternity details must never
// be returned from a CID lookup.
interface CheckResult {
  canRefer: boolean;
  reason: string;
  activeReferrals: number;
}

const CHECK_RATE_LIMIT = 30; // requests
const CHECK_RATE_WINDOW_SECONDS = 60;

export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();

    // Same Bearer webhook-key auth as /api/webhooks/patient-data. The route
    // stays in middleware PUBLIC_PATHS; this handler check is the auth.
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(apiError('MISSING_AUTH'), { status: 401 });
    }
    const keyInfo = await validateApiKey(db, authHeader.slice(7));
    if (!keyInfo) {
      return NextResponse.json(apiError('INVALID_API_KEY'), { status: 401 });
    }

    const rate = await checkRateLimit(
      `referral-check:${keyInfo.hospitalId}`,
      CHECK_RATE_LIMIT,
      CHECK_RATE_WINDOW_SECONDS,
    );
    if (!rate.allowed) {
      logger.warn('referral_check_rate_limited', { hospitalId: keyInfo.hospitalId });
      return NextResponse.json(apiError('RATE_LIMITED'), { status: 429 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(apiError('INVALID_JSON'), { status: 400 });
    }
    const { cid } = body as { cid?: string };
    const cidCheck = diagnoseCid(cid, { requireChecksum: true });
    if (!cidCheck.ok) {
      logger.warn('referral_check_invalid_cid', {
        hospitalId: keyInfo.hospitalId,
        failure: cidCheck.failure,
      });
      return NextResponse.json(
        apiError('VALIDATION_FAILED', { cid: describeCidFailure(cidCheck.failure) }),
        { status: 400 },
      );
    }

    const cidHash = createHash('sha256').update(cidCheck.cid).digest('hex');

    // ... EXISTING journeyRows / laborRows / activeReferrals queries and the
    //     canRefer/reason decision chain, unchanged (drop the getHospitalInfo
    //     helper and hospital-name resolution — no longer needed) ...

    const result: CheckResult = { canRefer, reason, activeReferrals };
    return NextResponse.json(result);
  } catch (error) {
    logger.error('referral_check_failed', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Update the spec doc, fixture script, and CSRF manifest**

- `docs/WEBHOOK-SPEC.md` "Referral Eligibility Check API" section: state that the endpoint requires the same `Authorization: Bearer <webhook API key>` as `/api/webhooks/patient-data` (the previous "session authentication" text was wrong — the endpoint was fully public); document the minimized response `{ canRefer, reason, activeReferrals }` and the 429.
- `tests/fixtures/hosxp-simulated/send-webhooks.sh` `referral_check()`: add `-H "Authorization: Bearer $API_KEY"` to the curl.
- `src/config/mutation-route-policy.ts`: flip `'src/app/api/referrals/check/route.ts'` from `'public-by-design'` to `'bearer-api-key'` and delete the placeholder comment above it (the route is now key-authenticated).

- [ ] **Step 7: Run tests + typecheck; reconcile old logic tests**

Run: `npx vitest run tests/unit/lib/rate-limit.test.ts tests/unit/api/referral-check-auth.test.ts tests/unit/api/referral-check.test.ts && npx tsc --noEmit`
Expected: PASS (`referral-check.test.ts` re-runs SQL directly against the DB and does not touch the route — unaffected).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/referrals/check/route.ts src/lib/rate-limit.ts src/lib/api-errors.ts tests/unit/lib/rate-limit.test.ts tests/unit/api/referral-check-auth.test.ts docs/WEBHOOK-SPEC.md tests/fixtures/hosxp-simulated/send-webhooks.sh
git commit -m "fix(security): /api/referrals/check no longer a public PHI oracle

The endpoint returned a full maternity dossier (care stage, ANC risk, gravida,
GA, hospital history, AN, labor status) for any unauthenticated 13-character
CID. It now requires the webhook Bearer key its only real consumer (HOSxP
Delphi client) already sends, validates the Thai CID checksum, is
rate-limited per hospital, and returns only canRefer/reason/activeReferrals.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task A9: Release A verification gate + deployment

**Files:**
- Create: `scripts/verify-release-a.sh`

**Interfaces:**
- Produces: a curl-based probe script runnable against staging or production (`./scripts/verify-release-a.sh https://kk-lrms.bmscloud.in.th`). Exit 0 = release gate passes.

- [ ] **Step 1: Full local gates**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all tests pass, zero type errors, production build succeeds. (Lint still has the 12 pre-existing errors owned by Release C task C7 — verify with `npx eslint src/lib src/app/api/referrals src/app/api/dev src/services/webhook.ts` that no NEW errors were introduced by Release A files.)

- [ ] **Step 2: Write the probe script**

```bash
#!/usr/bin/env bash
# Release A security probes. Usage: ./scripts/verify-release-a.sh <base-url>
# Passes when destructive/PHI surfaces are closed on the target deployment.
set -uo pipefail
BASE_URL="${1:?usage: verify-release-a.sh <base-url>}"
FAIL=0

code() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE_URL$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

check_not_2xx() {
  local desc="$1" actual="$2"
  if [[ "$actual" =~ ^2 ]]; then echo "FAIL  $desc — got $actual (must not be 2xx)"; FAIL=1
  else echo "PASS  $desc ($actual)"; fi
}
check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then echo "PASS  $desc ($actual)"
  else echo "FAIL  $desc — expected $expected got $actual"; FAIL=1; fi
}

check_not_2xx "simulate/clear unauthenticated"            "$(code POST /api/dev/simulate/clear)"
check_not_2xx "simulate/reset-onboarding unauthenticated" "$(code POST /api/dev/simulate/reset-onboarding)"
check_not_2xx "simulate/start unauthenticated"            "$(code POST /api/dev/simulate/start '{}')"
check_eq      "referrals/check without key -> 401"  "401" "$(code POST /api/referrals/check '{"cid":"1100500090006"}')"
check_eq      "health alive -> 200"                 "200" "$(code GET /api/health)"

# The check endpoint must never return PHI fields even on errors:
BODY=$(curl -s -X POST "$BASE_URL/api/referrals/check" -H 'Content-Type: application/json' -d '{"cid":"1100500090006"}')
if echo "$BODY" | grep -qE '"(ancRiskLevel|gravida|careStage|laborStatus|an)"'; then
  echo "FAIL  referrals/check response leaks PHI fields: $BODY"; FAIL=1
else
  echo "PASS  referrals/check response contains no PHI fields"
fi

exit $FAIL
```

`chmod +x scripts/verify-release-a.sh`

- [ ] **Step 3: Verify locally**

Run: `USE_PGLITE=true npm run dev` in one terminal (dev mode: simulation routes are legitimately enabled but session-protected), then `./scripts/verify-release-a.sh http://127.0.0.1:3000`
Expected: referrals/check probes PASS; simulate probes PASS (401 without session). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-release-a.sh
git commit -m "test(security): Release A deployment probe script

Curl probes proving simulation routes and the CID check endpoint fail closed
on a live deployment; used as the Release A stop-condition gate.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy Release A (requires operator approval)**

```bash
docker tag $(docker compose images -q app) kk-lrms-app:rollback-$(date +%F)-release-a || true
git push origin main
npm run deploy
./scripts/verify-release-a.sh https://kk-lrms.bmscloud.in.th
```

Expected: probe script exits 0. **Stop condition:** any FAIL line = halt, investigate, roll back (`docker tag kk-lrms-app:rollback-… ` + `docker compose up -d`) if the failure is a regression. Record the probe output as the release evidence required by the spec.
