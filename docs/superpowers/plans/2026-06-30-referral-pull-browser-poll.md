# Refer-out Pull into Browser-Poll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add referral (refer-out) as the 6th browser-poll data type so refer-out for already-tracked pregnancies reaches the dashboard without modifying HOSxP.

**Architecture:** browser-poll.ts runs a new `SQL_REFEROUT_OB` query against HOSxP, maps rows to a referral bundle, and POSTs it to `/api/sync/browser-push`. The route hands the bundle to a new `persistBrowserReferrals` service helper, which loops each item through the existing `processReferralCreate` with a new `skipIfUntracked` flag so untracked patients are skipped (no phantom journey) instead of created. All referral persistence/encryption/SSE/UI is reused unchanged.

**Tech Stack:** TypeScript 5.x, Next.js 15 App Router, Vitest + better-sqlite3 (`SqliteAdapter`, `:memory:`), MySQL-flavour SQL strings (HOSxP).

**Spec:** `docs/superpowers/specs/2026-06-30-referral-pull-browser-poll-design.md`

## Global Constraints

- TypeScript strict mode; no `any` without written justification.
- TDD — write the failing test first, watch it fail, then implement. Vitest + SQLite in-memory.
- PDPA: patient name/cid encrypted at rest (handled inside `processReferralCreate` — do not bypass it).
- Validate CID at the boundary: format check (`isValidCid13`) client-side in browser-poll, strict checksum (`isValidThaiCidChecksum`) server-side before persisting.
- DRY: reuse `processReferralCreate`; do NOT duplicate referral persistence logic.
- Default (webhook) behaviour of `processReferralCreate` MUST remain byte-for-byte unchanged when the new option is absent.
- Commit after each task. Husky auto-bumps the patch version on commit — that is expected, leave it.
- MVP scope: refer-OUT only. No referin, no status updates, no delete-on-cancel.

---

### Task 1: `skipIfUntracked` option on `processReferralCreate`

Add an opt-in flag so the browser-poll path skips referrals whose patient is not already tracked (no ANC journey, no active labor), returning a new `SKIPPED_UNTRACKED` status instead of manufacturing a minimal journey.

**Files:**
- Modify: `src/services/webhook.ts` (signature at line 1168; the `else` branch at lines 1239-1249)
- Test: `tests/integration/webhook-anc-referral.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: existing `WebhookReferralCreatePayload`, `WebhookReferralResult`, `processReferralCreate`.
- Produces: `processReferralCreate(db, hospitalId, payload, sseManager, opts?: { skipIfUntracked?: boolean })` — when `opts.skipIfUntracked === true` and the patient has no monitoring data, returns `{ referralId, status: 'SKIPPED_UNTRACKED' }` and writes nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/webhook-anc-referral.test.ts`, inside the top-level `describe('ANC/Referral Webhook Integration', ...)` block (so it reuses the `db`, `sseManager`, `webhookHospitalId`, `destHospitalId` setup):

```typescript
  // ─── Referral skipIfUntracked (browser-poll path) ───
  describe('Scenario 12: processReferralCreate skipIfUntracked', () => {
    it('skips an untracked patient — no referral row, no phantom journey', async () => {
      const payload: WebhookReferralCreatePayload = {
        type: 'referral', hospitalCode: '99902', referralId: 'REF-SKIP-001',
        hn: 'SKIP-HN-001', cid: '1409901066400', name: 'นาง ไม่ติดตาม',
        toHospitalCode: '99903', reason: 'ส่งต่อ ไม่มีในระบบ',
      };

      const result = await processReferralCreate(
        db, webhookHospitalId, payload, asSse(sseManager), { skipIfUntracked: true },
      );
      expect(result.status).toBe('SKIPPED_UNTRACKED');

      const refs = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', ['REF-SKIP-001']);
      expect(refs).toHaveLength(0);

      const { createHash: h } = await import('crypto');
      const cidHash = h('sha256').update('1409901066400').digest('hex');
      const journeys = await db.query('SELECT id FROM maternal_journeys WHERE cid_hash = ?', [cidHash]);
      expect(journeys).toHaveLength(0);
    });

    it('still creates the referral when the patient IS tracked (ANC journey exists)', async () => {
      const ancPayload: WebhookAncPayload = {
        type: 'anc_data', hospitalCode: '99902',
        patients: [{
          hn: 'SKIP-HN-002', name: 'นาง มี ANC', cid: '1409901066419',
          birthday: '1996-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'HR1',
        }],
      };
      await processAncWebhook(db, webhookHospitalId, ancPayload, asSse(sseManager));

      const payload: WebhookReferralCreatePayload = {
        type: 'referral', hospitalCode: '99902', referralId: 'REF-SKIP-002',
        hn: 'SKIP-HN-002', cid: '1409901066419', name: 'นาง มี ANC',
        toHospitalCode: '99903', reason: 'ส่งต่อ HR1',
      };
      const result = await processReferralCreate(
        db, webhookHospitalId, payload, asSse(sseManager), { skipIfUntracked: true },
      );
      expect(result.status).toBe('INITIATED');

      const refs = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', ['REF-SKIP-002']);
      expect(refs).toHaveLength(1);
    });

    it('default (no opts) still creates a phantom journey for an untracked patient', async () => {
      const payload: WebhookReferralCreatePayload = {
        type: 'referral', hospitalCode: '99902', referralId: 'REF-SKIP-003',
        hn: 'SKIP-HN-003', cid: '1409901066427', name: 'นาง ค่าเริ่มต้น',
        toHospitalCode: '99903', reason: 'ส่งต่อ default',
      };
      const result = await processReferralCreate(db, webhookHospitalId, payload, asSse(sseManager));
      expect(result.status).toBe('INITIATED');

      const refs = await db.query('SELECT id FROM cached_referrals WHERE refer_number = ?', ['REF-SKIP-003']);
      expect(refs).toHaveLength(1);
    });
  });
```

