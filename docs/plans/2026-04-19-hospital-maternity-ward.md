# Hospital Maternity Ward Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/hospital-maternity-ward` page that mirrors the HOSxP labor-package UI, providing read-only ward overview and full CRUD on every editable labor-room entity (partograph, vitals, pre-labour, stage, two medication tables, complications, infants, bed move, discharge), talking directly to the hospital's BMS Session API from the browser.

**Architecture:** Dual auth (NextAuth cookie for kk-lrms identity + audit; `BmsSessionContext` browser-side for BMS bearer JWT). Layout switches from left sidebar to top navbar globally. New `(hospital)` route group hosts the page. CRUD goes browser → BMS REST/SQL/Function endpoints; every write fires a server-side audit log. Drag-drop bed grouping uses HOSxP's existing `roomno + bedno + bed_order` (no new layout schema).

**Tech Stack:** TypeScript 5.x · Next.js 16 (App Router) · React 19 · NextAuth v5 · SWR · Vitest · Playwright · `@dnd-kit/core` (new dep) · pglite (test only).

**Design doc (read first):** `docs/plans/2026-04-19-hospital-maternity-ward-design.md`

---

## Plan-wide notes for the executor

1. **Adjustment from design doc**: the design references `session.user.userType === 'HOSPITAL'`. The existing codebase has no `userType` field — only `role` (OBSTETRICIAN/NURSE/ADMIN) and `hospitalCode`. We'll **substitute** the userType gate with **"valid BmsSessionContext config"** (i.e. user has been auto-logged-in via `?bms-session-id=`). The page works for any authenticated user whose browser holds a valid BMS session; users without one see a "เปิดหน้านี้จาก HOSxP เพื่อใช้งาน" prompt. This matches the user's stated intent ("everyone that login to HOSxP will have a valid bms-session-id") and avoids a migration.

2. **Working directory & branch.** Work on `main` unless told otherwise — kk-lrms ships from `main`. Pre-existing uncommitted changes (`src/config/hospitals.ts`, `src/db/seeds/hospital-seeder.ts`) are intentional staging by the user; do not stage them in your commits.

3. **Tests run on Windows.** Use forward slashes in paths. Tests are Vitest (`npm test` runs `vitest run`). E2E uses Playwright (`npm run test:e2e`).

4. **TDD discipline.** Every task starts with a failing test, runs it to confirm RED, then implements minimal code, then runs it to confirm GREEN, then commits. Skip the test step only when explicitly told (e.g. for pure file moves).

5. **Reference repo for browser BMS client.** The canonical port source is `C:/AIProject/hosxp-telemed/src/services/bmsSession.ts`, `src/contexts/BmsSessionContext.tsx`, `src/utils/sessionStorage.ts`, `src/hooks/useBmsSession.ts`. Read those files before porting; they contain comments about subtle pairing rules (marketplace token, session ID stripping) that must survive the port.

6. **Dialect portability.** Every new SQL template is a `SqlQueryTemplate { postgresql, mysql }` pair. The unit test in Task 9 enforces the rules from §6.1 of the design doc.

7. **Audit POST is fire-and-forget.** Tests assert the POST is fired but don't await it; production code uses `void fetch(...)`.

8. **Commit messages**: imperative, scoped, end with the standard `Co-Authored-By` line:
   ```
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

9. **Path alias.** `@/` resolves to `src/` (verify in `tsconfig.json` if unsure).

---

## Batch 0 — Project setup (1 task)

### Task 0: Install drag-and-drop dependency

**Files:**
- Modify: `package.json` (deps), `package-lock.json`

**Step 1: Install**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
Expected: 3 packages added; no peer-dep warnings beyond the existing baseline.

**Step 2: Verify build still passes**
```bash
npm run lint && npm test -- --run
```
Expected: 0 errors. (No new tests yet — just confirming the install didn't break anything.)

**Step 3: Commit**
```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit for maternity-ward bed drag-drop"
```

---

## Batch 1 — Foundations: BMS browser client (10 tasks)

### Task 1: Add types module for BMS browser client

**Files:**
- Create: `src/types/bms-browser.ts`
- Test: `tests/unit/types/bms-browser.test.ts` — type-only smoke test

**Step 1: Write the failing test**
```ts
// tests/unit/types/bms-browser.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  ConnectionConfig,
  UserInfo,
  BmsSessionResponse,
  SqlApiResponse,
  RestApiResponse,
  BmsFunctionResponse,
  SqlParams,
} from '@/types/bms-browser';

describe('bms-browser types', () => {
  it('ConnectionConfig has required fields', () => {
    const c: ConnectionConfig = {
      apiUrl: 'https://x',
      bearerToken: 't',
      appIdentifier: 'KK-LRMS.Web',
    };
    expectTypeOf(c.apiUrl).toBeString();
  });
  it('SqlApiResponse exposes data array + MessageCode', () => {
    const r: SqlApiResponse = { data: [], MessageCode: 200, Message: 'ok' };
    expectTypeOf(r.data).toBeArray();
  });
});
```

**Step 2: Run test to verify it fails**
```bash
npm test -- tests/unit/types/bms-browser.test.ts
```
Expected: FAIL with "Cannot find module '@/types/bms-browser'"

**Step 3: Write minimal implementation**
```ts
// src/types/bms-browser.ts
export interface ConnectionConfig {
  apiUrl: string;
  bearerToken: string;
  appIdentifier: string;
}

export interface UserInfo {
  loginname: string;
  fullname: string;
  hospcode: string;
  // Other fields are tunnel-specific; treat as opaque
  [key: string]: unknown;
}

export interface BmsSessionResponse {
  jwt?: string;
  bms_url?: string;
  user_info?: Record<string, unknown>;
  expired_second?: number;
  MessageCode?: number;
  Message?: string;
  [key: string]: unknown;
}

export type SqlParams = Record<string, unknown>;

export interface SqlApiResponse<T = Record<string, unknown>> {
  data: T[];
  MessageCode: number;
  Message: string;
}

export interface RestApiResponse {
  MessageCode: number;
  Message: string;
  insert_count?: number;
  update_count?: number;
  data?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface BmsFunctionResponse {
  MessageCode: number;
  Message: string;
  Value?: unknown;
  url?: string;
  [key: string]: unknown;
}
```

**Step 4: Run test to verify it passes**
```bash
npm test -- tests/unit/types/bms-browser.test.ts
```
Expected: PASS.

**Step 5: Commit**
```bash
git add src/types/bms-browser.ts tests/unit/types/bms-browser.test.ts
git commit -m "feat(types): add bms-browser types for direct BMS API calls"
```

---

### Task 2: Browser BMS client — `retrieveBmsSession`

**Files:**
- Create: `src/lib/bms-browser-client.ts`
- Test: `tests/unit/lib/bms-browser-client.test.ts`

**Step 1: Write the failing test**
```ts
// tests/unit/lib/bms-browser-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveBmsSession } from '@/lib/bms-browser-client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('bms-browser-client.retrieveBmsSession', () => {
  beforeEach(() => mockFetch.mockReset());

  it('POSTs sessionId to PasteJSON and returns parsed body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        jwt: 'eyJ...', bms_url: 'https://t.example/api',
        user_info: { loginname: 'nurse1', fullname: 'Nurse One', hospcode: '10670' },
        expired_second: 3600,
      }),
    });

    const r = await retrieveBmsSession('SID-1');
    expect(r.jwt).toBe('eyJ...');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hosxp.net/phapi/PasteJSON',
      expect.objectContaining({ method: 'POST' }),
    );
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.session_id).toBe('SID-1');
  });

  it('throws on HTTP 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized',
      text: async () => 'session expired',
    });
    await expect(retrieveBmsSession('SID-X')).rejects.toThrow();
  });
});
```

**Step 2: Run** → FAIL (module not found).

**Step 3: Implement**
Port the function from `C:/AIProject/hosxp-telemed/src/services/bmsSession.ts` (lines 36-167). Keep the constants (`PASTE_JSON_URL`, `APP_IDENTIFIER`, `SESSION_TIMEOUT_MS`). Trim everything not needed for the kk-lrms slice.

```ts
// src/lib/bms-browser-client.ts
import type {
  BmsSessionResponse, ConnectionConfig, UserInfo,
  SqlApiResponse, SqlParams, RestApiResponse, BmsFunctionResponse,
} from '@/types/bms-browser';

