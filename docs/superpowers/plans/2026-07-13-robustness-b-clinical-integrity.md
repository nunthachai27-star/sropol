# Release B — Clinical Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prerequisites: Release A complete (`2026-07-13-robustness-a-security-containment.md`) — this plan reuses its `FailingAdapter` and `testSessionUser` helpers. Read `2026-07-13-robustness-00-overview.md` for the reconciliation contract that gates deployment.

**Goal:** Clinical state matches clinical reality: labor admissions transition journeys to `LABOR`, ANC risk is canonical (item-derived severity can never be understated), multi-table deletions and pregnancy rollovers are atomic, partograph ingestion is race-safe, and a 10 cm patient is never flagged against an impossible expectation.

**Architecture:** All fixes land in `src/services/webhook.ts` (the single processor behind BOTH live ingestion paths — browser-push and external webhook) with parity patches to the prod-dead `src/services/sync/{anc,polling,partograph}.ts`. Atomicity via `db.transaction()`; uniqueness via a fail-safe startup migration (the repo's hand-written idempotent migration pattern); dedup logic extracted to one shared helper (constitution III).

**Tech Stack:** PostgreSQL/PGlite (`ON CONFLICT`, partial unique indexes, `JOIN LATERAL`), Vitest 4, PGlite harnesses (`createTestDb` shared / `createPgliteDb` for DDL tests).

## Global Constraints

- TDD: failing test first, capture red output, fix, re-run green — every task.
- Production ingestion is browser-only: `processWebhookPayload`/`processAncWebhook` in `src/services/webhook.ts` are the mandatory fix sites; `src/services/sync/polling.ts`+`anc.ts` are prod-dead but get parity fixes (project memory: consistency sweep).
- `db.transaction()` rules: no nesting (throws); inside the callback use ONLY the tx adapter (PGlite holds a global write mutex — touching the outer adapter deadlocks); `getTableNames`/`getColumnInfo` unavailable inside.
- Migrations: hand-written idempotent function in `src/db/migrations/<name>.ts`, wired into `initializeApp()` in `src/app/api/startup.ts` AFTER `SchemaSync.sync`; unit-tested with `createPgliteDb()` (NOT the shared `createTestDb` — truncation doesn't undo DDL).
- `SchemaSync.syncIndexes` silently swallows CREATE INDEX errors — never rely on a table-definition index to enforce a NEW constraint on an existing dirty database; the migration must create it (or refuse and report).
- No historical clinical data is rewritten (reconciliation contract): corrections apply to future ingestion; the duplicate-journey migration fails safe.
- SQL uses `?` placeholders; JSONB values from pg come back pre-parsed (`typeof x === 'string' ? x : JSON.stringify(x)` normalization).
- Encryption-touching tests set `process.env.ENCRYPTION_KEY = generateKey()` (from `@/lib/encryption`) in the file preamble.
- Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `npx tsc --noEmit` after each task.

---

### Task B1: Labor ingestion transitions journeys to LABOR

Context: `linkJourneyToLabor` (`src/services/sync/anc.ts:352-398`) already implements everything — cid-first + HN-fallback journey lookup, `PREGNANCY → LABOR` transition, walk-in journey creation, `cached_patients.journey_id` FK write — and is fully unit-tested, but has ZERO production callers. The live path (`processWebhookPayload`) only backfills `journey_id` by cid_hash ("Fix E", `webhook.ts:642-665`) with no stage transition, no HN fallback, no walk-in creation, and an unordered `cid_hash IN (...)` that can pick an old DELIVERED journey.

**Files:**
- Create: `tests/unit/services/webhook-labor-journey.test.ts`
- Modify: `src/services/journey.ts:96-102` (`transitionToLabor` idempotency guard)
- Modify: `src/services/webhook.ts:639-665` (replace Fix E with `linkJourneyToLabor` loop)
- Modify: `src/services/sync/polling.ts:1014-1027` (parity: same loop after `upsertCachedPatients`)
- Modify: `tests/unit/services/journey.test.ts` (add idempotency case)

**Interfaces:**
- Consumes: `linkJourneyToLabor(db, hospitalId, patientHn, cachedPatientId, cidHash?, encryptedCid?): Promise<string>` from `@/services/sync` (barrel export; `webhook.ts` already imports `upsertCachedPatients` from it). Each call is wrapped in `db.transaction(...)` at the call site (spec 3.1: link + stage transition commit together) — the helper's internal calls all take `db: DatabaseAdapter`, so the tx adapter composes unchanged; the helper itself must never open its own transaction (nesting throws).
- Changed: `transitionToLabor(db, journeyId)` — same signature, now idempotent (`WHERE … AND care_stage <> 'LABOR'`, mirroring `transitionToDelivered`), because it now runs on every 30 s sync cycle.

- [ ] **Step 1: Write the failing regression tests**

```ts
// tests/unit/services/webhook-labor-journey.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { processWebhookPayload } from '@/services/webhook';
import { createJourney, transitionToDelivered } from '@/services/journey';
import { AncRiskLevel, CareStage } from '@/types/domain';
import { SseManager } from '@/lib/sse';
import { generateKey } from '@/lib/encryption';

process.env.ENCRYPTION_KEY = generateKey();

let db: DatabaseAdapter;
const HCODE = '99902';
const CID = '1100500090006'; // checksum-valid synthetic
const CID_HASH = createHash('sha256').update(CID).digest('hex');

async function hospitalId(): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [HCODE]);
  return rows[0].id;
}

// Minimal labor patient passing validatePayload — if processWebhookPayload
// requires more fields, mirror the smallest passing patient object used in
// tests/unit/services/webhook.test.ts.
function laborPayload(overrides: Record<string, unknown> = {}) {
  return {
    hospitalCode: HCODE,
    patients: [
      {
        an: 'AN-B1',
        hn: 'HN-B1',
        cid: CID,
        name: 'นางทดสอบ คลอด',
        admit_date: '2026-07-13T08:00:00Z',
        labor_status: 'ACTIVE',
        ...overrides,
      },
    ],
  };
}

describe('labor ingestion -> journey LABOR transition', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    SseManager.resetForTests();
  });

  it('transitions an existing PREGNANCY journey to LABOR and links the patient', async () => {
    const journey = await createJourney(db, {
      hospitalId: await hospitalId(), hn: 'HN-B1', personAncId: null, name: '', cid: '',
      cidHash: CID_HASH, age: 30, gravida: 1, para: 0, lmp: null, edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });

    await processWebhookPayload(db, await hospitalId(), laborPayload() as never, SseManager.getInstance());

    const j = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE id = ?', [journey.id]);
    expect(j[0].care_stage).toBe(CareStage.LABOR);
    const p = await db.query<{ journey_id: string }>(
      'SELECT journey_id FROM cached_patients WHERE an = ?', ['AN-B1']);
    expect(p[0].journey_id).toBe(journey.id);
  });

  it('creates a LABOR journey for a walk-in with no prior ANC', async () => {
    await processWebhookPayload(db, await hospitalId(), laborPayload() as never, SseManager.getInstance());
    const j = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE cid_hash = ?', [CID_HASH]);
    expect(j.length).toBe(1);
    expect(j[0].care_stage).toBe(CareStage.LABOR);
  });

  it('never regresses a DELIVERED journey', async () => {
    const journey = await createJourney(db, {
      hospitalId: await hospitalId(), hn: 'HN-B1', personAncId: null, name: '', cid: '',
      cidHash: CID_HASH, age: 30, gravida: 1, para: 0, lmp: null, edc: null,
      ancRiskLevel: AncRiskLevel.LOW,
    });
    await transitionToDelivered(db, journey.id);

    await processWebhookPayload(db, await hospitalId(), laborPayload() as never, SseManager.getInstance());

    const j = await db.query<{ care_stage: string }>(
      'SELECT care_stage FROM maternal_journeys WHERE id = ?', [journey.id]);
    expect(j[0].care_stage).toBe(CareStage.DELIVERED);
  });

  it('re-delivery is idempotent: one journey, stage_changed_at not re-stamped', async () => {
    await processWebhookPayload(db, await hospitalId(), laborPayload() as never, SseManager.getInstance());
    const first = await db.query<{ id: string; stage_changed_at: unknown }>(
      'SELECT id, stage_changed_at FROM maternal_journeys WHERE cid_hash = ?', [CID_HASH]);

    await processWebhookPayload(db, await hospitalId(), laborPayload() as never, SseManager.getInstance());
    const second = await db.query<{ id: string; stage_changed_at: unknown }>(
      'SELECT id, stage_changed_at FROM maternal_journeys WHERE cid_hash = ?', [CID_HASH]);

    expect(second.length).toBe(1);
    expect(second[0].id).toBe(first[0].id);
    expect(String(second[0].stage_changed_at)).toBe(String(first[0].stage_changed_at));
  });

  it('skips non-ACTIVE labor rows (DELIVERED payloads change no journey)', async () => {
    await processWebhookPayload(
      db, await hospitalId(),
      laborPayload({ labor_status: 'DELIVERED' }) as never,
      SseManager.getInstance(),
    );
    const j = await db.query('SELECT id FROM maternal_journeys WHERE cid_hash = ?', [CID_HASH]);
    expect(j.length).toBe(0); // no walk-in journey minted for a delivered row
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/services/webhook-labor-journey.test.ts`
Expected: FAIL — journey stays `PREGNANCY`; walk-in creates no journey.

- [ ] **Step 3: Make `transitionToLabor` idempotent**

In `src/services/journey.ts` replace `transitionToLabor`:

```ts
export async function transitionToLabor(db: DatabaseAdapter, journeyId: string): Promise<void> {
  const now = new Date().toISOString();
  // Idempotent: linkJourneyToLabor runs on every sync cycle (~30 s); avoid
  // re-stamping stage_changed_at on a journey already in LABOR (same
  // dashboard-KPI rationale as transitionToDelivered below).
  await db.execute(
    `UPDATE maternal_journeys SET care_stage = ?, stage_changed_at = ?, updated_at = ?
      WHERE id = ? AND care_stage <> ?`,
    [CareStage.LABOR, now, now, journeyId, CareStage.LABOR],
  );
}
```

Add to `tests/unit/services/journey.test.ts` (transitionToLabor describe):

```ts
  it('does not re-stamp stage_changed_at when already in LABOR', async () => {
    await transitionToLabor(db, journeyId);
    const first = await db.query<{ stage_changed_at: unknown }>(
      'SELECT stage_changed_at FROM maternal_journeys WHERE id = ?', [journeyId]);
    await transitionToLabor(db, journeyId);
    const second = await db.query<{ stage_changed_at: unknown }>(
      'SELECT stage_changed_at FROM maternal_journeys WHERE id = ?', [journeyId]);
    expect(String(second[0].stage_changed_at)).toBe(String(first[0].stage_changed_at));
  });
```

(match the file's existing setup variable names).

- [ ] **Step 4: Wire `linkJourneyToLabor` into the live path**

In `src/services/webhook.ts`: add `linkJourneyToLabor` to the existing `@/services/sync` import, then replace the entire Fix E block (lines 642-665, the `const cidHashes = …` through its closing brace) with:

```ts
  // Link each ACTIVE labor admission to its maternal journey and transition
  // PREGNANCY -> LABOR (walk-ins get a LABOR journey). linkJourneyToLabor is
  // the single service-layer entry point: cid-hash-first + HN-fallback
  // lookup, stage guard (DELIVERED journeys are never regressed), FK write.
  // One transaction per patient (spec 3.1): the journey_id link and the
  // stage transition (or walk-in creation) commit together.
  for (const p of patients) {
    if ((p.laborStatus ?? 'ACTIVE') !== 'ACTIVE') continue;
    const rows = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
      [hospitalId, p.an],
    );
    if (rows.length === 0) continue;
    await db.transaction((tx) =>
      linkJourneyToLabor(tx, hospitalId, p.hn, rows[0].id, p.cidHash ?? null, p.cid ?? null),
    );
  }
```

- [ ] **Step 5: Parity patch for the dormant polling path**

In `src/services/sync/polling.ts`, immediately after `const count = await upsertCachedPatients(db, hospitalId, patients);` (line ~1020), insert the identical loop (the mapped rows already carry `cidHash`/`cid`):

```ts
    // Parity with processWebhookPayload: link + LABOR-transition each active
    // admission (prod runs browser-only sync; this path must not diverge).
    for (const p of patients) {
      if ((p.laborStatus ?? 'ACTIVE') !== 'ACTIVE') continue;
      const rows = await db.query<{ id: string }>(
        'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
        [hospitalId, p.an],
      );
      if (rows.length === 0) continue;
      await db.transaction((tx) =>
        linkJourneyToLabor(tx, hospitalId, p.hn, rows[0].id, p.cidHash ?? null, p.cid ?? null),
      );
    }
```

(`polling.ts` imports from sibling modules — add `linkJourneyToLabor` to its `./anc` import.)

- [ ] **Step 6: Run tests + typecheck + adjacent suites**

Run: `npx vitest run tests/unit/services/webhook-labor-journey.test.ts tests/unit/services/journey.test.ts tests/unit/services/sync-journey.test.ts tests/unit/services/webhook.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/journey.ts src/services/webhook.ts src/services/sync/polling.ts tests/unit/services/webhook-labor-journey.test.ts tests/unit/services/journey.test.ts
git commit -m "fix(clinical): labor admissions transition journeys to LABOR

linkJourneyToLabor existed fully tested but had zero production callers, so
journeys went PREGNANCY -> (skip LABOR) -> DELIVERED and LABOR dashboards
never saw anyone. The live webhook/browser-push path now calls it per active
admission (replacing the journey_id-only Fix E backfill), transitionToLabor
is idempotent for 30s sync cycles, and polling gets the parity patch.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B2: Canonical ANC risk — derived severity can never be understated

Context: `recordAncRiskScreening` lets any valid declared level (including an understated `LOW`) win over the item-derived level; the journey column is worse — raw unvalidated `patient.riskLevel` strings land in `maternal_journeys.anc_risk_level` (an integration test currently pins `'HIGH'`, an invalid enum value, being stored). Journey and screening can also diverge when `riskLevel` is absent but `riskItemIds` present.

**Files:**
- Create: `tests/unit/services/webhook-anc-validation.test.ts`
- Modify: `tests/unit/services/webhook-anc-risk.test.ts` (declared-vs-derived cases)
- Modify: `src/services/webhook.ts:498-539` (`validateAncPayload`), `809-851` (`recordAncRiskScreening`), `977-1067` (journey write + SSE)
- Modify: `tests/integration/webhook-anc-referral.test.ts:~182` (repinned: invalid `'HIGH'` no longer stored)

**Interfaces:**
- Produces: `resolveCanonicalAncRisk(declaredLevel: string | undefined, riskItemIds: number[] | null | undefined): AncRiskLevel | null` exported from `@/services/webhook` — `null` = legacy payload with no usable signal; otherwise `max(validDeclared, derivedFromItems)` by `ANC_RISK_LEVEL_ORDER` (from `@/config/anc-risk-rules` — the one shared order, no third copy).
- Changed: `recordAncRiskScreening(db, journeyId, level: AncRiskLevel, itemIds: number[])` — takes the canonical level instead of re-deciding; still derives Thai labels via `classifyAncItems`.
- Changed: `validateAncPayload` — rejects `riskLevel` outside the `AncRiskLevel` enum, non-integer `riskItemIds`, and unparseable `lmp`/`edc`/`birthday`.

- [ ] **Step 1: Write failing boundary-validation tests**

```ts
// tests/unit/services/webhook-anc-validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateAncPayload } from '@/services/webhook';

const VALID_CID = '1100500090006';

function payload(patient: Record<string, unknown>) {
  return { patients: [{ name: 'นางทดสอบ', cid: VALID_CID, hn: 'HN1', pregNo: 1, ...patient }] };
}

describe('validateAncPayload risk/date validation', () => {
  it('rejects a riskLevel outside the enum', () => {
    const r = validateAncPayload(payload({ riskLevel: 'HIGH' }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/riskLevel/);
  });

  it('accepts the four canonical levels and absent riskLevel', () => {
    for (const level of ['LOW', 'HR1', 'HR2', 'HR3', undefined]) {
      expect(validateAncPayload(payload({ riskLevel: level })).valid).toBe(true);
    }
  });

  it('rejects non-integer riskItemIds', () => {
    expect(validateAncPayload(payload({ riskItemIds: [1, 'x'] })).valid).toBe(false);
    expect(validateAncPayload(payload({ riskItemIds: [1, 2.5] })).valid).toBe(false);
    expect(validateAncPayload(payload({ riskItemIds: [3, 16] })).valid).toBe(true);
  });

  it('rejects unparseable dates', () => {
    expect(validateAncPayload(payload({ lmp: 'ไม่ใช่วันที่' })).valid).toBe(false);
    expect(validateAncPayload(payload({ edc: '2026-13-45' })).valid).toBe(false);
    expect(validateAncPayload(payload({ lmp: '2026-01-15', edc: null })).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing declared-vs-derived tests**

Append to `tests/unit/services/webhook-anc-risk.test.ts` (reuse its `payload(riskItemIds, riskLevel)` builder, `createTestDb`, `MockSseManager`/`asSse`, hospital `99902`; item 16 = โรคหัวใจ, HR3):

```ts
  it('declared LOW cannot mask HR3 items — screening AND journey store HR3', async () => {
    await processAncWebhook(db, hospitalId, payload([16], 'LOW'), asSse(sseManager));
    const screening = await db.query<{ risk_level: string }>(
      `SELECT risk_level FROM cached_anc_risks ORDER BY created_at DESC LIMIT 1`);
    expect(screening[0].risk_level).toBe('HR3');
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`);
    expect(journey[0].anc_risk_level).toBe('HR3');
  });

  it('declared level HIGHER than derived is preserved (upward clinical override)', async () => {
    await processAncWebhook(db, hospitalId, payload([], 'HR2'), asSse(sseManager));
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`);
    expect(journey[0].anc_risk_level).toBe('HR2');
  });

  it('missing declared level with items still derives the level for the journey', async () => {
    await processAncWebhook(db, hospitalId, payload([16], undefined), asSse(sseManager));
    const journey = await db.query<{ anc_risk_level: string }>(
      `SELECT anc_risk_level FROM maternal_journeys LIMIT 1`);
    expect(journey[0].anc_risk_level).toBe('HR3');
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/services/webhook-anc-validation.test.ts tests/unit/services/webhook-anc-risk.test.ts`
Expected: FAIL — `'HIGH'` passes validation; screening stores `LOW` for HR3 items; journey keeps stale/declared level.

- [ ] **Step 4: Implement canonical resolution**

In `src/services/webhook.ts` add (near `recordAncRiskScreening`; `ANC_RISK_LEVEL_ORDER` import added to the existing `@/config/anc-risk-rules` import):

```ts
function maxRiskLevel(a: AncRiskLevel, b: AncRiskLevel): AncRiskLevel {
  return ANC_RISK_LEVEL_ORDER[a] >= ANC_RISK_LEVEL_ORDER[b] ? a : b;
}

/**
 * Canonical ANC risk (2026-07-13 clinical rule): the item-derived severity is
 * authoritative and a declared level may only RAISE it, never lower it.
 * Returns null for legacy payloads carrying neither usable signal.
 */
export function resolveCanonicalAncRisk(
  declaredLevel: string | undefined,
  riskItemIds: number[] | null | undefined,
): AncRiskLevel | null {
  const declared =
    declaredLevel && (Object.values(AncRiskLevel) as string[]).includes(declaredLevel)
      ? (declaredLevel as AncRiskLevel)
      : null;
  if (!Array.isArray(riskItemIds)) return declared;
  const derived = classifyAncItems(riskItemIds).level as AncRiskLevel;
  if (declared && ANC_RISK_LEVEL_ORDER[declared] < ANC_RISK_LEVEL_ORDER[derived]) {
    logger.warn('anc_declared_risk_understated', { declared, derived });
  }
  return declared ? maxRiskLevel(declared, derived) : derived;
}
```

- [ ] **Step 5: Apply the canonical level everywhere in the per-patient loop**

In `processAncWebhook`'s per-patient loop (lines 977-1067):

1. Before the journey write compute once:
   ```ts
   const canonicalRisk = resolveCanonicalAncRisk(patient.riskLevel, patient.riskItemIds);
   ```
2. UPDATE branch: replace `patient.riskLevel ?? existing.ancRiskLevel` with `canonicalRisk ?? existing.ancRiskLevel`; the SSE broadcast's `ancRiskLevel:` likewise becomes `canonicalRisk ?? existing.ancRiskLevel ?? undefined`.
3. CREATE branch: replace `(patient.riskLevel as AncRiskLevel) ?? AncRiskLevel.LOW` with `canonicalRisk ?? AncRiskLevel.LOW`; SSE `ancRiskLevel: canonicalRisk ?? undefined`.
4. Screening call becomes:
   ```ts
   if (Array.isArray(patient.riskItemIds) && canonicalRisk) {
     await recordAncRiskScreening(db, journeyId, canonicalRisk, patient.riskItemIds);
   }
   ```
   (B3 step 4 then moves this whole per-patient block inside one transaction — B2 only fixes the values.)
5. `recordAncRiskScreening` signature: `(db, journeyId, level: AncRiskLevel, itemIds: number[])` — delete its internal `declaredLevel in ANC_RISK_CONFIGS` selection; keep `classifyAncItems(itemIds)` only for `labels`; dedup comparison and INSERT unchanged.

- [ ] **Step 6: Add boundary validation**

In `validateAncPayload`'s per-patient loop append (`AncRiskLevel` already imported in webhook.ts):

```ts
    if (p.riskLevel !== undefined && p.riskLevel !== null) {
      if (
        typeof p.riskLevel !== 'string' ||
        !(Object.values(AncRiskLevel) as string[]).includes(p.riskLevel)
      ) {
        errors.push(`patients[${i}].riskLevel must be one of LOW|HR1|HR2|HR3`);
      }
    }
    if (p.riskItemIds !== undefined && p.riskItemIds !== null) {
      if (
        !Array.isArray(p.riskItemIds) ||
        p.riskItemIds.some((x) => typeof x !== 'number' || !Number.isInteger(x))
      ) {
        errors.push(`patients[${i}].riskItemIds must be an array of integer item IDs`);
      }
    }
    for (const field of ['lmp', 'edc', 'birthday'] as const) {
      const v = p[field];
      if (v !== undefined && v !== null && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
        errors.push(`patients[${i}].${field} must be an ISO date string`);
      }
    }
```

- [ ] **Step 7: Repin the integration test**

`tests/integration/webhook-anc-referral.test.ts` line ~182 asserts `anc_risk_level === 'HIGH'` after re-sending with `riskLevel: 'HIGH'`. That payload now fails boundary validation at the routes, and at service level the invalid string resolves to `null` (existing level retained). Update the scenario: re-send with `riskLevel: 'HR2'` and assert `anc_risk_level === 'HR2'`; add a sibling assertion that re-sending `riskLevel: 'LOW'` after `HR2` **with no riskItemIds** lowers to `LOW` (declared-only legacy payloads remain declared-driven — the no-lowering rule applies to item-bearing payloads; note this in a comment).

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run tests/unit/services/webhook-anc-validation.test.ts tests/unit/services/webhook-anc-risk.test.ts tests/integration/webhook-anc-referral.test.ts tests/unit/config/anc-classifying-canon.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/webhook.ts tests/unit/services/webhook-anc-validation.test.ts tests/unit/services/webhook-anc-risk.test.ts tests/integration/webhook-anc-referral.test.ts
git commit -m "fix(clinical): derived ANC risk is authoritative and cannot be understated

A declared riskLevel of LOW previously masked HR3-triggering classifying
items in screenings, and raw unvalidated strings ('HIGH') were written to
maternal_journeys.anc_risk_level. The canonical level is now
max(validated declared, item-derived), applied consistently to journey,
screening, and SSE; the webhook boundary rejects invalid riskLevel /
riskItemIds / dates; understated payloads are logged for upstream fixing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B3: Atomic patient deletion + pregnancy rollover + fail-safe active-journey uniqueness

Context: labor-patient deletion runs 3 sequential DELETEs and MISSES `cached_partograph_observations` — since that table's FK to `cached_patients` has no ON DELETE action, the patient DELETE **throws an FK violation** whenever observations exist, after cpd/vitals were already deleted. Pregnancy rollover (`transitionToDelivered` + `createJourney`) is two non-transactional statements at two sites. The unique index `uq_mj_hospital_hn_active` referenced by code comments does not exist anywhere.

**Files:**
- Create: `tests/unit/services/webhook-delete-atomicity.test.ts`
- Create: `src/db/migrations/maternal-journeys-active-unique.ts`
- Create: `tests/unit/db/maternal-journeys-active-unique-migration.test.ts`
- Modify: `src/services/webhook.ts:577-594` (labor delete), `898-922` (ANC journey delete), `1005-1045` (rollover)
- Modify: `src/services/sync/anc.ts:116-142` (rollover parity)
- Modify: `src/app/api/startup.ts` (wire migration after `migrateAuditLogsActor`)

**Interfaces:**
- Consumes: `FailingAdapter` from `tests/helpers/failingDb` (Release A task A3); `createPgliteDb` from `tests/helpers/createPgliteDb`.
- Produces: `migrateMaternalJourneysActiveUnique(db: DatabaseAdapter): Promise<void>` — idempotent; creates partial unique index `uq_mj_hospital_hn_active ON maternal_journeys (hospital_id, hn) WHERE care_stage IN ('PREGNANCY','LABOR') AND hn <> ''`; **fails safe**: when duplicates exist it reports and skips (no data rewrite).
- Deletion contract (complete patient-owned set, verified against `src/db/tables`): `cpd_scores`, `cached_vital_signs`, `cached_partograph_observations` → then `cached_patients`.

- [ ] **Step 1: Write failing deletion-atomicity tests**

```ts
// tests/unit/services/webhook-delete-atomicity.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createTestDb } from '../../helpers/testDb';
import { FailingAdapter } from '../../helpers/failingDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { processWebhookPayload } from '@/services/webhook';
import { SseManager } from '@/lib/sse';
import { generateKey } from '@/lib/encryption';

process.env.ENCRYPTION_KEY = generateKey();

let db: DatabaseAdapter;
const HCODE = '99902';
const CID = '1100500090006';

async function hospitalId(): Promise<string> {
  const rows = await db.query<{ id: string }>('SELECT id FROM hospitals WHERE hcode = ?', [HCODE]);
  return rows[0].id;
}

async function seedLaborPatientWithClinicalData(): Promise<string> {
  const hid = await hospitalId();
  await processWebhookPayload(
    db, hid,
    {
      hospitalCode: HCODE,
      patients: [{
        an: 'AN-B3', hn: 'HN-B3', cid: CID, name: 'นางทดสอบ ลบ',
        admit_date: '2026-07-13T08:00:00Z', labor_status: 'ACTIVE',
      }],
    } as never,
    SseManager.getInstance(),
  );
  const p = await db.query<{ id: string }>(
    'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?', [hid, 'AN-B3']);
  const patientId = p[0].id;
  const now = new Date().toISOString();
  // one partograph observation — the table the old delete path missed
  await db.execute(
    `INSERT INTO cached_partograph_observations
       (id, patient_id, hospital_id, source_system, source_pk, observe_datetime,
        synced_at, created_at, updated_at)
     VALUES (?, ?, ?, 'webhook', 'obs-b3-1', ?, ?, ?, ?)`,
    [crypto.randomUUID(), patientId, hid, now, now, now, now],
  );
  await db.execute(
    `INSERT INTO cached_vital_signs (id, patient_id, hospital_id, created_at)
     VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), patientId, hid, now],
  );
  return patientId;
}
// NOTE: if either INSERT hits a NOT NULL column not listed here, extend the
// column list from src/db/tables/cached-partograph-observations.ts /
// cached-vital-signs.ts rather than seeding through services.

const deletePayload = {
  hospitalCode: HCODE,
  patients: [{ an: 'AN-B3', hn: 'HN-B3', cid: CID, name: 'นางทดสอบ ลบ', action: 'delete' }],
};

describe('labor patient deletion atomicity', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    SseManager.resetForTests();
  });

  it('deletes the patient AND all dependent clinical rows (incl. partograph)', async () => {
    const patientId = await seedLaborPatientWithClinicalData();
    await processWebhookPayload(db, await hospitalId(), deletePayload as never, SseManager.getInstance());

    for (const table of ['cached_patients', 'cached_vital_signs', 'cached_partograph_observations']) {
      const col = table === 'cached_patients' ? 'id' : 'patient_id';
      const rows = await db.query(`SELECT ${col} FROM ${table} WHERE ${col} = ?`, [patientId]);
      expect(rows, table).toEqual([]);
    }
  });

  it('an injected failure leaves ALL clinical rows intact (rollback)', async () => {
    const patientId = await seedLaborPatientWithClinicalData();
    const failing = new FailingAdapter(db, /DELETE FROM cached_patients/);

    await expect(
      processWebhookPayload(failing, await hospitalId(), deletePayload as never, SseManager.getInstance()),
    ).rejects.toThrow(/injected failure/);

    const vitals = await db.query(
      'SELECT id FROM cached_vital_signs WHERE patient_id = ?', [patientId]);
    expect(vitals.length).toBe(1);
    const obs = await db.query(
      'SELECT id FROM cached_partograph_observations WHERE patient_id = ?', [patientId]);
    expect(obs.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/services/webhook-delete-atomicity.test.ts`
Expected: FAIL — first test throws an FK violation from `cached_partograph_observations`; second test finds vitals already deleted (partial state).

- [ ] **Step 3: Make deletions transactional and complete**

In `src/services/webhook.ts` replace the delete loop (577-594):

```ts
  // Handle deletes first — remove patients marked for deletion. All
  // patient-owned tables (cpd_scores, cached_vital_signs,
  // cached_partograph_observations) and the patient row commit or roll back
  // together; a partial delete must never survive a failure.
  const toDelete = payload.patients.filter((p) => p.action === 'delete');
  let deletedCount = 0;
  for (const p of toDelete) {
    await db.transaction(async (tx) => {
      for (const table of [
        'cpd_scores',
        'cached_vital_signs',
        'cached_partograph_observations',
      ]) {
        await tx.execute(
          `DELETE FROM ${table} WHERE patient_id IN (SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?)`,
          [hospitalId, p.an],
        );
      }
      await tx.execute(`DELETE FROM cached_patients WHERE hospital_id = ? AND an = ?`, [
        hospitalId,
        p.an,
      ]);
    });
    deletedCount++;
  }
```

And wrap the ANC journey delete (902-911) — the six statements from `DELETE FROM cached_anc_visits …` through `DELETE FROM maternal_journeys …` — in one `await db.transaction(async (tx) => { … })`, switching each `db.execute` to `tx.execute`.

- [ ] **Step 4: Make the per-patient journey block atomic (rollover + risk + screening)**

`src/services/webhook.ts` (`processAncWebhook` per-patient loop, lines ~977-1067 after B2): wrap the WHOLE journey section — update-or-create (including the rollover pair), the location update, and the screening insert — in ONE transaction per patient, and emit SSE only after commit. This satisfies spec 3.2 ("journey risk in the same transaction as the screening row") and 3.3 (rollover atomicity) in one restructure:

```ts
    // ONE transaction per patient (specs 3.2 + 3.3): journey update-or-create
    // (including pregnancy rollover), location update, and the risk screening
    // commit or roll back together. SSE fires only after commit.
    const sseEvents: Array<Record<string, unknown>> = [];
    const journeyId = await db.transaction(async (tx) => {
      let id: string;
      if (!shouldCreateNew && existing) {
        // ... the EXISTING journey UPDATE statement, executed via tx, with
        //     anc_risk_level = canonicalRisk ?? existing.ancRiskLevel (B2) ...
        id = existing.id;
        sseEvents.push({
          type: 'journey_update',
          hcode,
          journeyId: existing.id,
          careStage: existing.careStage,
          ancRiskLevel: canonicalRisk ?? existing.ancRiskLevel ?? undefined,
        });
        updated++;
      } else {
        const age = patient.birthday
          ? Math.floor(
              (Date.now() - new Date(patient.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000),
            )
          : 0;
        // Rollover atomicity: closing the old pregnancy and creating the new
        // one commit together — a crash can never leave zero active journeys.
        if (isNewPregnancy && existingIsActive && existing) {
          await transitionToDelivered(tx, existing.id);
        }
        const journey = await createJourney(tx, {
          hospitalId,
          hn: patientHn ?? '', // null for community ANC patients not in hospital patient table
          personAncId: null,
          name: encryptedName,
          cid: encryptedCid,
          cidHash,
          age,
          gravida: patient.pregNo,
          para: 0,
          lmp: patient.lmp ?? null,
          edc: patient.edc ?? null,
          ancRiskLevel: canonicalRisk ?? AncRiskLevel.LOW,
        });
        id = journey.id;
        sseEvents.push({
          type: 'journey_update',
          hcode,
          journeyId: journey.id,
          careStage: 'PREGNANCY',
          ancRiskLevel: canonicalRisk ?? undefined,
        });
        created++;
      }

      if (patient.changwatCode || patient.amphurCode || patient.tambonCode) {
        // ... the EXISTING location UPDATE statement, executed via tx ...
      }

      if (Array.isArray(patient.riskItemIds) && canonicalRisk) {
        await recordAncRiskScreening(tx, id, canonicalRisk, patient.riskItemIds);
      }
      return id;
    });
    for (const event of sseEvents) {
      sseManager.broadcast('patient-update', event);
    }
```

(`recordAncRiskScreening` takes `db: DatabaseAdapter` so the tx adapter drops in; it must not open its own transaction. Keep the `updated`/`created` counters exactly as the surrounding code expects — move the increments if the current code counts after the SSE call.)

`src/services/sync/anc.ts` (116-142) — parity for the dormant polling path: the narrower rollover-pair transaction is sufficient there (its screening insert lives in a separate later phase of `syncAncData`; full restructure of dead code is not warranted):

```ts
    if (shouldCreateNew) {
      const createInput = {
        hospitalId,
        hn: anc.hn,
        personAncId: anc.person_anc_id,
        name: encryptedName,
        cid: encryptedCid ?? '',
        cidHash: cidHash ?? '',
        age,
        gravida: anc.preg_no,
        para: 0,
        lmp: anc.lmp,
        edc: anc.edc,
        ancRiskLevel: AncRiskLevel.LOW,
      };
      journey =
        isNewPregnancy && existingIsActive && journey
          ? await db.transaction(async (tx) => {
              await transitionToDelivered(tx, journey!.id);
              return createJourney(tx, createInput);
            })
          : await createJourney(db, createInput);
    } else {
```

Add a rollover-rollback regression test to `tests/unit/services/webhook-delete-atomicity.test.ts` (same file — it owns the FailingAdapter harness):

```ts
describe('pregnancy rollover atomicity', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    SseManager.resetForTests();
  });

  it('a failed new-journey INSERT leaves the old journey un-closed', async () => {
    const { processAncWebhook } = await import('@/services/webhook');
    const hid = await hospitalId();
    const ancPatient = (pregNo: number) => ({
      hospitalCode: HCODE,
      patients: [{ name: 'นางทดสอบ โรลโอเวอร์', cid: CID, hn: 'HN-B3R', pregNo }],
    });
    await processAncWebhook(db, hid, ancPatient(1) as never, SseManager.getInstance());

    const failing = new FailingAdapter(db, /INSERT INTO maternal_journeys/);
    await expect(
      processAncWebhook(failing, hid, ancPatient(2) as never, SseManager.getInstance()),
    ).rejects.toThrow(/injected failure/);

    const stages = await db.query<{ care_stage: string }>(
      `SELECT care_stage FROM maternal_journeys WHERE cid_hash = ?`,
      [createHash('sha256').update(CID).digest('hex')],
    );
    expect(stages.length).toBe(1);
    expect(stages[0].care_stage).toBe('PREGNANCY'); // NOT stranded as DELIVERED
  });
});
```

- [ ] **Step 5: Write the failing migration tests**

```ts
// tests/unit/db/maternal-journeys-active-unique-migration.test.ts
import { describe, it, expect } from 'vitest';
import { createPgliteDb } from '../../helpers/createPgliteDb';
import { migrateMaternalJourneysActiveUnique } from '@/db/migrations/maternal-journeys-active-unique';
import { SeedOrchestrator } from '@/db/seeds/index';
import { createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';

async function seededDb() {
  const db = await createPgliteDb();
  await new SeedOrchestrator().run(db);
  const rows = await db.query<{ id: string }>(`SELECT id FROM hospitals LIMIT 1`);
  return { db, hospitalId: rows[0].id };
}

function journeyInput(hospitalId: string, hn: string, cidHash: string) {
  return {
    hospitalId, hn, personAncId: null, name: '', cid: '', cidHash,
    age: 30, gravida: 1, para: 0, lmp: null, edc: null, ancRiskLevel: AncRiskLevel.LOW,
  };
}

describe('migrateMaternalJourneysActiveUnique', () => {
  it('creates the partial unique index on a clean database, idempotently', async () => {
    const { db } = await seededDb();
    await migrateMaternalJourneysActiveUnique(db);
    await migrateMaternalJourneysActiveUnique(db); // second run: no-op
    const idx = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'maternal_journeys' AND indexname = 'uq_mj_hospital_hn_active'`,
    );
    expect(idx.length).toBe(1);
    await db.close();
  });

  it('enforces one active journey per hospital+hn once applied; hn="" exempt', async () => {
    const { db, hospitalId } = await seededDb();
    await migrateMaternalJourneysActiveUnique(db);
    await createJourney(db, journeyInput(hospitalId, 'HN-U1', 'h1'));
    await expect(createJourney(db, journeyInput(hospitalId, 'HN-U1', 'h2'))).rejects.toThrow();
    // community-ANC journeys (hn = '') never collide:
    await createJourney(db, journeyInput(hospitalId, '', 'h3'));
    await createJourney(db, journeyInput(hospitalId, '', 'h4'));
    await db.close();
  });

  it('FAILS SAFE with existing duplicates: reports, skips index, rewrites nothing', async () => {
    const { db, hospitalId } = await seededDb();
    await createJourney(db, journeyInput(hospitalId, 'HN-DUP', 'd1'));
    await createJourney(db, journeyInput(hospitalId, 'HN-DUP', 'd2')); // pre-existing dirty data
    await migrateMaternalJourneysActiveUnique(db);
    const idx = await db.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_mj_hospital_hn_active'`,
    );
    expect(idx.length).toBe(0); // refused
    const rows = await db.query(`SELECT id FROM maternal_journeys WHERE hn = 'HN-DUP'`);
    expect(rows.length).toBe(2); // untouched
    await db.close();
  });
});
```

- [ ] **Step 6: Implement the migration + wire into startup**

```ts
// src/db/migrations/maternal-journeys-active-unique.ts
import type { DatabaseAdapter } from '@/db/adapter';
import { logger } from '@/lib/logger';

/**
 * One-shot idempotent migration: at most one ACTIVE (PREGNANCY/LABOR) journey
 * per (hospital_id, hn). Community-ANC journeys (hn = '') carry no HN
 * identity and are exempt.
 *
 * FAILS SAFE (Release B reconciliation contract): when duplicates already
 * exist the index is NOT created and the duplicates are reported for manual
 * clinical review — historical rows are never rewritten here. Cannot go via
 * the table definition: SchemaSync has no partial-index support and
 * syncIndexes swallows errors.
 */
export async function migrateMaternalJourneysActiveUnique(db: DatabaseAdapter): Promise<void> {
  const dupes = await db.query<{ hospital_id: string; hn: string; n: number }>(
    `SELECT hospital_id, hn, COUNT(*) as n
       FROM maternal_journeys
      WHERE care_stage IN ('PREGNANCY', 'LABOR') AND hn <> ''
      GROUP BY hospital_id, hn
     HAVING COUNT(*) > 1`,
  );
  if (dupes.length > 0) {
    logger.error('mj_active_unique_blocked_by_duplicates', {
      duplicateGroups: dupes.length,
      hospitals: [...new Set(dupes.map((d) => d.hospital_id))].length,
    });
    return;
  }
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_mj_hospital_hn_active
       ON maternal_journeys (hospital_id, hn)
       WHERE care_stage IN ('PREGNANCY', 'LABOR') AND hn <> ''`,
  );
  logger.info('mj_active_unique_created', {});
}
```

In `src/app/api/startup.ts`, after `await migrateAuditLogsActor(db);` add:

```ts
    // 2c. One-shot idempotent migration: partial unique index guaranteeing a
    // single active journey per hospital+hn (fails safe on dirty data).
    await migrateMaternalJourneysActiveUnique(db);
```

with the corresponding import.

- [ ] **Step 7: Run tests + typecheck + adjacent suites**

Run: `npx vitest run tests/unit/services/webhook-delete-atomicity.test.ts tests/unit/db/maternal-journeys-active-unique-migration.test.ts tests/integration/webhook-anc-referral.test.ts tests/unit/services/sync-journey.test.ts && npx tsc --noEmit`
Expected: PASS. (Watch `sync-journey.test.ts` — the rollover restructure in `sync/anc.ts` must not change its assertions.)

- [ ] **Step 8: Commit**

```bash
git add src/services/webhook.ts src/services/sync/anc.ts src/db/migrations/maternal-journeys-active-unique.ts src/app/api/startup.ts tests/unit/services/webhook-delete-atomicity.test.ts tests/unit/db/maternal-journeys-active-unique-migration.test.ts
git commit -m "fix(clinical): atomic deletion/rollover + fail-safe active-journey uniqueness

Labor-patient deletion missed cached_partograph_observations (whose FK then
aborted the delete mid-sequence, stranding partial state) and ran without a
transaction; pregnancy rollover could strand a mother with zero active
journeys. Deletions and rollovers are now transactional at both live sites,
and a startup migration adds the long-promised uq_mj_hospital_hn_active
partial unique index — refusing (and reporting) rather than rewriting when
historical duplicates exist.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B4: Partograph atomic upsert, transactional batches, shared ANC dedup, 10 cm cap

Context corrections vs the review: the unique index `uniq_cpo_source` EXISTS — the defect is that concurrent select-then-insert throws an unhandled unique violation which aborts a non-transactional batch partway (skipping severity roll-up + SSE + ONLINE update). ANC screening dedup already exists on the webhook path; only the prod-dead polling path (`upsertAncRisk`) blind-inserts. `calculateAlertLine` is already capped at 10; only `analyzeCervix` rules 10/11 lack the cap.

**Files:**
- Modify: `tests/unit/services/sync-partograph-upsert.test.ts` (concurrency + batch-atomicity cases)
- Modify: `src/services/sync/partograph.ts:137-304` (`ON CONFLICT` upsert + internal transaction)
- Create: `src/services/anc-screening.ts` (shared change-only screening insert)
- Modify: `src/services/webhook.ts:809-851` (`recordAncRiskScreening` delegates to the shared helper)
- Modify: `src/services/sync/anc.ts:235-242, 323-350` (`upsertAncRisk` delegates; gains dedup)
- Modify: `tests/unit/services/sync-journey.test.ts` (polling dedup case)
- Modify: `src/services/partogram.ts:289` (cap), `tests/unit/services/partogram-cdss-cervix.test.ts` (full-dilation cases)

**Interfaces:**
- Produces: `insertAncScreeningIfChanged(db, journeyId, row: { level: string; triggeredRulesJson: string; riskFactorsJson: string; recommendedFacility: string | null; recommendedProvider: string | null }): Promise<boolean>` in `@/services/anc-screening` — inserts only when level or triggered rules differ from the latest row; returns whether a row was inserted.
- Changed: `upsertPartographObservations(db, hospitalId, rows)` — same signature; now runs its whole batch + severity roll-up inside ONE internal `db.transaction()` (callers must not already be inside a transaction — nesting throws) and uses `INSERT … ON CONFLICT (hospital_id, source_system, source_pk) DO UPDATE`.
- Changed: `analyzeCervix` expected dilation is capped at 10 cm.

- [ ] **Step 1: Write failing concurrency/atomicity tests**

Append to `tests/unit/services/sync-partograph-upsert.test.ts` (reuse its existing row builder and harness):

```ts
  it('concurrent upserts of the same source row produce ONE row and no unique-violation', async () => {
    const row = makeRow({ sourcePk: 'race-1' }); // use the file's existing row factory name
    const results = await Promise.allSettled([
      upsertPartographObservations(db, hospitalId, [row]),
      upsertPartographObservations(db, hospitalId, [row]),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await db.query(
      `SELECT id FROM cached_partograph_observations WHERE source_pk = 'race-1'`,
    );
    expect(rows.length).toBe(1);
  });

  it('a failing row rolls back the WHOLE batch (no partial ingestion)', async () => {
    const good = makeRow({ sourcePk: 'batch-1' });
    const bad = makeRow({ sourcePk: 'batch-2', patientId: crypto.randomUUID() }); // FK violation
    await expect(
      upsertPartographObservations(db, hospitalId, [good, bad]),
    ).rejects.toThrow();
    const rows = await db.query(
      `SELECT id FROM cached_partograph_observations WHERE source_pk = 'batch-1'`,
    );
    expect(rows.length).toBe(0); // good row rolled back with the bad one
  });
```

Append to `tests/unit/services/partogram-cdss-cervix.test.ts` (reuse its obs-builder):

```ts
  it('never flags a patient at full dilation (10 cm)', () => {
    // anchor 4 cm at t0; 10 cm at t0+11h. Uncapped expectation would be 15.0
    // -> CRITICAL. Capped at 10, a fully dilated patient can never be behind.
    const alerts = runCervix([
      obsAt('2026-07-13T00:00:00Z', 4),
      obsAt('2026-07-13T11:00:00Z', 10),
    ]);
    expect(alerts.filter((a) => a.section === 'CERVIX')).toEqual([]);
  });

  it('still flags genuinely slow progress below 10 cm against the capped expectation', () => {
    // 9 cm at t0+11h: capped expected = 10 -> ALERT (9 < 10), not CRITICAL (9 >= 6).
    const alerts = runCervix([
      obsAt('2026-07-13T00:00:00Z', 4),
      obsAt('2026-07-13T11:00:00Z', 9),
    ]);
    const cervix = alerts.filter((a) => a.section === 'CERVIX');
    expect(cervix.length).toBe(1);
    expect(cervix[0].severity).toBe('ALERT');
  });
```

(`runCervix`/`obsAt` = whatever builder names the file already uses — match them exactly.) Also add a **documenting** test for the out-of-scope rule 14 behavior, marked for clinical review:

```ts
  it('DOCUMENTED (pending clinical review): rule 14 still fires arrest for two 10 cm obs >2h apart', () => {
    const alerts = runCervix([
      obsAt('2026-07-13T00:00:00Z', 4),
      obsAt('2026-07-13T03:00:00Z', 10),
      obsAt('2026-07-13T05:30:00Z', 10),
    ]);
    // Second-stage patients at full dilation trigger "labour arrest"; whether
    // that is desired is a clinical-owner decision (overview decision point 2).
    expect(alerts.some((a) => a.severity === 'CRITICAL')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/services/sync-partograph-upsert.test.ts tests/unit/services/partogram-cdss-cervix.test.ts`
Expected: FAIL — concurrency case throws a unique violation OR leaves the batch partially applied; the 10 cm case reports CRITICAL.

- [ ] **Step 3: Rewrite the upsert atomically**

In `src/services/sync/partograph.ts`: rename the existing function body to a private `upsertPartographObservationsTx(tx: DatabaseAdapter, hospitalId, rows)` and export:

```ts
export async function upsertPartographObservations(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: PartographRow[],
): Promise<UpsertPartographResult> {
  // One transaction per batch: observations + severity roll-up commit or roll
  // back together. Callers must NOT already hold a transaction (no nesting).
  return db.transaction((tx) => upsertPartographObservationsTx(tx, hospitalId, rows));
}
```

Inside `upsertPartographObservationsTx`, delete the SELECT-then-UPDATE/INSERT pair (and its stale SQLite-portability comment) and replace with one atomic statement per row (`uniq_cpo_source` is the conflict target; SQLite is gone — PGlite/Postgres both support ON CONFLICT):

```ts
    await tx.execute(
      `INSERT INTO cached_partograph_observations (
         id, patient_id, hospital_id, source_system, source_pk,
         observe_datetime, hour_no,
         fetal_heart_rate, amniotic_fluid, amniotic_type_id,
         amniotic_type_name, moulding, cervical_dilation_cm,
         descent_of_head, contraction_per_10min,
         contraction_duration_sec, contraction_strength,
         oxytocin_uml, oxytocin_drops_min, drugs_iv_fluids,
         pulse, bp_systolic, bp_diastolic, temperature,
         urine_volume_ml, urine_protein, urine_glucose,
         urine_acetone, note, entry_staff, entry_datetime,
         synced_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (hospital_id, source_system, source_pk) DO UPDATE SET
         patient_id = EXCLUDED.patient_id,
         observe_datetime = EXCLUDED.observe_datetime,
         hour_no = EXCLUDED.hour_no,
         fetal_heart_rate = EXCLUDED.fetal_heart_rate,
         amniotic_fluid = EXCLUDED.amniotic_fluid,
         amniotic_type_id = EXCLUDED.amniotic_type_id,
         amniotic_type_name = EXCLUDED.amniotic_type_name,
         moulding = EXCLUDED.moulding,
         cervical_dilation_cm = EXCLUDED.cervical_dilation_cm,
         descent_of_head = EXCLUDED.descent_of_head,
         contraction_per_10min = EXCLUDED.contraction_per_10min,
         contraction_duration_sec = EXCLUDED.contraction_duration_sec,
         contraction_strength = EXCLUDED.contraction_strength,
         oxytocin_uml = EXCLUDED.oxytocin_uml,
         oxytocin_drops_min = EXCLUDED.oxytocin_drops_min,
         drugs_iv_fluids = EXCLUDED.drugs_iv_fluids,
         pulse = EXCLUDED.pulse,
         bp_systolic = EXCLUDED.bp_systolic,
         bp_diastolic = EXCLUDED.bp_diastolic,
         temperature = EXCLUDED.temperature,
         urine_volume_ml = EXCLUDED.urine_volume_ml,
         urine_protein = EXCLUDED.urine_protein,
         urine_glucose = EXCLUDED.urine_glucose,
         urine_acetone = EXCLUDED.urine_acetone,
         note = EXCLUDED.note,
         entry_staff = EXCLUDED.entry_staff,
         entry_datetime = EXCLUDED.entry_datetime,
         synced_at = EXCLUDED.synced_at,
         updated_at = EXCLUDED.updated_at`,
      [
        uuidv4(), row.patientId, hospitalId, row.sourceSystem, row.sourcePk,
        row.observeDatetime, row.hourNo,
        row.fetalHeartRate, row.amnioticFluid, row.amnioticTypeId,
        row.amnioticTypeName, row.moulding, row.cervicalDilationCm,
        row.descentOfHead, row.contractionPer10Min,
        row.contractionDurationSec, row.contractionStrength,
        row.oxytocinUml, row.oxytocinDropsMin, row.drugsIvFluids,
        row.pulse, row.bpSystolic, row.bpDiastolic, row.temperature,
        row.urineVolumeMl, row.urineProtein, row.urineGlucose,
        row.urineAcetone, row.note, row.entryStaff, row.entryDatetime,
        now, now, now,
      ],
    );
    upserted += 1;
    touchedPatients.set(row.patientId, true);
```

The delete branch and severity roll-up stay inside the tx function using `tx`. Also sweep note (project memory): `src/services/sync/patient.ts` and `upsertAncVisit` in `sync/anc.ts` share the same stale select-then-insert pattern — leave their logic (single-writer per hospital+an semantics) but update their "Mirrors the pattern…" comments to stop citing SQLite.

- [ ] **Step 4: Extract the shared screening-dedup helper**

```ts
// src/services/anc-screening.ts
// Change-only ANC screening persistence, shared by the webhook processor and
// the HOSxP polling path (constitution III — one dedup rule, two callers).
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseAdapter } from '@/db/adapter';

export interface AncScreeningRow {
  level: string;
  triggeredRulesJson: string;
  riskFactorsJson: string;
  recommendedFacility: string | null;
  recommendedProvider: string | null;
}

/** Insert a cached_anc_risks row only when level or triggered rules changed
 *  vs the latest row for the journey. Returns true when a row was inserted. */
export async function insertAncScreeningIfChanged(
  db: DatabaseAdapter,
  journeyId: string,
  row: AncScreeningRow,
): Promise<boolean> {
  const latest = await db.query<{ risk_level: string; triggered_rules: unknown }>(
    `SELECT risk_level, triggered_rules FROM cached_anc_risks
      WHERE journey_id = ? ORDER BY screened_at DESC, created_at DESC LIMIT 1`,
    [journeyId],
  );
  if (latest.length > 0) {
    // pg returns JSONB pre-parsed; normalize to compare.
    const prev = latest[0].triggered_rules;
    const prevJson = typeof prev === 'string' ? prev : JSON.stringify(prev);
    if (latest[0].risk_level === row.level && prevJson === row.triggeredRulesJson) return false;
  }
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors,
       recommended_facility, recommended_provider, screened_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(), journeyId, row.level, row.triggeredRulesJson, row.riskFactorsJson,
      row.recommendedFacility, row.recommendedProvider, now, now,
    ],
  );
  return true;
}
```

Refactor callers:
- `recordAncRiskScreening` (webhook.ts) keeps its B2 signature and becomes: compute `derived = classifyAncItems(itemIds)` for labels, then `await insertAncScreeningIfChanged(db, journeyId, { level, triggeredRulesJson: JSON.stringify(derived.labels), riskFactorsJson: JSON.stringify({ itemIds }), recommendedFacility: ANC_RISK_CONFIGS[level]?.facilityTh ?? null, recommendedProvider: ANC_RISK_CONFIGS[level]?.providerTh ?? null });`
- `upsertAncRisk` (sync/anc.ts) becomes: `await insertAncScreeningIfChanged(db, journeyId, { level: riskResult.level, triggeredRulesJson: JSON.stringify(riskResult.triggeredRules), riskFactorsJson: JSON.stringify({}), recommendedFacility: riskResult.recommendation.facilityTh, recommendedProvider: riskResult.recommendation.providerTh });` — the polling path thereby gains dedup.

Add the polling-dedup regression to `tests/unit/services/sync-journey.test.ts` (reuse its `syncAncData` fixtures):

```ts
  it('repeated unchanged ANC sync does not append duplicate screening rows', async () => {
    await syncAncData(db, hospitalId, ancPatients, ancServices, ancRisks, ancClassifying, key);
    await syncAncData(db, hospitalId, ancPatients, ancServices, ancRisks, ancClassifying, key);
    const rows = await db.query(`SELECT id FROM cached_anc_risks`);
    expect(rows.length).toBe(1);
  });
```

(match the file's actual fixture variable names/arity).

- [ ] **Step 5: Cap the expected dilation**

In `src/services/partogram.ts` (analyzeCervix, line ~289) change:

```ts
      const expected = anchorDil + hoursBetween(obs[i].observeDatetime, anchorDt);
```

to:

```ts
      // Full dilation is 10 cm — the expectation can never exceed it, so a
      // fully dilated patient is never "behind" an impossible target.
      const expected = Math.min(10, anchorDil + hoursBetween(obs[i].observeDatetime, anchorDt));
```

(`calculateAlertLine` is already capped — do not touch it.)

- [ ] **Step 6: Run tests + typecheck + full partograph suites**

Run: `npx vitest run tests/unit/services/sync-partograph-upsert.test.ts tests/unit/services/partogram-cdss-cervix.test.ts tests/unit/services/webhook-process-partograph.test.ts tests/unit/services/webhook-anc-risk.test.ts tests/unit/services/sync-journey.test.ts tests/integration/partograph-sync-pglite.test.ts tests/integration/partograph-webhook-pglite.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/sync/partograph.ts src/services/anc-screening.ts src/services/webhook.ts src/services/sync/anc.ts src/services/partogram.ts tests/unit/services/sync-partograph-upsert.test.ts tests/unit/services/partogram-cdss-cervix.test.ts tests/unit/services/sync-journey.test.ts
git commit -m "fix(clinical): atomic partograph upsert, batch tx, shared ANC dedup, 10cm cap

Concurrent delivery of one external observation aborted the batch with an
unhandled unique-violation, stranding partial rows and skipping severity
roll-up. The upsert is now INSERT..ON CONFLICT on uniq_cpo_source inside one
batch transaction; ANC screening dedup is extracted to a shared helper (the
polling path stops appending a row per cycle); and analyzeCervix caps the
expected dilation at 10 cm so full-dilation patients are never flagged
against an impossible target.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B5: Read-only clinical discrepancy report (reconciliation contract)

**Files:**
- Create: `src/services/reconciliation.ts`
- Create: `src/app/api/admin/reconciliation-report/route.ts`
- Create: `tests/unit/api/reconciliation-report.test.ts`

**Interfaces:**
- Produces: `getReconciliationReport(db: DatabaseAdapter): Promise<ReconciliationReport>` in `@/services/reconciliation` where:
  ```ts
  interface ReconciliationReport {
    generatedAt: string;
    riskMismatches: { hospitalId: string; count: number }[];   // journey level != latest screening level
    stuckPregnancyWithActiveLabor: { hospitalId: string; count: number }[];
    duplicateActiveJourneys: { hospitalId: string; hn: string; count: number }[];
    totals: { riskMismatches: number; stuckPregnancyWithActiveLabor: number; duplicateActiveJourneys: number };
  }
  ```
- Produces: `GET /api/admin/reconciliation-report` — `requireAdmin()`-guarded, read-only, de-identified (ids/counts only, no name/CID). This is the evidence artifact for the Release B clinical sign-off; nothing is mutated.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/api/reconciliation-report.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import { SeedOrchestrator } from '@/db/seeds/index';
import type { DatabaseAdapter } from '@/db/adapter';
import { UserRole, AncRiskLevel } from '@/types/domain';
import { testSessionUser } from '../../helpers/session';
import { createJourney } from '@/services/journey';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/auth', () => ({ auth: async () => (mockSessionUser ? { user: mockSessionUser } : null) }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));

import { GET } from '@/app/api/admin/reconciliation-report/route';

describe('GET /api/admin/reconciliation-report', () => {
  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
    mockSessionUser = null;
    vi.stubEnv('ADMIN_ALLOWED_CIDS', '');
    vi.stubEnv('NODE_ENV', 'development');
  });

  it('requires admin', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.NURSE });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('reports a journey whose level disagrees with its latest screening', async () => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670', role: UserRole.ADMIN });
    const hosp = await db.query<{ id: string }>(`SELECT id FROM hospitals WHERE hcode = '10670'`);
    const journey = await createJourney(db, {
      hospitalId: hosp[0].id, hn: 'HN-B5', personAncId: null, name: '', cid: '',
      cidHash: 'hash-b5', age: 30, gravida: 1, para: 0, lmp: null, edc: null,
      ancRiskLevel: AncRiskLevel.LOW, // journey says LOW…
    });
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cached_anc_risks (id, journey_id, risk_level, triggered_rules, risk_factors, screened_at, created_at)
       VALUES (?, ?, 'HR3', '[]', '{}', ?, ?)`, // …latest screening says HR3
      [crypto.randomUUID(), journey.id, now, now],
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.totals.riskMismatches).toBe(1);
    // de-identified: no patient identifiers anywhere in the payload
    expect(JSON.stringify(report)).not.toContain('hash-b5');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/reconciliation-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement service + route**

```ts
// src/services/reconciliation.ts
// Read-only discrepancy report backing the Release B clinical-data
// reconciliation contract. NEVER mutates; returns de-identified aggregates.
import type { DatabaseAdapter } from '@/db/adapter';

export interface ReconciliationReport {
  generatedAt: string;
  riskMismatches: { hospitalId: string; count: number }[];
  stuckPregnancyWithActiveLabor: { hospitalId: string; count: number }[];
  duplicateActiveJourneys: { hospitalId: string; hn: string; count: number }[];
  totals: {
    riskMismatches: number;
    stuckPregnancyWithActiveLabor: number;
    duplicateActiveJourneys: number;
  };
}

export async function getReconciliationReport(db: DatabaseAdapter): Promise<ReconciliationReport> {
  const riskMismatches = await db.query<{ hospital_id: string; count: number }>(
    `SELECT mj.current_hospital_id as hospital_id, COUNT(*) as count
       FROM maternal_journeys mj
       JOIN LATERAL (
         SELECT risk_level FROM cached_anc_risks r
          WHERE r.journey_id = mj.id
          ORDER BY r.screened_at DESC, r.created_at DESC LIMIT 1
       ) latest ON TRUE
      WHERE latest.risk_level <> mj.anc_risk_level
      GROUP BY mj.current_hospital_id`,
  );

  const stuck = await db.query<{ hospital_id: string; count: number }>(
    `SELECT mj.current_hospital_id as hospital_id, COUNT(DISTINCT mj.id) as count
       FROM maternal_journeys mj
       JOIN cached_patients p
         ON p.cid_hash = mj.cid_hash AND p.labor_status = 'ACTIVE'
      WHERE mj.care_stage = 'PREGNANCY'
      GROUP BY mj.current_hospital_id`,
  );

  const dupes = await db.query<{ hospital_id: string; hn: string; count: number }>(
    `SELECT hospital_id, hn, COUNT(*) as count
       FROM maternal_journeys
      WHERE care_stage IN ('PREGNANCY', 'LABOR') AND hn <> ''
      GROUP BY hospital_id, hn
     HAVING COUNT(*) > 1`,
  );

  const sum = (rows: { count: number }[]) => rows.reduce((acc, r) => acc + Number(r.count), 0);
  return {
    generatedAt: new Date().toISOString(),
    riskMismatches: riskMismatches.map((r) => ({ hospitalId: r.hospital_id, count: Number(r.count) })),
    stuckPregnancyWithActiveLabor: stuck.map((r) => ({ hospitalId: r.hospital_id, count: Number(r.count) })),
    duplicateActiveJourneys: dupes.map((r) => ({ hospitalId: r.hospital_id, hn: r.hn, count: Number(r.count) })),
    totals: {
      riskMismatches: sum(riskMismatches),
      stuckPregnancyWithActiveLabor: sum(stuck),
      duplicateActiveJourneys: sum(dupes),
    },
  };
}
```

```ts
// src/app/api/admin/reconciliation-report/route.ts
// GET — read-only clinical discrepancy report (Release B reconciliation gate).
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { getReconciliationReport } from '@/services/reconciliation';
import { logger } from '@/lib/logger';

export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  try {
    await ensureInit();
    const db = await getDatabase();
    const report = await getReconciliationReport(db);
    return NextResponse.json(report);
  } catch (error) {
    logger.error('reconciliation_report_failed', { error });
    return NextResponse.json(
      { error: 'reconciliation report failed', message: 'สร้างรายงานไม่สำเร็จ กรุณาลองใหม่' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run tests + typecheck + manifest guard**

Run: `npx vitest run tests/unit/api/reconciliation-report.test.ts tests/unit/security/mutation-route-manifest.test.ts && npx tsc --noEmit`
Expected: PASS (GET-only route — the manifest test ignores it; running it guards against accidental mutation exports).

- [ ] **Step 5: Commit**

```bash
git add src/services/reconciliation.ts src/app/api/admin/reconciliation-report tests/unit/api/reconciliation-report.test.ts
git commit -m "feat(clinical): read-only reconciliation report for Release B sign-off

Admin-only endpoint aggregating (de-identified) journey-vs-screening risk
mismatches, PREGNANCY journeys with active labor admissions, and duplicate
active journeys per hospital — the evidence artifact required by the
clinical-data reconciliation contract before deploying Release B.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task B6: Release B verification + reconciliation gate + deployment

- [ ] **Step 1: Full local gates**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: green (same lint caveat as Release A — no NEW errors in touched files: `npx eslint src/services src/db/migrations`).

- [ ] **Step 2: Reconciliation evidence (REQUIRES CLINICAL-OWNER SIGN-OFF — stop here until granted)**

1. Before deploying, run the three SQL queries from `src/services/reconciliation.ts` read-only against the production database (via the existing postgres MCP read access) and save the output to `docs/superpowers/plans/evidence/2026-07-13-release-b-reconciliation.json`.
2. Present to the clinical owner: the canonical ANC rule (max of declared vs derived), the future-only correction policy, and the duplicate-journey counts (the migration will refuse the unique index until duplicates are manually resolved).
3. Record sign-off (name + date) in the evidence file. **Stop condition:** discrepancy totals wildly above expectation (e.g., risk mismatches in the thousands) = stop, investigate before deploying.

- [ ] **Step 3: Deploy Release B (requires operator approval)**

```bash
docker tag $(docker compose images -q app) kk-lrms-app:rollback-$(date +%F)-release-b || true
git push origin main
npm run deploy
curl -s -o /dev/null -w '%{http_code}\n' https://kk-lrms.bmscloud.in.th/api/health   # expect 200
docker compose logs app --since 5m | grep -E 'mj_active_unique|initialization_completed'
```

Expected: health 200; startup log shows either `mj_active_unique_created` or `mj_active_unique_blocked_by_duplicates` (the latter is acceptable — fail-safe — but must be recorded and scheduled for manual cleanup). Verify a labor admission appears in the LABOR dashboard stage within one sync cycle (~30 s) — the spec's E2E acceptance for this release.

- [ ] **Step 4: Record evidence**

Append deploy timestamp, rollback tag, startup log lines, and the LABOR-stage dashboard observation to `docs/superpowers/plans/evidence/2026-07-13-release-b-reconciliation.json`. Commit the evidence file.