> The CIDs above (`1409901066400`, `...419`, `...427`) are valid Thai-CID checksums. If any fails the checksum gate during a later task, regenerate with a known-valid 13-digit CID — these are only used to exercise the path, not real people.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/webhook-anc-referral.test.ts -t "skipIfUntracked"`
Expected: FAIL — the first test gets `status: 'INITIATED'` (current code creates a journey + referral) instead of `'SKIPPED_UNTRACKED'`, and the `cached_referrals`/`maternal_journeys` rows are present.

- [ ] **Step 3: Add the option to the signature**

In `src/services/webhook.ts`, change the `processReferralCreate` signature (currently ending at line 1173 `): Promise<WebhookReferralResult> {`):

```typescript
export async function processReferralCreate(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookReferralCreatePayload,
  sseManager: SseManager,
  opts: { skipIfUntracked?: boolean } = {},
): Promise<WebhookReferralResult> {
```

- [ ] **Step 4: Short-circuit the untracked branch**

In the same function, replace the `else` branch that currently starts at line 1239 (`} else {  // No monitoring data — create minimal journey but warn`) so the skip happens BEFORE anything is written:

```typescript
  } else {
    // No monitoring data in the system for this patient.
    if (opts.skipIfUntracked) {
      // Browser-poll path: only surface referrals for pregnancies the system
      // already tracks (ANC/labor). Don't manufacture a phantom journey from a
      // bare refer-out row — the caller counts this as skipped. Returning here
      // short-circuits the warn broadcast, location update, and the
      // cached_referrals upsert, so NOTHING is persisted for an untracked CID.
      return { referralId: payload.referralId, status: 'SKIPPED_UNTRACKED' };
    }
    // Webhook path (default): create minimal journey but warn (unchanged).
    const { randomUUID } = await import('crypto');
    journeyId = randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, name, cid, cid_hash, age, gravida, para, care_stage, registered_at, stage_changed_at, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'PREGNANCY', ?, ?, ?, ?, ?)`,
      [journeyId, hospitalId, hospitalId, payload.hn, encryptedName, encryptedCid, cidHash, now, now, now, now, now],
    );
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/webhook-anc-referral.test.ts`
Expected: PASS — the three new tests pass AND every pre-existing referral/ANC test still passes (the default path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/services/webhook.ts tests/integration/webhook-anc-referral.test.ts
git commit -m "feat(referral): add skipIfUntracked option to processReferralCreate"
```

---

### Task 2: `persistBrowserReferrals` service helper

Add a service-layer loop that validates each referral's CID, dispatches it through `processReferralCreate(..., { skipIfUntracked: true })`, and returns counts. This is the centralised business logic; the route (Task 4) is a thin caller.

**Files:**
- Modify: `src/services/webhook.ts` (add export near the other referral functions, e.g. after `processReferralUpdate`)
- Test: `tests/unit/services/browser-referrals.test.ts` (create)

**Interfaces:**
- Consumes: `processReferralCreate` with `{ skipIfUntracked: true }` (Task 1); `isValidThaiCidChecksum` from `@/lib/cid`.
- Produces:
  - `interface BrowserReferral { referralId: string; hn: string; cid: string; name: string; toHospitalCode: string; reason: string; diagnosisCode?: string; urgencyLevel?: string; changwatCode?: string; amphurCode?: string; tambonCode?: string }`
  - `interface BrowserReferralResult { processed: number; skippedUntracked: number; skippedBadCid: number; failed: number }`
  - `persistBrowserReferrals(db: DatabaseAdapter, hospitalId: string, hcode: string, referrals: BrowserReferral[], sseManager: SseManager): Promise<BrowserReferralResult>`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/browser-referrals.test.ts`:

```typescript
// persistBrowserReferrals — the browser-poll referral loop. Validates CID,
// dispatches each item through processReferralCreate(skipIfUntracked), and
// returns per-outcome counts. Untracked patients are skipped (no phantom
// journey); bad CIDs are skipped; a missing destination hospital fails that
// one item without aborting the batch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { generateKey } from '@/lib/encryption';
import type { SseManager } from '@/lib/sse';
import {
  persistBrowserReferrals,
  processAncWebhook,
  type BrowserReferral,
  type WebhookAncPayload,
} from '@/services/webhook';

process.env.ENCRYPTION_KEY = generateKey();

class MockSse {
  events: Array<{ event: string; data: unknown }> = [];
  broadcast(event: string, data: unknown) { this.events.push({ event, data }); }
}
const asSse = (m: MockSse): SseManager => m as unknown as SseManager;

describe('persistBrowserReferrals', () => {
  let db: SqliteAdapter;
  let sse: MockSse;
  let senderId: string;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await new SeedOrchestrator().run(db);
    sse = new MockSse();
    const now = new Date().toISOString();
    senderId = uuidv4();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '99902', 'รพ.ต้นทาง', 'M2', 1, 'UNKNOWN', ?, ?)`,
      [senderId, now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, '99903', 'รพ.ปลายทาง', 'A', 1, 'UNKNOWN', ?, ?)`,
      [uuidv4(), now, now],
    );
  });

  afterEach(async () => { await db.close(); });

  it('processes a tracked patient, skips untracked, skips bad CID', async () => {
    // Track one pregnancy via ANC (valid checksum CID)
    const anc: WebhookAncPayload = {
      type: 'anc_data', hospitalCode: '99902',
      patients: [{ hn: 'T-001', name: 'นาง ติดตาม', cid: '1409901066419',
        birthday: '1996-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'LOW' }],
    };
    await processAncWebhook(db, senderId, anc, asSse(sse));

    const referrals: BrowserReferral[] = [
      { referralId: 'R-TRACKED', hn: 'T-001', cid: '1409901066419', name: 'นาง ติดตาม',
        toHospitalCode: '99903', reason: 'ส่งต่อ tracked' },
      { referralId: 'R-UNTRACKED', hn: 'U-002', cid: '1409901066427', name: 'นาง ไม่ติดตาม',
        toHospitalCode: '99903', reason: 'ส่งต่อ untracked' },
      { referralId: 'R-BADCID', hn: 'B-003', cid: '1234567890123', name: 'นาง ซีไอดีเสีย',
        toHospitalCode: '99903', reason: 'ส่งต่อ bad cid' },
    ];

    const result = await persistBrowserReferrals(db, senderId, '99902', referrals, asSse(sse));

    expect(result).toEqual({ processed: 1, skippedUntracked: 1, skippedBadCid: 1, failed: 0 });

    const refs = await db.query('SELECT refer_number FROM cached_referrals');
    expect(refs).toHaveLength(1);

    const { createHash: h } = await import('crypto');
    const untrackedHash = h('sha256').update('1409901066427').digest('hex');
    const phantom = await db.query('SELECT id FROM maternal_journeys WHERE cid_hash = ?', [untrackedHash]);
    expect(phantom).toHaveLength(0);
  });

  it('counts a missing destination hospital as failed, not a thrown batch', async () => {
    const anc: WebhookAncPayload = {
      type: 'anc_data', hospitalCode: '99902',
      patients: [{ hn: 'T-010', name: 'นาง ปลายทางหาย', cid: '1409901066419',
        birthday: '1995-01-01', pregNo: 1, lmp: '2025-08-01', riskLevel: 'LOW' }],
    };
    await processAncWebhook(db, senderId, anc, asSse(sse));

    const referrals: BrowserReferral[] = [
      { referralId: 'R-NODEST', hn: 'T-010', cid: '1409901066419', name: 'นาง ปลายทางหาย',
        toHospitalCode: '00000', reason: 'ปลายทางไม่อยู่ในระบบ' },
    ];

    const result = await persistBrowserReferrals(db, senderId, '99902', referrals, asSse(sse));
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/browser-referrals.test.ts`
Expected: FAIL — `persistBrowserReferrals` / `BrowserReferral` are not exported from `@/services/webhook` (import/type error).

- [ ] **Step 3: Implement the helper**

In `src/services/webhook.ts`: first ensure the CID import exists at the top of the file (add if absent):

```typescript
import { isValidThaiCidChecksum } from '@/lib/cid';
```

Then add, immediately after the `processReferralUpdate` function:

```typescript
// ─── Browser-poll referral bundle ───
//
// The browser-poll path (src/lib/browser-poll.ts) pulls refer-out rows for a
// hospital and POSTs them here via /api/sync/browser-push. Unlike the webhook
// .pas path, we only surface referrals for pregnancies the system already
// tracks — so each item runs through processReferralCreate with
// skipIfUntracked, and untracked / bad-CID / dest-missing items are counted,
// not allowed to abort the batch.

export interface BrowserReferral {
  referralId: string;
  hn: string;
  cid: string;
  name: string;
  toHospitalCode: string;
  reason: string;
  diagnosisCode?: string;
  urgencyLevel?: string;
  changwatCode?: string;
  amphurCode?: string;
  tambonCode?: string;
}

export interface BrowserReferralResult {
  processed: number;
  skippedUntracked: number;
  skippedBadCid: number;
  failed: number;
}

export async function persistBrowserReferrals(
  db: DatabaseAdapter,
  hospitalId: string,
  hcode: string,
  referrals: BrowserReferral[],
  sseManager: SseManager,
): Promise<BrowserReferralResult> {
  const result: BrowserReferralResult = {
    processed: 0,
    skippedUntracked: 0,
    skippedBadCid: 0,
    failed: 0,
  };

  for (const r of referrals) {
    // Strict checksum gate at the boundary — a malformed CID can never match a
    // real journey, so persisting it would only create noise.
    if (!isValidThaiCidChecksum(r.cid)) {
      result.skippedBadCid += 1;
      continue;
    }

    const payload: WebhookReferralCreatePayload = {
      type: 'referral',
      hospitalCode: hcode,
      referralId: r.referralId,
      hn: r.hn,
      cid: r.cid,
      name: r.name,
      toHospitalCode: r.toHospitalCode,
      reason: r.reason,
      diagnosisCode: r.diagnosisCode,
      urgencyLevel: r.urgencyLevel,
      changwatCode: r.changwatCode,
      amphurCode: r.amphurCode,
      tambonCode: r.tambonCode,
    };

    try {
      const res = await processReferralCreate(db, hospitalId, payload, sseManager, {
        skipIfUntracked: true,
      });
      if (res.status === 'SKIPPED_UNTRACKED') result.skippedUntracked += 1;
      else result.processed += 1;
    } catch (e) {
      // e.g. destination hcode not registered — one item fails, batch continues.
      result.failed += 1;
      logger.warn('browser_referral_failed', {
        referralId: r.referralId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/browser-referrals.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/webhook.ts tests/unit/services/browser-referrals.test.ts
git commit -m "feat(referral): add persistBrowserReferrals service helper"
```

---

### Task 3: `SQL_REFEROUT_OB` query + `mapReferral` in browser-poll

Add the HOSxP query, the urgency mapper, the row→payload mapper, the `BrowserPushBody.referrals` field, and the result counters. Wire the query into `runBrowserPoll`'s parallel fetch and the bundle.

**Files:**
- Modify: `src/lib/browser-poll.ts`
- Test: `tests/unit/lib/browser-poll-referral.test.ts` (create)

**Interfaces:**
- Consumes: existing `strOrNull`, `intOrNull`, `isValidCid13`, `runQuery`, `withBasePath`.
- Produces:
  - `export const SQL_REFEROUT_OB: string`
  - `export function mapReferralUrgency(id: unknown): 'ROUTINE' | 'URGENT' | 'EMERGENCY'`
  - `export interface BrowserReferralItem { referralId: string; hn: string; cid: string; name: string; toHospitalCode: string; reason: string; diagnosisCode?: string; urgencyLevel?: string; changwatCode?: string; amphurCode?: string; tambonCode?: string }`
  - `export function mapReferral(row: Record<string, unknown>): BrowserReferralItem | null`
  - `BrowserPushBody` gains `referrals?: BrowserReferralItem[]`
  - `BrowserPollResult` gains `referral: { read: number; mapped: number; sent: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/browser-poll-referral.test.ts`:

```typescript
// browser-poll referral mapping — pure row→payload transform, no network.
import { describe, it, expect } from 'vitest';
import { mapReferral, mapReferralUrgency, SQL_REFEROUT_OB } from '@/lib/browser-poll';

describe('mapReferralUrgency', () => {
  it('maps HOSxP referout_emergency_type_id to urgency levels', () => {
    expect(mapReferralUrgency(3)).toBe('EMERGENCY');
    expect(mapReferralUrgency(2)).toBe('URGENT');
    expect(mapReferralUrgency(1)).toBe('ROUTINE');
    expect(mapReferralUrgency(null)).toBe('ROUTINE');
    expect(mapReferralUrgency('99')).toBe('ROUTINE');
  });
});

describe('mapReferral', () => {
  const row = {
    refer_number: 'REF-2026-0001',
    refer_date: '2026-06-28',
    hn: '000123',
    refer_hospcode: '10669',
    pdx: 'O14.1',
    pre_diagnosis: 'Severe preeclampsia',
    referout_emergency_type_id: 2,
    cid: '1409901066419',
    chwpart: '32',
    amppart: '01',
    tmbpart: '05',
    patient_name: 'นาง ทดสอบ ส่งต่อ',
  };

  it('maps a full HOSxP referout row to a referral payload', () => {
    expect(mapReferral(row)).toEqual({
      referralId: 'REF-2026-0001',
      hn: '000123',
      cid: '1409901066419',
      name: 'นาง ทดสอบ ส่งต่อ',
      toHospitalCode: '10669',
      reason: 'Severe preeclampsia',
      diagnosisCode: 'O14.1',
      urgencyLevel: 'URGENT',
      changwatCode: '32',
      amphurCode: '01',
      tambonCode: '05',
    });
  });

  it('returns null when the destination hcode is missing', () => {
    expect(mapReferral({ ...row, refer_hospcode: null })).toBeNull();
  });

  it('returns null when the CID is not 13 digits', () => {
    expect(mapReferral({ ...row, cid: '123' })).toBeNull();
  });

  it('SQL_REFEROUT_OB targets the referout table within a date window', () => {
    expect(SQL_REFEROUT_OB).toContain('referout');
    expect(SQL_REFEROUT_OB).toContain('refer_date');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/browser-poll-referral.test.ts`
Expected: FAIL — `mapReferral`, `mapReferralUrgency`, `SQL_REFEROUT_OB` are not exported from `@/lib/browser-poll`.

- [ ] **Step 3a: Add the SQL constant**

In `src/lib/browser-poll.ts`, add after the `SQL_PARTOGRAPH` constant (around line 264):

```typescript
// Refer-out for OB patients in the last 7 days. Source HN/name/location from
// `patient` (this HOSxP build carries pname/fname/lname/chwpart on patient, as
// SQL_ACTIVE_LABOUR does). The OB predicate (ICD O*/Z3* or an ANC record) is a
// COARSE volume filter only — the authoritative "is this pregnancy tracked?"
// filter runs server-side in persistBrowserReferrals. Re-pulled every cycle;
// the server upserts by (from_hospital_id, refer_number) so it is idempotent.
//
// NOTE: column names (pdx, refer_date, referout_emergency_type_id) and the
// person_anc join mirror REFEROUT_PREGNANCY in src/config/hosxp-queries.ts and
// KKLRMSWebhookUnit.pas. Validate against a live HOSxP before first rollout —
// older builds may differ.
export const SQL_REFEROUT_OB = `
  SELECT ro.refer_number, ro.refer_date, ro.hn, ro.refer_hospcode,
         ro.pdx, ro.pre_diagnosis, ro.referout_emergency_type_id,
         p.cid, p.chwpart, p.amppart, p.tmbpart,
         CONCAT(p.pname, p.fname, ' ', p.lname) AS patient_name
    FROM referout ro
    JOIN patient p ON p.hn = ro.hn
   WHERE ro.refer_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     AND (ro.pdx LIKE 'O%' OR ro.pdx LIKE 'Z3%'
          OR EXISTS (SELECT 1 FROM person_anc pa
                       INNER JOIN person pe ON pe.person_id = pa.person_id
                      WHERE pe.cid = p.cid AND LENGTH(p.cid) = 13))
   ORDER BY ro.refer_date DESC`;
```

- [ ] **Step 3b: Add the mapper types + functions**

Add the type near the other `Browser*` interfaces (after `BrowserAncPatient`, before `BrowserPushBody` at line 125):

```typescript
interface BrowserReferralItem {
  referralId: string;
  hn: string;
  cid: string;
  name: string;
  toHospitalCode: string;
  reason: string;
  diagnosisCode?: string;
  urgencyLevel?: string;
  changwatCode?: string;
  amphurCode?: string;
  tambonCode?: string;
}
```

Extend `BrowserPushBody` (line 125) with the referrals field:

```typescript
export interface BrowserPushBody {
  labor?: { patients: BrowserLaborPatient[]; mode?: 'incremental' | 'full_snapshot' };
  anc?: { patients: BrowserAncPatient[] };
  partograph?: { observations: BrowserPartographObservation[] };
  referrals?: BrowserReferralItem[];
}
```

Extend `BrowserPollResult` (line 131) — add a `referral` counter (no `droppedNameUnstable`; referrals don't run the name probe):

```typescript
  anc: { read: number; mapped: number; sent: number; droppedNameUnstable: number };
  referral: { read: number; mapped: number; sent: number };
```

Add the mappers next to `mapPartograph` (after it, around line 436). `mapReferralUrgency` must be exported; `mapReferral` too:

```typescript
// HOSxP referout_emergency_type_id → urgency. Mapping per BMS reference data:
// 1 = ปกติ (ROUTINE), 2 = เร่งด่วน (URGENT), 3 = ฉุกเฉิน (EMERGENCY). Unknown/null
// defaults to ROUTINE. CONFIRM the integer codes against a live HOSxP before
// first rollout (see spec §4).
export function mapReferralUrgency(id: unknown): 'ROUTINE' | 'URGENT' | 'EMERGENCY' {
  const n = intOrNull(id);
  if (n === 3) return 'EMERGENCY';
  if (n === 2) return 'URGENT';
  return 'ROUTINE';
}

export function mapReferral(row: Record<string, unknown>): BrowserReferralItem | null {
  const referralId = strOrNull(row.refer_number);
  const hn = strOrNull(row.hn);
  const cid = strOrNull(row.cid);
  const name = strOrNull(row.patient_name);
  const toHospitalCode = strOrNull(row.refer_hospcode);
  if (!referralId || !hn || !cid || !name || !toHospitalCode) return null;
  if (!isValidCid13(cid)) return null;

  return {
    referralId,
    hn,
    cid,
    name,
    toHospitalCode,
    reason: strOrNull(row.pre_diagnosis) ?? '',
    diagnosisCode: strOrNull(row.pdx) ?? undefined,
    urgencyLevel: mapReferralUrgency(row.referout_emergency_type_id),
    changwatCode: strOrNull(row.chwpart) ?? undefined,
    amphurCode: strOrNull(row.amppart) ?? undefined,
    tambonCode: strOrNull(row.tmbpart) ?? undefined,
  };
}
```

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `npx vitest run tests/unit/lib/browser-poll-referral.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the query into `runBrowserPoll`**

In `runBrowserPoll`, initialise the new counter in the `result` object (after the `anc:` line, ~line 786):

```typescript
    anc: { read: 0, mapped: 0, sent: 0, droppedNameUnstable: 0 },
    referral: { read: 0, mapped: 0, sent: 0 },
```

Add the 6th query to the `Promise.all` (lines 794-800):

```typescript
    const [laborRows, partRows, ancMasters, ancVisits, ancClasses, referoutRows] = await Promise.all([
      runQuery<Record<string, unknown>>(SQL_ACTIVE_LABOUR, opts),
      runQuery<Record<string, unknown>>(SQL_PARTOGRAPH, opts),
      runQuery<Record<string, unknown>>(ancMastersSql(), opts),
      runQuery<Record<string, unknown>>(ancVisitsSql(), opts),
      runQuery<Record<string, unknown>>(ancClassifyingSql(), opts),
      runQuery<Record<string, unknown>>(SQL_REFEROUT_OB, opts),
    ]);

    result.labor.read = laborRows.length;
    result.partograph.read = partRows.length;
    result.anc.read = ancMasters.length;
    result.referral.read = referoutRows.length;
```

After the ANC mapping (`const ancPatients = mapAncBundle(...)` ~line 904), map referrals (they do NOT pass through the name-authenticity probe):

```typescript
    const referrals = referoutRows
      .map(mapReferral)
      .filter((x): x is BrowserReferralItem => x !== null);
    result.referral.mapped = referrals.length;
```

Update the empty-bundle early return (line 961) to include referrals:

```typescript
    if (laborPatients.length === 0 && partographs.length === 0 && ancPatients.length === 0 && referrals.length === 0) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }
```

Add referrals to the bundle (after the `if (ancPatients.length > 0) body.anc = ...` line, ~line 982):

```typescript
    if (referrals.length > 0) body.referrals = referrals;
```

Widen the push-response type and record `sent` (lines 1006-1012):

```typescript
    const pushed = (await pushRes.json().catch(() => null)) as
      | { labor?: { processed: number }; anc?: { processed: number }; partograph?: { accepted: number }; referrals?: { processed: number } }
      | null;

    result.labor.sent = pushed?.labor?.processed ?? laborPatients.length;
    result.anc.sent = pushed?.anc?.processed ?? ancPatients.length;
    result.partograph.sent = pushed?.partograph?.accepted ?? partographs.length;
    result.referral.sent = pushed?.referrals?.processed ?? referrals.length;
```

- [ ] **Step 6: Run the full browser-poll + mode tests to verify nothing broke**

Run: `npx vitest run tests/unit/lib/browser-poll-referral.test.ts tests/unit/lib/browser-poll-mode.test.ts`
Expected: PASS. Then `npx tsc --noEmit` to confirm `BrowserPollResult.referral` is set on every code path (the early `no-data` returns and the catch all build `result` from the literal, so they are covered).

- [ ] **Step 7: Commit**

```bash
git add src/lib/browser-poll.ts tests/unit/lib/browser-poll-referral.test.ts
git commit -m "feat(referral): pull refer-out rows in browser-poll (SQL + mapping)"
```

---

### Task 4: Wire the `referrals` branch into `/api/sync/browser-push`

Thin route wiring: read `body.referrals`, call `persistBrowserReferrals`, record a `persist_referrals` sync step, and echo counts in the response. All heavy logic is already tested in Task 2.

**Files:**
- Modify: `src/app/api/sync/browser-push/route.ts`
- Test: `tests/unit/api/browser-push-referrals.test.ts` (create)

**Interfaces:**
- Consumes: `persistBrowserReferrals`, `BrowserReferral` (Task 2); existing `startSyncRun`/`appendSyncStep`/`finalizeSyncRun`, `SseManager.getInstance()`.
- Produces: response JSON gains `referrals?: { processed, skippedUntracked, skippedBadCid, failed }`; a `persist_referrals` step appears in the Sync Log.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/api/browser-push-referrals.test.ts`. This mirrors the mock style of `tests/unit/api/high-risk-cache.test.ts` — mock every dependency so the route logic runs in isolation:

```typescript
// /api/sync/browser-push must dispatch body.referrals to persistBrowserReferrals
// and record a persist_referrals sync step. Heavy referral logic is tested in
// tests/unit/services/browser-referrals.test.ts — here we only assert wiring.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ensure-init', () => ({ ensureInit: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { hospitalCode: '99902', accessMode: 'full' } })),
}));
vi.mock('@/db/connection', () => ({
  getDatabase: vi.fn(async () => ({
    query: vi.fn(async () => [{ id: 'hosp-1', is_active: true }]),
    execute: vi.fn(async () => {}),
  })),
}));
vi.mock('@/lib/sse', () => ({ SseManager: { getInstance: vi.fn(() => ({ broadcast: vi.fn() })) } }));
vi.mock('@/services/sync/progress-store', () => ({
  startSyncRun: vi.fn(async () => 'run-1'),
  appendSyncStep: vi.fn(async () => {}),
  finalizeSyncRun: vi.fn(() => {}),
}));
vi.mock('@/services/webhook', () => ({
  processWebhookPayload: vi.fn(),
  processAncWebhook: vi.fn(),
  processPartographWebhook: vi.fn(),
  validatePayload: vi.fn(() => ({ valid: false, payload: null })),
  validateAncPayload: vi.fn(() => ({ valid: false, payload: null })),
  validatePartographPayload: vi.fn(() => ({ valid: false, payload: null })),
  persistBrowserReferrals: vi.fn(async () => ({ processed: 2, skippedUntracked: 1, skippedBadCid: 0, failed: 0 })),
}));

import { POST } from '@/app/api/sync/browser-push/route';
import { persistBrowserReferrals } from '@/services/webhook';
import { appendSyncStep } from '@/services/sync/progress-store';

const persist = persistBrowserReferrals as unknown as ReturnType<typeof vi.fn>;
const step = appendSyncStep as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown): Request {
  return new Request('http://localhost/api/sync/browser-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/sync/browser-push — referrals', () => {
  it('dispatches body.referrals to persistBrowserReferrals and records the step', async () => {
    const referrals = [
      { referralId: 'R1', hn: 'H1', cid: '1409901066419', name: 'n', toHospitalCode: '99903', reason: 'r' },
    ];
    const res = await POST(req({ referrals }) as never);
    const json = await res.json();

    expect(persist).toHaveBeenCalledTimes(1);
    // (db, hospitalId, hcode, referrals, sse)
    expect(persist.mock.calls[0][2]).toBe('99902');
    expect(persist.mock.calls[0][3]).toEqual(referrals);

    expect(json.referrals).toEqual({ processed: 2, skippedUntracked: 1, skippedBadCid: 0, failed: 0 });
    const stepNames = step.mock.calls.map((c) => c[2]?.name);
    expect(stepNames).toContain('persist_referrals');
  });

  it('does not call persistBrowserReferrals when no referrals are present', async () => {
    await POST(req({}) as never);
    expect(persist).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/api/browser-push-referrals.test.ts`
Expected: FAIL — the route does not import/call `persistBrowserReferrals`, so `persist` is never called and `json.referrals` is undefined.

- [ ] **Step 3: Extend the imports and body type**

In `src/app/api/sync/browser-push/route.ts`, add to the `@/services/webhook` import block (lines 17-27):

```typescript
  persistBrowserReferrals,
  type BrowserReferral,
```

Extend `BrowserPushBody` (lines 35-39):

```typescript
interface BrowserPushBody {
  labor?: Omit<WebhookPayload, 'hospitalCode'>;
  anc?: Omit<WebhookAncPayload, 'hospitalCode' | 'type'>;
  partograph?: Omit<WebhookPartographPayload, 'hospitalCode' | 'type'>;
  referrals?: BrowserReferral[];
}
```

Add `referrals` to the `result` accumulator type (lines 95-99):

```typescript
    const result: {
      labor?: { processed: number; newAdmissions: number; discharges: number; transfers: number };
      anc?: { processed: number };
      partograph?: { accepted: number; skipped: number };
      referrals?: { processed: number; skippedUntracked: number; skippedBadCid: number; failed: number };
    } = {};
```

- [ ] **Step 4: Add the referrals branch**

Insert after the partograph block closes (after line 267, before the `// Mark hospital ONLINE` comment at line 269):

```typescript
    // Referrals — refer-out pulled by the browser. persistBrowserReferrals
    // validates CID + journey-match per item (skipIfUntracked), so a bad/
    // untracked row is counted, never aborts the bundle.
    if (Array.isArray(body.referrals) && body.referrals.length > 0) {
      await appendSyncStep(hospitalId, runId, {
        name: 'persist_referrals',
        status: 'running',
        message: `Persisting ${body.referrals.length} refer-out rows.`,
        counts: { rows: body.referrals.length },
      });
      try {
        const r = await persistBrowserReferrals(db, hospitalId, hcode, body.referrals, sseManager);
        result.referrals = r;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_referrals',
          status: 'success',
          message: `Upserted ${r.processed} referrals (${r.skippedUntracked} untracked, ${r.skippedBadCid} bad CID, ${r.failed} failed).`,
          counts: { ...r },
        });
      } catch (e) {
        hadWarning = true;
        await appendSyncStep(hospitalId, runId, {
          name: 'persist_referrals',
          status: 'error',
          message: 'Referral persist failed.',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
```

> `hcode` is non-null here: the route returns 400 at line 61 when the session has no hospital code, so by this point `hcode` is a confirmed string.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/api/browser-push-referrals.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Full suite + typecheck + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all green, zero warnings (constitution I).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/sync/browser-push/route.ts tests/unit/api/browser-push-referrals.test.ts
git commit -m "feat(referral): dispatch browser-poll referrals in browser-push route"
```

---

## Post-implementation (manual, not in scope for the TDD tasks)

These require a live HOSxP session and are tracked in the spec, NOT done here:

1. **Validate `SQL_REFEROUT_OB` against a real HOSxP** — confirm `referout` column names (`pdx`, `refer_date`, `pre_diagnosis`, `referout_emergency_type_id`), the `patient` name/location columns, and the `person_anc` join. Adjust the query if a site differs.
2. **Confirm `referout_emergency_type_id` integer codes** map to ROUTINE/URGENT/EMERGENCY as assumed in `mapReferralUrgency`.
3. **End-to-end smoke** — open an authenticated tab at a hospital with recent OB refer-outs, confirm a `persist_referrals` step appears in the Sync Log and the referral shows on the dashboard for a tracked pregnancy.

---

## Self-Review

**Spec coverage (against `2026-06-30-referral-pull-browser-poll-design.md`):**
- §3 file ① browser-poll query + mapping → Task 3 ✓
- §3 file ② browser-push branch + `persist_referrals` step → Task 4 ✓
- §3 file ③ `skipIfUntracked` on `processReferralCreate` → Task 1 ✓
- §4 ① `SQL_REFEROUT_OB` (OB + 7-day window) → Task 3 Step 3a ✓
- §4 ② field mapping table (referralId, hn, cid, name, toHospitalCode, reason, diagnosisCode, urgencyLevel, location) → Task 3 `mapReferral` ✓
- §4 ③ `skipIfUntracked` skips phantom journey → Task 1 Step 4 ✓
- §5 error handling: bad CID skip → Task 2 (`skippedBadCid`); untracked skip+log → Tasks 1+2; dest-not-found per-item fail → Task 2 test 2; query failure isolates step → Task 4 try/catch; idempotent upsert → reuses existing `(from_hospital_id, refer_number)` upsert (Task 1 leaves it intact) ✓
- §6 testing: 4 test files map to the 4 tasks; idempotency is covered by the existing upsert path exercised in Task 2 (re-running the same referral updates, never duplicates — locked by the existing "upserts referral" test in webhook-anc-referral.test.ts) ✓
- §7 constitution: DRY (reuse processReferralCreate), parameterized queries, PDPA encryption untouched, TDD, Thai Sync Log messages ✓

**Placeholder scan:** none — every step shows concrete code/commands.

**Type consistency:** `BrowserReferral` (webhook.ts, Task 2) and `BrowserReferralItem` (browser-poll.ts, Task 3) are structurally identical and intentionally separate (browser-poll cannot import Node-only webhook.ts — same split as `BrowserLaborPatient`/`WebhookPatient`); they meet only as JSON over the wire and the route (Task 4) types `body.referrals` as `BrowserReferral[]`. `persistBrowserReferrals` signature `(db, hospitalId, hcode, referrals, sseManager)` matches its call site in Task 4 and the positional assertions in the Task 4 test. `BrowserReferralResult` fields (`processed/skippedUntracked/skippedBadCid/failed`) are consistent across Tasks 2, 4, and both tests. `SKIPPED_UNTRACKED` status string consistent across Tasks 1 and 2.