export const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
export const APP_IDENTIFIER = 'KK-LRMS.Web';
export const SESSION_TIMEOUT_MS = 30_000;
export const QUERY_TIMEOUT_MS = 60_000;

export async function retrieveBmsSession(sessionId: string): Promise<BmsSessionResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(PASTE_JSON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`BMS session retrieval failed (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }
    return (await response.json()) as BmsSessionResponse;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('BMS session retrieval timed out after 30 seconds');
    }
    if (error instanceof Error && error.message.startsWith('BMS session retrieval')) throw error;
    throw new Error(`Cannot connect to BMS session API: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/lib/bms-browser-client.ts tests/unit/lib/bms-browser-client.test.ts
git commit -m "feat(bms): add browser-side retrieveBmsSession (port from hosxp-telemed)"
```

---

### Task 3: Browser BMS client — `extractConnectionConfig` + `extractUserInfo`

**Files:**
- Modify: `src/lib/bms-browser-client.ts`
- Modify: `tests/unit/lib/bms-browser-client.test.ts` (append cases)

**Step 1: Append failing tests**
```ts
import { extractConnectionConfig, extractUserInfo, APP_IDENTIFIER } from '@/lib/bms-browser-client';

describe('extractConnectionConfig', () => {
  it('extracts apiUrl + bearerToken + appIdentifier', () => {
    const r = { jwt: 'eyJ...', bms_url: 'https://t.example/api' };
    const c = extractConnectionConfig(r);
    expect(c).toEqual({
      apiUrl: 'https://t.example/api',
      bearerToken: 'eyJ...',
      appIdentifier: APP_IDENTIFIER,
    });
  });

  it('throws when bms_url missing', () => {
    expect(() => extractConnectionConfig({ jwt: 'x' } as never)).toThrow(/bms_url/);
  });

  it('throws when jwt missing', () => {
    expect(() => extractConnectionConfig({ bms_url: 'x' } as never)).toThrow(/jwt/);
  });
});

describe('extractUserInfo', () => {
  it('returns user_info subfield', () => {
    const r = { user_info: { loginname: 'n1', fullname: 'Nurse', hospcode: '10670' } };
    expect(extractUserInfo(r as never)).toMatchObject({ loginname: 'n1', hospcode: '10670' });
  });
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement** — append to `bms-browser-client.ts`:
```ts
export function extractConnectionConfig(r: BmsSessionResponse): ConnectionConfig {
  if (!r.jwt) throw new Error('BMS session response missing jwt');
  if (!r.bms_url) throw new Error('BMS session response missing bms_url');
  return {
    apiUrl: r.bms_url.replace(/\/$/, ''),
    bearerToken: r.jwt,
    appIdentifier: APP_IDENTIFIER,
  };
}

export function extractUserInfo(r: BmsSessionResponse): UserInfo {
  const ui = (r.user_info ?? {}) as Record<string, unknown>;
  return {
    loginname: String(ui.loginname ?? ui.username ?? ''),
    fullname: String(ui.fullname ?? ui.name ?? ''),
    hospcode: String(ui.hospcode ?? ui.hospital_code ?? ''),
    ...ui,
  };
}
```

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/lib/bms-browser-client.ts tests/unit/lib/bms-browser-client.test.ts
git commit -m "feat(bms): add extractConnectionConfig + extractUserInfo"
```

---

### Task 4: Browser BMS client — `executeSql`

Port `executeSqlViaApi` from hosxp-telemed (lines 261-399). Keep error semantics: 60s timeout, 429 with Thai retry, 501+MessageCode 401 → unauthorized.

**Files:**
- Modify: `src/lib/bms-browser-client.ts`, `tests/unit/lib/bms-browser-client.test.ts`

**Step 1: Append failing tests** — cover happy path, 429, 501+401, timeout (use `vi.useFakeTimers`), parameterised query body shape.

**Step 2: Run** → FAIL.

**Step 3: Implement `executeSql`** — exactly mirror hosxp-telemed lines 261-399, renamed `executeSqlViaApi` → `executeSql`. Drop the `marketplaceToken` parameter for now (add back in Task 7 if needed). Drop `withRandomParam` for now (add back if cache-busting becomes an issue).

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/lib/bms-browser-client.ts tests/unit/lib/bms-browser-client.test.ts
git commit -m "feat(bms): add browser executeSql with retry/timeout semantics"
```

---

### Task 5: Browser BMS client — `callFunction`

Port `callBmsFunction` from hosxp-telemed (lines 417-494).

**Files:**
- Modify: `src/lib/bms-browser-client.ts`, `tests/unit/lib/bms-browser-client.test.ts`

**Step 1-5:** Same TDD pattern. Test cases:
- POSTs to `/api/function?name=get_serialnumber` with the payload as JSON body
- 501 → "Session unauthorized"
- 429 → Thai retry message

**Commit message:** `feat(bms): add browser callFunction for BMS server functions`

---

### Task 6: Browser BMS client — `restInsert` / `restUpdate` / `restDelete`

Port from hosxp-telemed (lines 618-757). All three are similar enough to implement together; one combined test file describing each.

**Files:**
- Modify: `src/lib/bms-browser-client.ts`, `tests/unit/lib/bms-browser-client.test.ts`

**Test cases per function:**
- URL encoding: `/api/rest/{table}` for insert; `/api/rest/{table}/{id}` for update/delete; `id` is URL-encoded.
- Body shape: when `marketplaceToken` is provided, it appears as a top-level field alongside `data`.
- 60s timeout → "REST insert timed out" / etc.
- HTTP 4xx/5xx → throws with `REST <METHOD> {table}/{id}` prefix.

**Commit message:** `feat(bms): add browser restInsert/restUpdate/restDelete`

---

### Task 7: BMS session storage utility

**Files:**
- Create: `src/utils/bms-session-storage.ts`
- Test: `tests/unit/utils/bms-session-storage.test.ts`

Port `getSessionFromUrl`, `handleUrlSession`, `getSessionCookie`, `handleUrlMarketplaceToken`, `getMarketplaceToken`, `removeMarketplaceToken` from `C:/AIProject/hosxp-telemed/src/utils/sessionStorage.ts`. Keep the marketplace-token pairing rule: when a new session arrives in URL without a paired marketplace_token, drop the stale token.

**Step 1: Tests cover:**
- `getSessionFromUrl()` reads `?bms-session-id=` from `window.location.search`.
- `handleUrlSession()` strips the param after reading (using `history.replaceState`).
- `getSessionCookie()` returns the persisted session ID from `sessionStorage`.
- `getMarketplaceToken()` returns `null` if not stored.
- `handleUrlMarketplaceToken()` reads + persists + strips.

Use `vi.stubGlobal('window', { location: { search: '?bms-session-id=ABC', href: 'http://x/?bms-session-id=ABC' }, history: { replaceState: vi.fn() } })` and `vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })`.

**Commit message:** `feat(bms): add session storage helpers (port from hosxp-telemed)`

---

### Task 8: BMS session React context + hook

**Files:**
- Create: `src/contexts/BmsSessionContext.tsx`
- Create: `src/hooks/useBmsSession.ts`
- Test: `tests/unit/contexts/BmsSessionContext.test.tsx`

Port the context shape from `C:/AIProject/hosxp-telemed/src/contexts/BmsSessionContext.tsx`. Trim AI-specific fields. Expose:
```ts
interface BmsSessionContextValue {
  config: ConnectionConfig | null;
  userInfo: UserInfo | null;
  isReady: boolean;     // true once config + userInfo loaded
  error: string | null;
  refresh: (sessionId: string) => Promise<void>;
  clear: () => void;    // wipes sessionStorage + state, redirects to /login
}
```

**Step 1: Test cases:**
- Provider with no URL session + no stored session → `isReady === false`, `config === null`.
- URL session present → after mount, calls `retrieveBmsSession`, populates context, `isReady === true`.
- 401 from a downstream BMS call → `clear()` is callable; after call, `isReady === false`.
- Marketplace token pairing rule: new URL session without marketplace_token → existing token removed.

Use `@testing-library/react` `render` + `renderHook` patterns. Wrap with the provider; assert state.

`useBmsSession.ts` is a thin re-export:
```ts
'use client';
export { useBmsSession } from '@/contexts/BmsSessionContext';
```

**Commit message:** `feat(bms): add BmsSessionContext + useBmsSession hook`

---

### Task 9: SQL templates for maternity ward (read queries)

**Files:**
- Modify: `src/config/hosxp-queries.ts` — append all 17 templates from §6.2 of the design doc.
- Test: `tests/unit/config/maternity-queries.test.ts` — portability + presence assertions.

**Step 1: Write the failing test**
```ts
// tests/unit/config/maternity-queries.test.ts
import { describe, it, expect } from 'vitest';
import {
  MATERNITY_WARDS, WARD_BEDS_INVENTORY, WARD_BEDS_OCCUPANCY,
  PATIENT_PARTOGRAPH_BY_AN, PATIENT_VITAL_SIGNS_BY_AN,
  PATIENT_LABOUR_BY_AN, PATIENT_PREGNANCY_BY_AN, PATIENT_LABOR_BY_AN,
  PATIENT_LABOUR_MED_BY_AN, PATIENT_STAGE_MED_BY_AN,
  PATIENT_COMPLICATIONS_BY_LABOUR_ID, PATIENT_INFANTS_BY_AN,
  BED_MOVE_REASONS, DRUG_LOOKUP, LABOUR_COMPLICATION_LOOKUP,
  DCH_TYPE_LOOKUP, DCH_STTS_LOOKUP,
} from '@/config/hosxp-queries';

const ALL = [
  MATERNITY_WARDS, WARD_BEDS_INVENTORY, WARD_BEDS_OCCUPANCY,
  PATIENT_PARTOGRAPH_BY_AN, PATIENT_VITAL_SIGNS_BY_AN,
  PATIENT_LABOUR_BY_AN, PATIENT_PREGNANCY_BY_AN, PATIENT_LABOR_BY_AN,
  PATIENT_LABOUR_MED_BY_AN, PATIENT_STAGE_MED_BY_AN,
  PATIENT_COMPLICATIONS_BY_LABOUR_ID, PATIENT_INFANTS_BY_AN,
  BED_MOVE_REASONS, DRUG_LOOKUP, LABOUR_COMPLICATION_LOOKUP,
  DCH_TYPE_LOOKUP, DCH_STTS_LOOKUP,
];

describe('maternity SQL templates', () => {
  for (const t of ALL) {
    it('has both postgresql and mysql variants', () => {
      expect(t.postgresql).toBeTruthy();
      expect(t.mysql).toBeTruthy();
    });
    it('postgresql uses $N placeholders, mysql uses ?', () => {
      expect(t.mysql).not.toMatch(/\$\d/);
      // postgresql may have zero params, but must not have raw '?' placeholders
      expect(t.postgresql).not.toMatch(/\s\?\s/);
    });
    it('uses single quotes for string literals (no double-quoted strings)', () => {
      // Disallow "Y" but allow column aliases like AS "alias" inside if any
      // Simple check: the queries here don't use double quotes at all
      expect(t.postgresql).not.toMatch(/"[YN]"/);
      expect(t.mysql).not.toMatch(/"[YN]"/);
    });
    it('avoids non-portable functions', () => {
      const banned = /\b(CURDATE|NOW|INTERVAL\s+\d|FETCH\s+FIRST|TOP\s+\d)\b/i;
      expect(t.postgresql).not.toMatch(banned);
      expect(t.mysql).not.toMatch(banned);
    });
    it('avoids backticks', () => {
      expect(t.postgresql).not.toMatch(/`/);
      expect(t.mysql).not.toMatch(/`/);
    });
  }
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement** — append to `src/config/hosxp-queries.ts`. For each template, see the SQL specs in the design doc §6.2. Use the existing `SqlQueryTemplate` pattern. Example (give the executor one full template inline; the rest follow the same shape):

```ts
export const MATERNITY_WARDS: SqlQueryTemplate = {
  postgresql: `
    SELECT ward, name, real_bedcount
      FROM ward
     WHERE is_maternity_ward = 'Y' AND ward_active = 'Y'
     ORDER BY name`,
  mysql: `
    SELECT ward, name, real_bedcount
      FROM ward
     WHERE is_maternity_ward = 'Y' AND ward_active = 'Y'
     ORDER BY name`,
};

export const WARD_BEDS_INVENTORY: SqlQueryTemplate = {
  postgresql: `
    SELECT b.bedno, b.roomno, b.bed_order, b.bed_lock, b.bed_status_type_id,
           r.name AS room_name, r.display_number AS room_display_number
      FROM bedno b
      JOIN roomno r ON r.roomno = b.roomno
     WHERE r.ward = $1
     ORDER BY r.display_number, b.bed_order, b.bedno`,
  mysql: `
    SELECT b.bedno, b.roomno, b.bed_order, b.bed_lock, b.bed_status_type_id,
           r.name AS room_name, r.display_number AS room_display_number
      FROM bedno b
      JOIN roomno r ON r.roomno = b.roomno
     WHERE r.ward = ?
     ORDER BY r.display_number, b.bed_order, b.bedno`,
};

export const WARD_BEDS_OCCUPANCY: SqlQueryTemplate = {
  postgresql: `
    SELECT i.an, i.hn, i.regdate, i.regtime, i.ward,
           iptadm.bedno, iptadm.roomno, iptadm.bedtype,
           roomno.name AS roomname,
           p.pname, p.fname, p.lname, p.birthday,
           il.g AS gravida, il.ga,
           di.name AS incharge_doctor_name,
           (SELECT MAX(observe_datetime) FROM ipt_labour_partograph
             WHERE an = i.an) AS last_observation_at,
           (SELECT cervical_dilation_cm FROM ipt_labour_partograph
             WHERE an = i.an ORDER BY observe_datetime DESC LIMIT 1) AS last_cervix_cm
      FROM ipt i
      JOIN iptadm ON iptadm.an = i.an
      LEFT JOIN patient p ON p.hn = i.hn
      LEFT JOIN ipt_labour il ON il.an = i.an
      LEFT JOIN doctor di ON di.code = i.incharge_doctor
      LEFT JOIN roomno ON roomno.roomno = iptadm.roomno
     WHERE i.ward = $1 AND i.confirm_discharge = 'N'
     ORDER BY iptadm.bedno`,
  mysql: `… same body, $1 → ?`,
};
```

For the remaining 14 templates, follow:
- `PATIENT_PARTOGRAPH_BY_AN`: `SELECT * FROM ipt_labour_partograph WHERE an = $1 ORDER BY observe_datetime`
- `PATIENT_VITAL_SIGNS_BY_AN`: `SELECT * FROM ipt_pregnancy_vital_sign WHERE an = $1`
- `PATIENT_LABOUR_BY_AN`: `SELECT * FROM ipt_labour WHERE an = $1`
- `PATIENT_PREGNANCY_BY_AN`: `SELECT * FROM ipt_pregnancy WHERE an = $1`
- `PATIENT_LABOR_BY_AN`: `SELECT * FROM labor WHERE an = $1`
- `PATIENT_LABOUR_MED_BY_AN`: `SELECT * FROM labour_medication WHERE an = $1`
- `PATIENT_STAGE_MED_BY_AN`: `SELECT lsm.*, CONCAT(s.name, ' ', s.strength, ' ', s.units) AS medication_name, o.name AS staff_name FROM labour_stage_medication lsm LEFT JOIN s_drugitems s ON s.icode = lsm.icode LEFT JOIN opduser o ON o.loginname = lsm.staff WHERE lsm.an = $1 ORDER BY lsm.medication_date, lsm.medication_time`
- `PATIENT_COMPLICATIONS_BY_LABOUR_ID`: `SELECT lc.*, lcl.name AS complication_name FROM ipt_labour_complication lc LEFT JOIN labour_complication lcl ON lcl.labour_complication_id = lc.labour_complication_id WHERE lc.ipt_labour_id = $1`
- `PATIENT_INFANTS_BY_AN`: `SELECT n.*, li.* FROM ipt_newborn n LEFT JOIN ipt_labour_infant li ON li.an = n.an WHERE n.an = $1`
- `BED_MOVE_REASONS`: `SELECT reason FROM iptbedmove_reason ORDER BY reason`
- `DRUG_LOOKUP`: `SELECT icode, CONCAT(name, ' ', strength, ' ', units) AS label FROM s_drugitems WHERE name LIKE $1 ORDER BY name LIMIT 50` (caller should pass `prefix%`)
- `LABOUR_COMPLICATION_LOOKUP`: `SELECT labour_complication_id, name FROM labour_complication ORDER BY name`
- `DCH_TYPE_LOOKUP`: `SELECT dchtype, name FROM dchtype ORDER BY name`
- `DCH_STTS_LOOKUP`: `SELECT dchstts, name FROM dchstts ORDER BY name`

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/config/hosxp-queries.ts tests/unit/config/maternity-queries.test.ts
git commit -m "feat(queries): add 17 maternity-ward SQL templates with portability tests"
```

---

### Task 10: Domain types for maternity ward

**Files:**
- Create: `src/types/maternity-ward.ts`
- Test: `tests/unit/types/maternity-ward.test.ts` (type smoke)

**Step 3: Implement** — define interfaces matching the SQL row shapes:

```ts
// src/types/maternity-ward.ts
export interface MaternityWard { ward: string; name: string; real_bedcount: number | null; }

export interface BedSlot {
  bedno: string;
  roomno: string;
  bed_order: number | null;
  bed_lock: string | null;          // 'Y' | 'N' | null
  bed_status_type_id: number | null;
  room_name: string | null;
  room_display_number: number | null;
}

export interface BedOccupancy {
  an: string;
  hn: string;
  regdate: string;
  regtime: string | null;
  ward: string;
  bedno: string;
  roomno: string;
  bedtype: string | null;
  roomname: string | null;
  pname: string | null;
  fname: string | null;
  lname: string | null;
  birthday: string | null;
  gravida: number | null;
  ga: number | null;
  incharge_doctor_name: string | null;
  last_observation_at: string | null;
  last_cervix_cm: number | null;
}

// Partograph row mirrors ipt_labour_partograph fields used in the editor.
// Re-use the existing PartographRow type from src/services/sync/partograph.ts
// where possible; if shapes diverge, define a separate UI-side type.
export interface PartographRow {
  ipt_labour_partograph_id: number;
  ipt_labour_id: number;
  an: string;
  observe_datetime: string;
  hour_no: number | null;
  fetal_heart_rate: number | null;
  amniotic_fluid: string | null;
  moulding: string | null;
  cervical_dilation_cm: number | null;
  descent_of_head: string | null;
  contraction_per_10min: number | null;
  contraction_duration_sec: number | null;
  contraction_strength: string | null;
  oxytocin_uml: number | null;
  oxytocin_drops_min: number | null;
  drugs_iv_fluids: string | null;
  pulse: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature: number | null;
  urine_volume_ml: number | null;
  urine_protein: string | null;
  urine_glucose: string | null;
  urine_acetone: string | null;
  note: string | null;
}

export interface VitalSignRow {
  an: string; hr: number | null; bps: number | null; bpd: number | null;
  fetal_heart_sound: string | null; cervical_open_size: number | null;
  eff: number | null; station: string | null; hct: number | null;
  height: number | null; bw: number | null; temperature: number | null;
  rr: number | null; ultrasound_result: string | null;
  // …add the remaining columns by reading SHOW COLUMNS FROM ipt_pregnancy_vital_sign
}

export interface LabourRecord { an: string; ipt_labour_id: number; g: number | null; ga: number | null; anc_count: number | null; /* …more */ }
export interface PregnancyRecord { an: string; preg_number: number | null; ga: number | null; anc_complete: string | null; labor_date: string | null; /* …more */ }
export interface LaborRecord { laborid: number; an: string; mother_gvalue: number | null; mother_hct: number | null; mother_aging: number | null; /* …more */ }
export interface LabourMedRow { labour_medication_id: number; an: string; icode: string; qty: number; doctor_code: string | null; drugusage: string | null; medication_note_text: string | null; }
export interface StageMedRow { labour_stage_medication_id: number; an: string; icode: string; med_number: number | null; medication_result_text: string | null; qty: number | null; medication_date: string | null; medication_time: string | null; staff: string | null; medication_note: string | null; medication_name?: string; staff_name?: string; }
export interface ComplicationRow { ipt_labour_complication_id: number; ipt_labour_id: number; labour_complication_id: number | null; labour_stage_id: number | null; complication_note: string | null; complication_name?: string; }
export interface InfantRow { ipt_newborn_id?: number; ipt_labour_infant_id?: number; an: string; sex: string | null; birth_weight: number | null; /* …more */ }

export interface BedMoveArgs { an: string; oldWard: string; oldBedno: string; newWard: string; newBedno: string; newRoomno: string; reason: string; }
export interface DischargeArgs { an: string; dchdate: string; dchtime: string; dchtype: string; dchstts: string; }
```

**Commit message:** `feat(types): add maternity-ward domain types`

---

## Batch 2 — Layout migration: top navbar replaces sidebar (5 tasks)

### Task 11: Add `TopNavBar` component (no consumers yet)

**Files:**
- Create: `src/components/layout/TopNavBar.tsx`
- Test: `tests/unit/components/TopNavBar.test.tsx`

**Step 1: Write failing tests** — render `TopNavBar` inside a SessionProvider mock, assert:
- Renders all menu items (`แดชบอร์ด`, `ฝากครรภ์`, `โรงพยาบาล`, `ส่งต่อ`, `ผลลัพธ์ทารก`, `ห้องคลอด`).
- Hides `ตั้งค่า` for non-ADMIN users; shows it for ADMIN.
- Renders user name + role label.
- Renders logout button which calls `signOut`.
- Renders hospital name + hcode badge when `session.user.hospitalCode` is set.
- Active link gets the active styling class (`text-emerald-600` or whatever the design uses).

Use `@testing-library/react` and `vi.mock('next-auth/react', () => ({ SessionProvider: ({children}) => children, useSession: () => ({ data: { user: { name: 'X', role: 'NURSE', hospitalCode: '10670', hospitalName: 'รพ.ขอนแก่น' } } }), signOut: vi.fn() }))`.

**Step 3: Implement** — refactor the existing `TopBar.tsx` (which is breadcrumbs only) into a richer `TopNavBar.tsx` that includes left nav links + right identity. Use `lucide-react` icons. Pattern:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { LayoutDashboard, Baby, Building2, ArrowRightLeft, BarChart3, Stethoscope, Settings, LogOut, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'แดชบอร์ด', icon: LayoutDashboard },
  { href: '/pregnancies', label: 'ฝากครรภ์', icon: Baby },
  { href: '/hospitals', label: 'โรงพยาบาล', icon: Building2 },
  { href: '/referrals', label: 'ส่งต่อ', icon: ArrowRightLeft },
  { href: '/outcomes', label: 'ผลลัพธ์ทารก', icon: BarChart3 },
  { href: '/hospital-maternity-ward', label: 'ห้องคลอด', icon: Stethoscope },
  { href: '/admin', label: 'ตั้งค่า', icon: Settings, adminOnly: true },
] as const;

export function TopNavBar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = session?.user?.role;
  const items = NAV_ITEMS.filter(i => !i.adminOnly || userRole === 'ADMIN');
  // …render header with logo · nav · clock · hospital badge · user · logout
}
```

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/components/layout/TopNavBar.tsx tests/unit/components/TopNavBar.test.tsx
git commit -m "feat(layout): add TopNavBar component (replaces sidebar)"
```

---

### Task 12: Rename `(dashboard)` route group → `(provincial)` and switch to top navbar

**Files:**
- Move: `src/app/(dashboard)/` → `src/app/(provincial)/`
- Modify: `src/app/(provincial)/layout.tsx` — replace `<DashboardLayout>` with new top-navbar shell.

**Step 1:** No new test (this is a structural move). Run existing E2E to confirm nothing broke later.

**Step 2: Move folder**
```bash
git mv src/app/\(dashboard\) src/app/\(provincial\)
```
(On Windows bash, escape parens with backslash or quote the path.)

**Step 3: Replace layout body**
```tsx
// src/app/(provincial)/layout.tsx
import { SessionProvider } from 'next-auth/react';
import { TopNavBar } from '@/components/layout/TopNavBar';
import { BreadcrumbProvider } from '@/components/layout/BreadcrumbContext';

export default function ProvincialLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BreadcrumbProvider>
        <div className="flex min-h-screen flex-col bg-slate-50/50">
          <TopNavBar />
          <main className="flex-1">
            <div className="mx-auto max-w-[1400px] p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </BreadcrumbProvider>
    </SessionProvider>
  );
}
```

**Step 4: Run full test suite + lint**
```bash
npm test -- --run && npm run lint
```
Expected: PASS. If any test references `(dashboard)` path strings, update them.

**Step 5: Commit**
```bash
git add src/app/\(provincial\) src/app/\(dashboard\) -A
git commit -m "refactor(layout): rename (dashboard) → (provincial), switch to top navbar"
```

---

### Task 13: Delete `Sidebar.tsx` and old `TopBar.tsx`

**Files:**
- Delete: `src/components/layout/Sidebar.tsx`
- Delete: `src/components/layout/TopBar.tsx` (old breadcrumb-only version)
- Delete: `src/components/layout/DashboardLayout.tsx`

**Step 1:** Search for any remaining imports
```bash
grep -r "from '@/components/layout/Sidebar'" src tests
grep -r "from '@/components/layout/TopBar'" src tests
grep -r "from '@/components/layout/DashboardLayout'" src tests
```
Expected: 0 results. If any, remove them.

**Step 2: Delete + run tests**
```bash
rm src/components/layout/Sidebar.tsx src/components/layout/TopBar.tsx src/components/layout/DashboardLayout.tsx
npm test -- --run && npm run lint
```
Expected: PASS.

**Step 3: Commit**
```bash
git add -A src/components/layout/
git commit -m "refactor(layout): remove obsolete Sidebar/TopBar/DashboardLayout"
```

---

### Task 14: Add E2E sanity test for provincial dashboard with top navbar

**Files:**
- Create: `tests/e2e/provincial-topnavbar.spec.ts`

**Step 1: Write the test** — Playwright spec that:
1. Logs in via `?bms-session-id=` URL (use the existing E2E auth bypass).
2. Navigates to `/`.
3. Asserts top navbar is visible (`role="navigation"` or specific selector).
4. Asserts left sidebar is NOT visible.
5. Clicks "โรงพยาบาล" → URL becomes `/hospitals`.

**Step 2: Run** → likely FAIL (test asserts current dashboard renders correctly with the new layout).

**Step 3:** Fix any rendering bugs from Task 12-13 surfaced by the E2E.

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add tests/e2e/provincial-topnavbar.spec.ts
git commit -m "test(e2e): provincial dashboard renders correctly with top navbar"
```

---

### Task 15: Manual smoke — start dev server, click around

**Files:** None.

**Step 1:** `npm run dev` (background)
**Step 2:** Browse to `http://localhost:3000/`, confirm:
- Top navbar shows
- Old sidebar gone
- Clicking each nav item works
- Hospital badge shows in top-right
- Logout button works
**Step 3:** Stop dev server.
**Step 4: No commit** — manual verification only. Note any bugs in TodoWrite to fix in this batch.

---

## Batch 3 — Hospital route shell (4 tasks)

### Task 16: Create `(hospital)` route group with auth-gated stub page

**Files:**
- Create: `src/app/(hospital)/layout.tsx`
- Create: `src/app/(hospital)/hospital-maternity-ward/page.tsx` (stub)
- Test: `tests/e2e/hospital-route-auth.spec.ts`

**Step 1: Write failing E2E test:**
- Unauthenticated visit to `/hospital-maternity-ward` → redirected to `/login?callbackUrl=/hospital-maternity-ward`.
- Authenticated visit (via `?bms-session-id=`) → page renders "ห้องคลอด" header.

**Step 2: Run** → FAIL (no page exists).

**Step 3: Implement**
```tsx
// src/app/(hospital)/layout.tsx
import { SessionProvider } from 'next-auth/react';
import { BmsSessionProvider } from '@/contexts/BmsSessionContext';
import { TopNavBar } from '@/components/layout/TopNavBar';

export default function HospitalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <BmsSessionProvider>
        <div className="flex min-h-screen flex-col bg-slate-50/50">
          <TopNavBar />
          <main className="flex-1">{children}</main>
        </div>
      </BmsSessionProvider>
    </SessionProvider>
  );
}
```

```tsx
// src/app/(hospital)/hospital-maternity-ward/page.tsx
'use client';
import { useBmsSession } from '@/hooks/useBmsSession';

export default function HospitalMaternityWardPage() {
  const { isReady, userInfo, error } = useBmsSession();

  if (error) return <div className="p-8 text-red-600">เกิดข้อผิดพลาด: {error}</div>;
  if (!isReady) {
    return (
      <div className="p-8 text-center text-slate-500">
        เปิดหน้านี้จาก HOSxP เพื่อใช้งาน
        <br />
        <span className="text-xs">(ไม่พบ BMS Session — กรุณาเข้าผ่าน HOSxP)</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
      <h1 className="text-2xl font-bold">ห้องคลอด — {userInfo?.fullname}</h1>
      <p className="mt-2 text-sm text-slate-500">โรงพยาบาล: {userInfo?.hospcode}</p>
    </div>
  );
}
```

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/app/\(hospital\)/ tests/e2e/hospital-route-auth.spec.ts
git commit -m "feat(hospital): add (hospital) route group + maternity-ward stub page"
```

---

### Task 17: Audit-log server route

**Files:**
- Create: `src/app/api/hospital/audit-log/route.ts`
- Test: `tests/unit/api/hospital-audit-log.test.ts`

**Step 1: Write failing tests:**
- POST without NextAuth session → 401.
- POST with wrong `body.hcode` (not matching `session.user.hospitalCode`) → 403.
- POST with valid input → 200 + inserts a row into `audit_logs` (verify via `db.query`).
- POST that throws inside the audit insert → still returns 200 (fire-and-forget contract).

Pattern: bootstrap a SqliteAdapter `:memory:`, inject via the existing `getDatabase()` mock, build a `Request` with mocked `auth()` returning `{ user: { id: 'user-uuid', hospitalCode: '10670', role: 'NURSE' } }`.

**Step 2: Run** → FAIL.

**Step 3: Implement**
```ts
// src/app/api/hospital/audit-log/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { entity?: string; op?: string; resourceId?: string; fieldsTouched?: string[]; hcode?: string; staff?: string }
    | null;

  if (!body || !body.entity || !body.op || !body.hcode) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (body.hcode !== session.user.hospitalCode) {
    return NextResponse.json({ error: 'hcode mismatch' }, { status: 403 });
  }

  // Fire-and-forget contract: never block the caller, never throw.
  try {
    const db = await getDatabase();
    await db.execute(
      'INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        uuidv4(),
        session.user.id,
        `bms.${body.entity}.${body.op}`,
        body.entity,
        body.resourceId ?? null,
        JSON.stringify({ fieldsTouched: body.fieldsTouched, hcode: body.hcode, staff: body.staff }),
        new Date().toISOString(),
      ],
    );
  } catch {
    // swallow — caller does not retry
  }
  return NextResponse.json({ ok: true });
}
```

**Step 4: Run** → PASS.

**Step 5: Commit**
```bash
git add src/app/api/hospital/audit-log/ tests/unit/api/hospital-audit-log.test.ts
git commit -m "feat(audit): add /api/hospital/audit-log fire-and-forget sink"
```

---

### Task 18: Update middleware to allow `/hospital-maternity-ward`

**Files:**
- Modify: `src/middleware.ts`

**Step 1:** Read current middleware. The existing matcher already covers all routes. The auth check at line 38 already redirects to `/login?callbackUrl=...` and preserves `bms-session-id`. So technically no middleware change is needed.

**Step 2: Verify with E2E** — `tests/e2e/hospital-route-auth.spec.ts` from Task 16 already covers it. Run:
```bash
npm run test:e2e -- hospital-route-auth.spec.ts
```
Expected: PASS.

**Step 3: No code change needed** — skip implement + commit. Add a TODO comment at the top of the middleware noting the new path is handled by the existing redirect logic.

```ts
// src/middleware.ts (top comment update)
// /hospital-maternity-ward is gated by NextAuth (existing redirect) +
// BmsSessionContext at the page level (no middleware-level userType check).
```

**Step 4: Commit only if comment added**
```bash
git add src/middleware.ts
git commit -m "docs(middleware): note hospital-maternity-ward auth model"
```

---

### Task 19: Manual smoke — landing flow with the test bms-session-id

**Files:** None.

**Step 1:** Start dev server. **Step 2:** Visit `http://localhost:3000/hospital-maternity-ward?bms-session-id=33768683-CE0B-44AC-832C-8049D65D5A92`. **Step 3:** Verify (a) NextAuth signs in, (b) `BmsSessionContext` loads, (c) page shows "ห้องคลอด — <fullname>". **Step 4:** Stop dev server. No commit.

---

## Batch 4 — Read path: ward listing + bed grid (6 tasks)

### Task 20: Domain service — `listMaternityWards`

**Files:**
- Create: `src/services/maternity-ward.ts`
- Test: `tests/unit/services/maternity-ward.test.ts`

**Step 1: Failing test** — mock `executeSql` to return `{ data: [{ ward: '03', name: 'ห้องคลอด', real_bedcount: 12 }] }`; call `listMaternityWards(config)`; assert returned array shape.

**Step 3: Implement**
```ts
// src/services/maternity-ward.ts
'use client';
import { executeSql } from '@/lib/bms-browser-client';
import { MATERNITY_WARDS, getQuery } from '@/config/hosxp-queries';
import type { ConnectionConfig } from '@/types/bms-browser';
import type { MaternityWard } from '@/types/maternity-ward';

// HOSxP tunnels behind BMS Session API are typically MySQL (HOSxP standard).
// Until we expose the dialect via the session, default to mysql for the
// browser-side queries. Server-side polling already detects via
// detectDatabaseType(); this client mirror does the same when needed in v2.
const DEFAULT_DIALECT = 'mysql' as const;

export async function listMaternityWards(config: ConnectionConfig): Promise<MaternityWard[]> {
  const sql = getQuery(MATERNITY_WARDS, DEFAULT_DIALECT);
  const r = await executeSql<MaternityWard>(sql, config);
  return r.data;
}
```

**Step 5: Commit:** `feat(maternity): add listMaternityWards`

---

### Task 21: Domain service — `listWardBedsInventory` + `listWardBedsOccupancy`

Same TDD pattern. Two functions in one task (parallel structure, each ~5 lines).

**Step 5: Commit:** `feat(maternity): add bed inventory + occupancy queries`

---

### Task 22: SWR hook for ward state

**Files:**
- Create: `src/hooks/useMaternityWardState.ts`
- Test: `tests/unit/hooks/useMaternityWardState.test.tsx`

**Step 3: Implement** — combines the three queries with `useSWR`, returning `{ wards, beds, occupancy, isLoading, error, mutate }`. Refresh interval 20000ms.

```ts
// src/hooks/useMaternityWardState.ts
'use client';
import useSWR from 'swr';
import { useBmsSession } from '@/hooks/useBmsSession';
import { listMaternityWards, listWardBedsInventory, listWardBedsOccupancy } from '@/services/maternity-ward';

export function useMaternityWardState() {
  const { config } = useBmsSession();

  const { data: wards } = useSWR(
    config ? ['maternity-wards', config.apiUrl] : null,
    () => listMaternityWards(config!),
    { refreshInterval: 20_000 },
  );

  const ward = wards?.[0]?.ward;

  const { data: beds, mutate: mutateBeds } = useSWR(
    config && ward ? ['ward-beds-inventory', config.apiUrl, ward] : null,
    () => listWardBedsInventory(config!, ward!),
    { refreshInterval: 60_000 }, // beds rarely change
  );

  const { data: occupancy, mutate: mutateOccupancy } = useSWR(
    config && ward ? ['ward-beds-occupancy', config.apiUrl, ward] : null,
    () => listWardBedsOccupancy(config!, ward!),
    { refreshInterval: 20_000 },
  );

  return {
    wards: wards ?? [],
    beds: beds ?? [],
    occupancy: occupancy ?? [],
    isLoading: !wards && config !== null,
    mutateBeds, mutateOccupancy,
  };
}
```

**Step 5: Commit:** `feat(maternity): add useMaternityWardState SWR hook`

---

### Task 23: `BedTile` component (occupied/empty/locked variants)

**Files:**
- Create: `src/components/maternity/BedTile.tsx`
- Test: `tests/unit/components/maternity/BedTile.test.tsx`

**Step 1: Failing tests:**
- Empty bed → renders "ว่าง", gray background.
- Locked bed (`bed_lock = 'Y'`) → renders lock icon, grayed out.
- Occupied bed → renders patient name, age, GA, last-cervix value.
- Click handler fires with the bed/AN payload.

**Step 3: Implement** — see design §8.2 for the look. Use existing color tokens from kk-lrms.

**Step 5: Commit:** `feat(maternity): add BedTile component`

---

### Task 24: `WardLayoutView` component (room-grouped grid)

**Files:**
- Create: `src/components/maternity/WardLayoutView.tsx`
- Test: `tests/unit/components/maternity/WardLayoutView.test.tsx`

**Step 1: Failing tests:**
- Renders one section per `roomno` (with room name + display number as header).
- Beds inside each section ordered by `bed_order`.
- Maps occupancy onto bed slots correctly.
- Calls `onBedClick(an)` when an occupied bed is clicked.

**Step 3: Implement.** Drag-drop is added in Batch 7 — for now this is a static grid.

**Step 5: Commit:** `feat(maternity): add WardLayoutView room-grouped grid`

---

### Task 25: Wire page to render the ward grid

**Files:**
- Modify: `src/app/(hospital)/hospital-maternity-ward/page.tsx`
- Modify: `tests/e2e/hospital-route-auth.spec.ts` (extend or create new)

**Step 1: Failing E2E** — with mock BMS server (Task 26 sets up the helper) returning 1 ward + 4 beds (2 occupied), assert:
- Page shows "ห้องคลอด · 4 เตียง · ใช้งาน 2 · ว่าง 2" header.
- 4 BedTile elements visible.

**Step 3: Implement** — replace the stub with the real layout.

**Step 5: Commit:** `feat(maternity): wire WardLayoutView into page`

---

## Batch 5 — Mock BMS server + E2E foundation (3 tasks)

### Task 26: Mock BMS server helper

**Files:**
- Create: `tests/helpers/createMockBmsServer.ts`
- Test: `tests/unit/helpers/createMockBmsServer.test.ts`

**Step 3: Implement** — small `http.createServer` that:
- Routes `POST /api/sql` → if request body matches a known SQL prefix, return canned data
- Routes `POST /api/function?name=X` → return `{ MessageCode: 200, Message: 'ok', Value: 12345 }` for `get_serialnumber`
- Routes `POST /api/rest/{table}` → echo `{ MessageCode: 200, Message: 'ok', insert_count: 1 }`
- Routes `PUT /api/rest/{table}/{id}` → echo `{ MessageCode: 200, Message: 'ok', update_count: 1 }`
- Routes `DELETE /api/rest/{table}/{id}` → echo `{ MessageCode: 200, Message: 'ok' }`

Returns:
```ts
export interface MockBmsServer {
  url: string;            // http://127.0.0.1:PORT
  setSqlResponse(predicate: (sql: string) => boolean, data: unknown[]): void;
  recordedRequests: Array<{ method: string; path: string; body: unknown }>;
  close(): Promise<void>;
}
```

**Step 5: Commit:** `test(helpers): add createMockBmsServer for browser-direct E2E`

---

### Task 27: Mock `BmsSessionContext` for E2E (override fetch on `PASTE_JSON_URL`)

**Files:**
- Create: `tests/helpers/mockBmsSessionRetrieve.ts`

**Step 3: Implement** — a Playwright fixture that intercepts `https://hosxp.net/phapi/PasteJSON` with `page.route` and returns `{ jwt: 'fake', bms_url: '<mockServer.url>/api', user_info: { loginname: 'nurse1', fullname: 'Nurse One', hospcode: '10670' }, expired_second: 3600 }`.

**Step 5: Commit:** `test(helpers): add mockBmsSessionRetrieve fixture`

---

### Task 28: First E2E using mock BMS server — render bed grid

**Files:**
- Create: `tests/e2e/maternity-ward-render.spec.ts`

**Step 1: Failing test** — boot mock BMS server, configure it to return 1 ward + 4 beds + 2 occupants; navigate to `/hospital-maternity-ward?bms-session-id=fake`; assert the 4 BedTiles render with expected names.

**Step 3:** Should pass once mock + retrieval intercept work end-to-end. Fix any wiring bugs.

**Step 5: Commit:** `test(e2e): maternity-ward renders bed grid via mock BMS`

---

## Batch 6 — Drawer + read-only tabs (12 tasks)

### Task 29: `PatientDrawer` shell + tab definitions

**Files:**
- Create: `src/components/maternity/PatientDrawer.tsx`
- Test: `tests/unit/components/maternity/PatientDrawer.test.tsx`

**Step 1: Failing tests:**
- Drawer opens/closes via prop `open`.
- Header shows AN + name + age + GA + bedno.
- 10 tab buttons rendered: Partograph, Vitals, Pre-labour, Stage, Med Used, DR Med, Complications, Infant, Bed, Discharge.
- Click tab switches active panel.

**Step 3: Implement** — use `Sheet` from shadcn (or a base-ui component if shadcn not installed for Sheet yet — check `src/components/ui/`). Use `Tabs`.

**Step 5: Commit:** `feat(maternity): add PatientDrawer shell with 10 tabs`

---

### Tasks 30-39: Read-only tab implementations (10 tasks, one per tab)

Each task follows this template (~5 minutes per tab):

**Files:**
- Create: `src/components/maternity/tabs/<TabName>Tab.tsx`
- Create: `src/services/maternity-ward.ts` (append `getPatient<Entity>` function)
- Test: `tests/unit/components/maternity/tabs/<TabName>Tab.test.tsx`

**Steps:**
1. **Failing test**: render tab with mocked SWR returning 2 rows; assert table has 2 rows with expected fields.
2. **Run** → FAIL.
3. **Implement**: `getPatient<Entity>(config, an)` calls `executeSql` with the matching template. Tab component uses `useSWR`-wraps it. Table is read-only (`<Table>` from shadcn).
4. **Run** → PASS.
5. **Commit**: `feat(maternity): add <TabName>Tab read-only`

**Tab list (each = one task = one commit):**

| # | Task | Tab | Service fn | SQL template |
|---|---|---|---|---|
| 30 | PartographTab | Partograph | `getPatientPartograph` | `PATIENT_PARTOGRAPH_BY_AN` |
| 31 | VitalsTab | Vitals | `getPatientVitalSigns` | `PATIENT_VITAL_SIGNS_BY_AN` |
| 32 | PreLabourTab | Pre-labour | `getPatientLabour` + `getPatientPregnancy` | `PATIENT_LABOUR_BY_AN` + `PATIENT_PREGNANCY_BY_AN` |
| 33 | StageTab | Stage | `getPatientLabour` + `getPatientLabor` | `PATIENT_LABOUR_BY_AN` + `PATIENT_LABOR_BY_AN` |
| 34 | MedicationsTab | Med Used | `getPatientLabourMedications` | `PATIENT_LABOUR_MED_BY_AN` |
| 35 | StageMedTab | DR Med | `getPatientStageMedications` | `PATIENT_STAGE_MED_BY_AN` |
| 36 | ComplicationsTab | Complications | `getPatientComplications` | `PATIENT_COMPLICATIONS_BY_LABOUR_ID` |
| 37 | InfantTab | Infant | `getPatientInfants` | `PATIENT_INFANTS_BY_AN` |
| 38 | BedTab | Bed | reads from `BedOccupancy` (already loaded) | n/a |
| 39 | DischargeTab | Discharge | reads from `BedOccupancy` (already loaded) | n/a |

**For ComplicationsTab specifically:** the read needs `ipt_labour_id` first — call `getPatientLabour(an)` to look it up, then `getPatientComplications(iptLabourId)`. Test must cover this two-step lookup.

---

### Task 40: Wire drawer into ward page

**Files:**
- Modify: `src/app/(hospital)/hospital-maternity-ward/page.tsx`
- Create: `tests/e2e/maternity-ward-drawer.spec.ts`

**Step 1: Failing E2E** — click first occupied bed → drawer opens with patient info → click "Partograph" tab → table shows partograph rows.

**Step 3:** Manage `selectedAn` state in the page; pass to `<PatientDrawer open={!!selectedAn} an={selectedAn} onClose={() => setSelectedAn(null)} />`.

**Step 5: Commit:** `feat(maternity): wire PatientDrawer into page with tab navigation`

---

## Batch 7 — CRUD per tab (10 tasks, one per tab)

Each tab gets a CRUD-enable task. Pattern is the same for all 10. The Partograph task is detailed below as the canonical example; the rest follow it.

### Task 41 (canonical): Partograph CRUD

**Files:**
- Modify: `src/services/maternity-ward.ts` — add `upsertPartograph` + `deletePartograph`
- Modify: `src/components/maternity/tabs/PartographTab.tsx` — switch from read-only to inline-edit + add + delete
- Test: `tests/unit/services/maternity-ward.test.ts` (extend), `tests/e2e/maternity-ward-partograph-crud.spec.ts`

**Step 1: Failing tests:**

(a) **Service test** — `upsertPartograph(config, userInfo, an, row, hcode)`:
- When `row.ipt_labour_partograph_id` is set → calls `restUpdate('ipt_labour_partograph', id, fields, config)`.
- When `row.ipt_labour_partograph_id` is unset → calls `callFunction('get_serialnumber', { id_field: 'ipt_labour_partograph_id' })` then `restInsert('ipt_labour_partograph', { ...row, ipt_labour_partograph_id })`.
- After success → fires `POST /api/hospital/audit-log` with `{ entity: 'ipt_labour_partograph', op: 'upsert', resourceId: <id>, hcode, staff: userInfo.loginname }`.
- Audit POST failure does NOT throw.

(b) **Service test** — `deletePartograph`:
- Calls `restDelete('ipt_labour_partograph', id, config)`.
- Fires audit POST.

(c) **E2E test** — open drawer → Partograph tab → click row to edit → change `cervical_dilation_cm` from 4 → 5 → click Save → mock BMS receives `PUT /api/rest/ipt_labour_partograph/{id}` with `{cervical_dilation_cm: 5}` → SWR revalidates.

**Step 2: Run** → FAIL.

**Step 3: Implement**

```ts
// src/services/maternity-ward.ts (append)
import { restInsert, restUpdate, restDelete, callFunction } from '@/lib/bms-browser-client';
import type { UserInfo } from '@/types/bms-browser';
import type { PartographRow } from '@/types/maternity-ward';

async function fireAudit(payload: { entity: string; op: string; resourceId: string; hcode: string; staff?: string; fieldsTouched?: string[] }): Promise<void> {
  // Fire-and-forget: never await the response, swallow errors
  void fetch('/api/hospital/audit-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

async function mintSerial(idField: string, config: ConnectionConfig): Promise<number> {
  const r = await callFunction<{ Value: number }>('get_serialnumber', config, { id_field: idField });
  return Number(r.Value);
}

export async function upsertPartograph(
  config: ConnectionConfig, userInfo: UserInfo, an: string,
  row: Partial<PartographRow>, hcode: string,
): Promise<PartographRow> {
  const isNew = row.ipt_labour_partograph_id === undefined;
  if (isNew) {
    const id = await mintSerial('ipt_labour_partograph_id', config);
    const payload = { ...row, ipt_labour_partograph_id: id, an };
    await restInsert('ipt_labour_partograph', payload, config);
    fireAudit({ entity: 'ipt_labour_partograph', op: 'insert', resourceId: String(id), hcode, staff: userInfo.loginname });
    return payload as PartographRow;
  }
  const { ipt_labour_partograph_id, ...fields } = row;
  await restUpdate('ipt_labour_partograph', String(ipt_labour_partograph_id), fields, config);
  fireAudit({
    entity: 'ipt_labour_partograph', op: 'update',
    resourceId: String(ipt_labour_partograph_id), hcode, staff: userInfo.loginname,
    fieldsTouched: Object.keys(fields),
  });
  return row as PartographRow;
}

export async function deletePartograph(
  config: ConnectionConfig, userInfo: UserInfo, id: number, hcode: string,
): Promise<void> {
  await restDelete('ipt_labour_partograph', id, config);
  fireAudit({ entity: 'ipt_labour_partograph', op: 'delete', resourceId: String(id), hcode, staff: userInfo.loginname });
}
```

**PartographTab.tsx changes:**
- Add inline-edit state (which row is being edited).
- "+ เพิ่มเวลาใหม่" button → opens new-row form.
- Save button → calls `upsertPartograph` → optimistic update → SWR `mutate()`.
- Delete button (with confirm) → calls `deletePartograph`.

**Step 4: Run** → PASS.

**Step 5: Commit:** `feat(maternity): partograph CRUD with audit fire`

---

### Tasks 42-50: Repeat the canonical pattern for the other 9 tabs

| # | Tab | Service fns added | Notes |
|---|---|---|---|
| 42 | Vitals | `upsertVitalSign` + `deleteVitalSign` | PK is composite → use `(an, hr_time)` or first read existing PK |
| 43 | Pre-labour | `upsertPregnancy` + `upsertLabour` | Single Save button writes BOTH tables — sequential best-effort |
| 44 | Stage | `upsertLabour` (already added) + `upsertLabor` | Same shape as #43 |
| 45 | Medications used | `upsertLabourMedication` + `deleteLabourMedication` | New ID via `get_serialnumber('labour_medication_id')` |
| 46 | DR Med | `upsertStageMedication` + `deleteStageMedication` | DB auto-increments PK; no serialnumber needed |
| 47 | Complications | `upsertComplication` + `deleteComplication` | Pre-step: lookup `ipt_labour_id` from `getPatientLabour(an)` |
| 48 | Infant | `upsertNewborn` + `upsertLabourInfant` + `deleteInfant` | Two-table write |
| 49 | Bed (form-driven move) | `movePatientBed` (defined in Task 51 of Batch 8 — for now this tab is read-only and links to drag-drop) | Skip CRUD here; just view |
| 50 | Discharge | `dischargePatient` | Two-table write: `restUpdate('ipt', an, {...})` + `restUpdate('iptadm', an, { outdate, outtime })` |

Each task: same 5-step TDD shape as Task 41. Each ends with a commit message of the form `feat(maternity): <tab> CRUD`.

---

## Batch 8 — Drag-drop bed move (3 tasks)

### Task 51: Service — `movePatientBed`

**Files:**
- Modify: `src/services/maternity-ward.ts`
- Test: `tests/unit/services/maternity-ward.test.ts`

**Step 1: Failing test** — `movePatientBed(config, userInfo, hcode, args)`:
- Calls `restUpdate('iptadm', args.an, { bedno: args.newBedno, roomno: args.newRoomno })`.
- Calls `callFunction('get_serialnumber', { id_field: 'iptbedmove_id' })`.
- Calls `restInsert('iptbedmove', { iptbedmove_id, an, oward, obedno, nward, nbedno, nroomno, movereason, staff, movedate, movetime, entry_datetime })` with current date/time.
- Fires audit.

**Step 3: Implement** — composite write, sequential.

**Step 5: Commit:** `feat(maternity): add movePatientBed service`

---

### Task 52: `BedMoveReasonModal` + drag-drop wiring

**Files:**
- Create: `src/components/maternity/BedMoveReasonModal.tsx`
- Modify: `src/components/maternity/WardLayoutView.tsx` — wrap with `DndContext`, make `BedTile` draggable + droppable.
- Test: `tests/unit/components/maternity/BedMoveReasonModal.test.tsx`

**Step 1: Failing tests:**
- Modal renders combobox of reasons (passed via prop, sourced from `getBedMoveReasons`).
- Submit fires `onConfirm(reason)`.
- Cancel closes without firing.

**Step 3: Implement** — use `@dnd-kit/core` `DndContext` + `useDraggable` + `useDroppable`. On drop:
- If target bed is locked (`bed_lock === 'Y'`) → toast "เตียงถูกล็อก", do nothing.
- If target bed is occupied → toast "เตียงไม่ว่าง" (v1: no swap), do nothing.
- If target bed is empty → open `BedMoveReasonModal` with the patient + new bed details. On confirm → call `movePatientBed` → SWR `mutate()`.

**Step 5: Commit:** `feat(maternity): drag-drop bed move with reason modal`

---

### Task 53: E2E — full drag-drop flow

**Files:**
- Create: `tests/e2e/maternity-ward-bed-move.spec.ts`

**Step 1: Failing test** — boot mock BMS, configure 4 beds (1 occupied at Bed01); drag patient card from Bed01 to Bed03; assert reason modal appears; pick a reason; assert mock receives `restUpdate(iptadm, ...)` + `callFunction(get_serialnumber)` + `restInsert(iptbedmove, ...)`; assert grid reflects new bed.

**Step 3:** Fix any wiring bugs.

**Step 5: Commit:** `test(e2e): drag-drop bed move full flow`

---

## Batch 9 — Smoke + polishing (4 tasks)

### Task 54: Live smoke test (gated, never runs in CI)

**Files:**
- Create: `tests/smoke/maternity-ward-live.test.ts`

Use the design's smoke template. Read-only. `describe.skipIf(!process.env.LIVE_BMS_SESSION_ID)`.

**Run locally:**
```bash
LIVE_BMS_SESSION_ID=33768683-CE0B-44AC-832C-8049D65D5A92 npm test -- tests/smoke
```

**Step 5: Commit:** `test(smoke): add live BMS smoke test (gated)`

---

### Task 55: Loading + error + empty states polish

**Files:**
- Modify: `src/app/(hospital)/hospital-maternity-ward/page.tsx`
- Modify: `src/components/maternity/PatientDrawer.tsx`

Add: skeleton loaders, Thai error toasts, empty-state illustrations. Confirm no inflight queries fire while `BmsSessionContext.isReady === false`.

**Step 5: Commit:** `feat(maternity): polish loading/error/empty states`

---

### Task 56: Keyboard accessibility for drag-drop

**Files:**
- Modify: `src/components/maternity/WardLayoutView.tsx`
- Test: `tests/unit/components/maternity/WardLayoutView.keyboard.test.tsx`

`@dnd-kit/core`'s `KeyboardSensor` allows tabbing to a draggable, pressing space to pick up, arrow keys to navigate, space to drop. Add this sensor + assert via test that keyboard interaction triggers `movePatientBed`.

**Step 5: Commit:** `feat(a11y): keyboard navigation for bed drag-drop`

---

### Task 57: Final manual smoke + design-doc cross-reference

**Files:** None.

**Step 1:** Re-read the design doc. For each "looks right" approved section, verify the implementation matches. **Step 2:** `npm run dev`, exercise each tab CRUD, drag-drop, discharge. **Step 3:** No commit; if gaps found, file follow-up tasks.

After this task, run **superpowers:finishing-a-development-branch** to close out the work.

---

## Appendix A — Tasks summary

| Batch | Tasks | Theme |
|---|---|---|
| 0 | 1 | dnd-kit install |
| 1 | 10 | BMS browser client foundations |
| 2 | 5 | Layout migration to top navbar |
| 3 | 4 | Hospital route shell + audit-log route |
| 4 | 6 | Read path: ward + bed grid |
| 5 | 3 | Mock BMS server for E2E |
| 6 | 12 | Drawer + 10 read-only tabs |
| 7 | 10 | CRUD per tab |
| 8 | 3 | Drag-drop bed move |
| 9 | 4 | Smoke + polish |
| **Total** | **58** | |

Estimated effort: ~3-5 days for one experienced engineer working sequentially, or 1-2 days with subagent-driven parallel batches.

---

## Appendix B — Skills referenced

- @superpowers:test-driven-development — every task uses RED → GREEN → COMMIT.
- @superpowers:executing-plans (parallel session) or @superpowers:subagent-driven-development (same session) — for running this plan.
- @superpowers:requesting-code-review — invoke between batches if subagent-driven.
- @superpowers:finishing-a-development-branch — after Task 57.
