# Partograph Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ingest the new HOSxP `ipt_labour_partograph` time series into kk-lrms, accept the same data via webhook from non-HOSxP hospitals, port the Pascal `PartographCDSSUnit` clinical decision rules to TypeScript, and surface a 4-panel WHO-style chart + alert summary panel + dashboard severity dot.

**Architecture:** New `cached_partograph_observations` table written by a single shared handler that both the HOSxP polling pipeline and the webhook handler call. The CDSS rule engine lives in `src/services/partogram.ts` as pure functions. Per-patient rolled-up severity is stored on `cached_patients` for cheap dashboard rendering; the rich detail view always recomputes from raw observations. Integration tests use `@electric-sql/pglite` so the production Postgres dialect is exercised in CI.

**Tech Stack:** Next.js 15 (App Router), TypeScript 5.x strict, Vitest, `better-sqlite3` (existing test backend), `@electric-sql/pglite` (new — Postgres dialect tests), Recharts, shadcn/ui, Tailwind CSS 4.

**Reference design:** `docs/plans/2026-04-19-partograph-support-design.md` — load this as context when starting work.

---

## Phase 0 — Worktree & Branch

### Task 0: Create isolated worktree

**Step 1:** From the kk-lrms repo, create a worktree on a new branch.

Run:
```bash
git worktree add ../kk-lrms-partograph -b feat/partograph-support
cd ../kk-lrms-partograph
npm install
```

**Step 2:** Verify clean baseline.

Run: `npm test && npm run lint`
Expected: all existing tests pass, no lint errors.

**Step 3:** Commit nothing yet — worktree is the starting point.

---

## Phase 1 — Foundation (pglite adapter + schema)

### Task 1: Add `@electric-sql/pglite` dev dependency

**Files:**
- Modify: `package.json`

**Step 1:** Install pglite.

Run: `npm install --save-dev @electric-sql/pglite`
Expected: package.json shows `"@electric-sql/pglite": "^0.x"` under `devDependencies`.

**Step 2:** Verify it loads.

Run: `node -e "import('@electric-sql/pglite').then(m => console.log(typeof m.PGlite))"`
Expected: prints `function`.

**Step 3:** Commit.

```bash
git add package.json package-lock.json
git commit -m "chore: add @electric-sql/pglite for postgres-dialect integration tests"
```

---

### Task 2: Implement `PgliteAdapter`

**Files:**
- Create: `src/db/pglite-adapter.ts`
- Test: `tests/unit/db/pglite-adapter.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/db/pglite-adapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteAdapter } from '@/db/pglite-adapter';

describe('PgliteAdapter', () => {
  let adapter: PgliteAdapter;

  beforeEach(async () => {
    adapter = new PgliteAdapter(new PGlite());
    await adapter.execute(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)',
    );
  });

  it('rewrites ? placeholders to $N for postgres', async () => {
    await adapter.execute('INSERT INTO t (id, name, age) VALUES (?, ?, ?)',
      [1, 'a', 30]);
    const rows = await adapter.query<{ id: number; name: string; age: number }>(
      'SELECT * FROM t WHERE name = ? AND age >= ?', ['a', 18]);
    expect(rows).toEqual([{ id: 1, name: 'a', age: 30 }]);
  });

  it('lists table names', async () => {
    const names = await adapter.getTableNames();
    expect(names).toContain('t');
  });

  it('reads column info', async () => {
    const cols = await adapter.getColumnInfo('t');
    expect(cols.map((c) => c.name).sort()).toEqual(['age', 'id', 'name']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db/pglite-adapter.test.ts`
Expected: FAIL — `Cannot find module '@/db/pglite-adapter'`.

**Step 3: Write minimal implementation**

```ts
// src/db/pglite-adapter.ts
import type { PGlite } from '@electric-sql/pglite';
import { DatabaseAdapter, type ColumnInfo } from './adapter';

export class PgliteAdapter extends DatabaseAdapter {
  constructor(private pg: PGlite) {
    super();
  }

  private rewrite(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.pg.query(this.rewrite(sql), params as never[]);
  }

  async query<T = Record<string, unknown>>(
    sql: string, params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pg.query<T>(this.rewrite(sql), params as never[]);
    return result.rows;
  }

  async getTableNames(): Promise<string[]> {
    const result = await this.pg.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return result.rows.map((r) => r.table_name);
  }

  async getColumnInfo(table: string): Promise<ColumnInfo[]> {
    const result = await this.pg.query<{
      column_name: string; data_type: string;
      is_nullable: string; column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    );
    return result.rows.map((r) => ({
      name: r.column_name,
      type: r.data_type,
      notNull: r.is_nullable === 'NO',
      defaultValue: r.column_default,
    }));
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/db/pglite-adapter.test.ts`
Expected: PASS — 3 tests.

**Step 5: Commit**

```bash
git add src/db/pglite-adapter.ts tests/unit/db/pglite-adapter.test.ts
git commit -m "feat(db): add PgliteAdapter for in-process postgres testing"
```

---

### Task 3: Add `cached_partograph_observations` table definition

**Files:**
- Create: `src/db/tables/cached-partograph-observations.ts`
- Modify: `src/db/tables/index.ts`
- Test: `tests/unit/db/cached-partograph-observations.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/db/cached-partograph-observations.test.ts
import { describe, it, expect } from 'vitest';
import { cachedPartographObservationsTable }
  from '@/db/tables/cached-partograph-observations';

describe('cachedPartographObservationsTable', () => {
  it('is named cached_partograph_observations', () => {
    expect(cachedPartographObservationsTable.name)
      .toBe('cached_partograph_observations');
  });

  it('has a unique index on (hospital_id, source_system, source_pk)', () => {
    const idx = cachedPartographObservationsTable.indexes!
      .find((i) => i.name === 'uniq_cpo_source');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(true);
    expect(idx!.columns).toEqual(['hospital_id', 'source_system', 'source_pk']);
  });

  it('has a non-unique index on (patient_id, observe_datetime)', () => {
    const idx = cachedPartographObservationsTable.indexes!
      .find((i) => i.name === 'idx_cpo_patient');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(false);
  });

  it('has all 22 WHO clinical fields plus audit columns', () => {
    const fieldNames = cachedPartographObservationsTable.fields
      .map((f) => f.name);
    const required = [
      'id', 'patient_id', 'hospital_id', 'source_system', 'source_pk',
      'observe_datetime', 'hour_no',
      'fetal_heart_rate', 'amniotic_fluid', 'amniotic_type_id',
      'amniotic_type_name', 'moulding',
      'cervical_dilation_cm', 'descent_of_head',
      'contraction_per_10min', 'contraction_duration_sec', 'contraction_strength',
      'oxytocin_uml', 'oxytocin_drops_min', 'drugs_iv_fluids',
      'pulse', 'bp_systolic', 'bp_diastolic', 'temperature',
      'urine_volume_ml', 'urine_protein', 'urine_glucose', 'urine_acetone',
      'note', 'entry_staff', 'entry_datetime',
      'synced_at', 'created_at', 'updated_at',
    ];
    for (const f of required) expect(fieldNames).toContain(f);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db/cached-partograph-observations.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```ts
// src/db/tables/cached-partograph-observations.ts
import type { TableDefinition } from '../table-definition';

export const cachedPartographObservationsTable: TableDefinition = {
  name: 'cached_partograph_observations',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'patient_id', type: 'uuid',
      references: { table: 'cached_patients', column: 'id' } },
    { name: 'hospital_id', type: 'uuid',
      references: { table: 'hospitals', column: 'id' } },

    { name: 'source_system', type: 'string', maxLength: 16 },
    { name: 'source_pk', type: 'string', maxLength: 64 },

    { name: 'observe_datetime', type: 'datetime' },
    { name: 'hour_no', type: 'integer', nullable: true },

    { name: 'fetal_heart_rate', type: 'integer', nullable: true },
    { name: 'amniotic_fluid', type: 'string', maxLength: 20, nullable: true },
    { name: 'amniotic_type_id', type: 'integer', nullable: true },
    { name: 'amniotic_type_name', type: 'string', maxLength: 250, nullable: true },
    { name: 'moulding', type: 'string', maxLength: 10, nullable: true },

    { name: 'cervical_dilation_cm', type: 'decimal', nullable: true },
    { name: 'descent_of_head', type: 'string', maxLength: 10, nullable: true },

    { name: 'contraction_per_10min', type: 'integer', nullable: true },
    { name: 'contraction_duration_sec', type: 'integer', nullable: true },
    { name: 'contraction_strength', type: 'string', maxLength: 10, nullable: true },

    { name: 'oxytocin_uml', type: 'decimal', nullable: true },
    { name: 'oxytocin_drops_min', type: 'integer', nullable: true },
    { name: 'drugs_iv_fluids', type: 'string', maxLength: 250, nullable: true },

    { name: 'pulse', type: 'integer', nullable: true },
    { name: 'bp_systolic', type: 'integer', nullable: true },
    { name: 'bp_diastolic', type: 'integer', nullable: true },
    { name: 'temperature', type: 'decimal', nullable: true },

    { name: 'urine_volume_ml', type: 'integer', nullable: true },
    { name: 'urine_protein', type: 'string', maxLength: 10, nullable: true },
    { name: 'urine_glucose', type: 'string', maxLength: 10, nullable: true },
    { name: 'urine_acetone', type: 'string', maxLength: 10, nullable: true },

    { name: 'note', type: 'string', maxLength: 3000, nullable: true },
    { name: 'entry_staff', type: 'string', maxLength: 25, nullable: true },
    { name: 'entry_datetime', type: 'datetime', nullable: true },

    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'uniq_cpo_source',
      columns: ['hospital_id', 'source_system', 'source_pk'], unique: true },
    { name: 'idx_cpo_patient',
      columns: ['patient_id', 'observe_datetime'], unique: false },
  ],
};
```

**Step 4: Wire into ALL_TABLES**

Edit `src/db/tables/index.ts`:

- Add `import { cachedPartographObservationsTable } from './cached-partograph-observations';` near the other imports.
- Add `cachedPartographObservationsTable` to the `export { … }` block.
- Add `cachedPartographObservationsTable` to `ALL_TABLES` **after** `cachedPatientsTable` (foreign-key order).

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/db/cached-partograph-observations.test.ts`
Expected: PASS — 4 tests.

**Step 6: Commit**

```bash
git add src/db/tables/cached-partograph-observations.ts \
        src/db/tables/index.ts \
        tests/unit/db/cached-partograph-observations.test.ts
git commit -m "feat(db): add cached_partograph_observations table definition"
```

---

### Task 4: Add `partograph_severity` + `partograph_alert_count` columns to `cached_patients`

**Files:**
- Modify: `src/db/tables/cached-patients.ts`
- Test: `tests/unit/db/cached-patients-partograph-cols.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/db/cached-patients-partograph-cols.test.ts
import { describe, it, expect } from 'vitest';
import { cachedPatientsTable } from '@/db/tables/cached-patients';

describe('cached_patients — partograph columns', () => {
  it('has partograph_severity (nullable string)', () => {
    const col = cachedPatientsTable.fields.find(
      (f) => f.name === 'partograph_severity');
    expect(col).toBeDefined();
    expect(col!.type).toBe('string');
    expect(col!.nullable).toBe(true);
  });

  it('has partograph_alert_count (nullable integer)', () => {
    const col = cachedPatientsTable.fields.find(
      (f) => f.name === 'partograph_alert_count');
    expect(col).toBeDefined();
    expect(col!.type).toBe('integer');
    expect(col!.nullable).toBe(true);
  });
});
```

**Step 2: Run to verify fail.**

Run: `npx vitest run tests/unit/db/cached-patients-partograph-cols.test.ts`
Expected: FAIL — `expect(col).toBeDefined()` fails.

**Step 3: Add the columns**

In `src/db/tables/cached-patients.ts`, add to the `fields` array (anywhere, I suggest just before `synced_at`):

```ts
{ name: 'partograph_severity',     type: 'string',  maxLength: 10, nullable: true },
{ name: 'partograph_alert_count',  type: 'integer', nullable: true },
```

**Step 4: Run to verify pass.**

Run: `npx vitest run tests/unit/db/cached-patients-partograph-cols.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/db/tables/cached-patients.ts \
        tests/unit/db/cached-patients-partograph-cols.test.ts
git commit -m "feat(db): cache rolled-up partograph severity per patient"
```

---

### Task 5: pglite test harness

**Files:**
- Create: `tests/helpers/createPgliteDb.ts`
- Test: `tests/integration/pglite-harness.test.ts`

**Step 1: Write the failing test**

```ts
// tests/integration/pglite-harness.test.ts
import { describe, it, expect } from 'vitest';
import { createPgliteDb } from '../helpers/createPgliteDb';

describe('createPgliteDb', () => {
  it('creates an in-memory pglite db with all production tables', async () => {
    const db = await createPgliteDb();
    const tables = await db.getTableNames();
    expect(tables).toContain('hospitals');
    expect(tables).toContain('cached_patients');
    expect(tables).toContain('cached_partograph_observations');
    await db.close();
  });

  it('uses ? placeholder rewrite end-to-end', async () => {
    const db = await createPgliteDb();
    await db.execute(
      'INSERT INTO hospitals (id, hcode, name, level, created_at) VALUES (?, ?, ?, ?, ?)',
      ['h-1', '10670', 'Test', 'M2', new Date().toISOString()],
    );
    const rows = await db.query('SELECT hcode FROM hospitals WHERE id = ?', ['h-1']);
    expect(rows).toHaveLength(1);
    await db.close();
  });
});
```

**Step 2: Run to verify fail.**

Run: `npx vitest run tests/integration/pglite-harness.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the harness**

```ts
// tests/helpers/createPgliteDb.ts
import { PGlite } from '@electric-sql/pglite';
import { PgliteAdapter } from '@/db/pglite-adapter';
import { syncSchema } from '@/db/schema-sync';

export async function createPgliteDb(): Promise<PgliteAdapter> {
  const adapter = new PgliteAdapter(new PGlite());
  await syncSchema(adapter, 'postgresql');
  return adapter;
}
```

**Step 4: Run to verify pass.**

Run: `npx vitest run tests/integration/pglite-harness.test.ts`
Expected: PASS — 2 tests.

If `syncSchema` does not accept a dialect argument, inspect `src/db/schema-sync.ts` — pass whatever its existing dialect-selection signature requires (likely a flag or no-op since it inspects the adapter). Adjust the harness to match production usage. Do not introduce a parallel code path.

**Step 5: Commit**

```bash
git add tests/helpers/createPgliteDb.ts tests/integration/pglite-harness.test.ts
git commit -m "test: add pglite harness for postgres-dialect integration tests"
```

---

## Phase 2 — CDSS Rule Engine (Pascal → TypeScript port)

### Task 6: Add CDSS types + `PartographObservation` shape

**Files:**
- Modify: `src/types/api.ts`
- Test: `tests/unit/services/partogram-cdss-types.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/services/partogram-cdss-types.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type {
  CdssSeverity, CdssSection, CdssAlertDto, PartographObservationDto,
} from '@/types/api';

describe('partogram CDSS types', () => {
  it('CdssSeverity is the four documented levels', () => {
    expectTypeOf<CdssSeverity>().toEqualTypeOf<'INFO' | 'WARN' | 'ALERT' | 'CRITICAL'>();
  });

  it('CdssSection covers all 12 documented sections', () => {
    expectTypeOf<CdssSection>().toEqualTypeOf<
      'FHR' | 'LIQUOR' | 'MOULDING' | 'CERVIX' | 'DESCENT'
      | 'CONTRACTIONS' | 'OXY' | 'PULSE' | 'BP' | 'TEMP' | 'URINE' | 'TIME'
    >();
  });

  it('PartographObservationDto has the 22 WHO clinical fields', () => {
    type Required = keyof PartographObservationDto;
    expectTypeOf<'fetalHeartRate'>().toMatchTypeOf<Required>();
    expectTypeOf<'cervicalDilationCm'>().toMatchTypeOf<Required>();
    expectTypeOf<'urineProtein'>().toMatchTypeOf<Required>();
    expectTypeOf<'amnioticTypeName'>().toMatchTypeOf<Required>();
  });
});
```

**Step 2: Run to verify fail.**

Run: `npx vitest run tests/unit/services/partogram-cdss-types.test.ts`
Expected: FAIL — types not exported.

**Step 3: Add the types**

In `src/types/api.ts`, add (after the existing `PartogramEntry`/`PartogramResponse`):

```ts
export type CdssSeverity = 'INFO' | 'WARN' | 'ALERT' | 'CRITICAL';
export type CdssSection =
  | 'FHR' | 'LIQUOR' | 'MOULDING' | 'CERVIX' | 'DESCENT'
  | 'CONTRACTIONS' | 'OXY' | 'PULSE' | 'BP' | 'TEMP' | 'URINE' | 'TIME';

export interface CdssAlertDto {
  severity: CdssSeverity;
  section:  CdssSection;
  message:  string;            // Thai
  obsIndex: number;            // -1 = cross-cutting/trend rule
}

export interface PartographObservationDto {
  id: string;
  observeDatetime: string;
  hourNo: number | null;
  fetalHeartRate: number | null;
  amnioticFluid: string | null;
  amnioticTypeName: string | null;
  moulding: string | null;
  cervicalDilationCm: number | null;
  descentOfHead: string | null;
  contractionPer10Min: number | null;
  contractionDurationSec: number | null;
  contractionStrength: string | null;
  oxytocinUml: number | null;
  oxytocinDropsMin: number | null;
  drugsIvFluids: string | null;
  pulse: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  temperature: number | null;
  urineVolumeMl: number | null;
  urineProtein: string | null;
  urineGlucose: string | null;
  urineAcetone: string | null;
  note: string | null;
  entryStaff: string | null;
}

export interface SsePartographSeverityChangedEvent {
  type: 'partograph_severity_changed';
  hcode: string;
  an: string;
  severity: CdssSeverity | null;
  alertCount: number;
}
```

(Do NOT extend `PartogramResponse` or `PatientListItem` yet — that's Task 17.)

**Step 4: Run to verify pass.**

Run: `npx vitest run tests/unit/services/partogram-cdss-types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/types/api.ts tests/unit/services/partogram-cdss-types.test.ts
git commit -m "feat(types): add CDSS alert + partograph observation DTOs"
```

---

### Task 7: Skeleton `analyzePartograph()` + `highestSeverity` + `countBySeverity`

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-helpers.test.ts`

The 7 analyzer functions stay no-op until their dedicated tasks (8–14). This skeleton is what the orchestrator wires together.

**Step 1: Write the failing test**

```ts
// tests/unit/services/partogram-cdss-helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  analyzePartograph, highestSeverity, countBySeverity,
} from '@/services/partogram';
import type { CdssAlertDto, PartographObservationDto } from '@/types/api';

const blankObs: PartographObservationDto = {
  id: 'o-1', observeDatetime: '2026-04-19T10:00:00Z', hourNo: 1,
  fetalHeartRate: null, amnioticFluid: null, amnioticTypeName: null,
  moulding: null, cervicalDilationCm: null, descentOfHead: null,
  contractionPer10Min: null, contractionDurationSec: null,
  contractionStrength: null, oxytocinUml: null, oxytocinDropsMin: null,
  drugsIvFluids: null, pulse: null, bpSystolic: null, bpDiastolic: null,
  temperature: null, urineVolumeMl: null, urineProtein: null,
  urineGlucose: null, urineAcetone: null, note: null, entryStaff: null,
};

describe('analyzePartograph orchestrator', () => {
  it('returns [] for empty observations', () => {
    expect(analyzePartograph({ an: 'A' }, [])).toEqual([]);
  });

  it('returns [] when nothing is abnormal', () => {
    expect(analyzePartograph({ an: 'A' }, [blankObs])).toEqual([]);
  });
});

describe('highestSeverity', () => {
  const a = (s: CdssAlertDto['severity']): CdssAlertDto =>
    ({ severity: s, section: 'FHR', message: 'x', obsIndex: 0 });
  it('returns null on empty', () => {
    expect(highestSeverity([])).toBeNull();
  });
  it('returns CRITICAL when present', () => {
    expect(highestSeverity([a('WARN'), a('CRITICAL'), a('INFO')]))
      .toBe('CRITICAL');
  });
  it('orders WARN > INFO', () => {
    expect(highestSeverity([a('INFO'), a('WARN')])).toBe('WARN');
  });
});

describe('countBySeverity', () => {
  it('counts each level', () => {
    const a = (s: CdssAlertDto['severity']): CdssAlertDto =>
      ({ severity: s, section: 'FHR', message: 'x', obsIndex: 0 });
    const list = [a('WARN'), a('WARN'), a('CRITICAL')];
    expect(countBySeverity(list, 'WARN')).toBe(2);
    expect(countBySeverity(list, 'CRITICAL')).toBe(1);
    expect(countBySeverity(list, 'INFO')).toBe(0);
  });
});
```

**Step 2: Run to verify fail.**

Run: `npx vitest run tests/unit/services/partogram-cdss-helpers.test.ts`
Expected: FAIL — exports missing.

**Step 3: Implement the skeleton**

Append to `src/services/partogram.ts`:

```ts
import type {
  CdssSeverity, CdssAlertDto, PartographObservationDto,
} from '@/types/api';

const SEVERITY_RANK: Record<CdssSeverity, number> = {
  INFO: 0, WARN: 1, ALERT: 2, CRITICAL: 3,
};

export interface PartographHeader {
  an: string;
  hn?: string;
  patientName?: string;
  gpal?: string;
  age?: string;
  admitAt?: string;
}

export function highestSeverity(alerts: CdssAlertDto[]): CdssSeverity | null {
  if (alerts.length === 0) return null;
  let best: CdssSeverity = 'INFO';
  for (const a of alerts)
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[best]) best = a.severity;
  return best;
}

export function countBySeverity(
  alerts: CdssAlertDto[], s: CdssSeverity,
): number {
  return alerts.filter((a) => a.severity === s).length;
}

// Each analyzer is a small pure function. They are filled in by
// dedicated tasks (8–14). Until then they return [].
function analyzeFhr(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }
function analyzeLiquorMoulding(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }
function analyzeCervix(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }
function analyzeContractions(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }
function analyzeMaternal(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }
function analyzeUrine(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }
function analyzeTimeGaps(_obs: PartographObservationDto[]): CdssAlertDto[] { return []; }

export function analyzePartograph(
  _header: PartographHeader,
  observations: PartographObservationDto[],
): CdssAlertDto[] {
  if (observations.length === 0) return [];
  return [
    ...analyzeFhr(observations),
    ...analyzeLiquorMoulding(observations),
    ...analyzeCervix(observations),
    ...analyzeContractions(observations),
    ...analyzeMaternal(observations),
    ...analyzeUrine(observations),
    ...analyzeTimeGaps(observations),
  ];
}

// Internal exports for per-analyzer tests (Tasks 8–14)
export const _internals = {
  analyzeFhr, analyzeLiquorMoulding, analyzeCervix, analyzeContractions,
  analyzeMaternal, analyzeUrine, analyzeTimeGaps,
};
```

**Step 4: Run to verify pass.**

Run: `npx vitest run tests/unit/services/partogram-cdss-helpers.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/partogram.ts tests/unit/services/partogram-cdss-helpers.test.ts
git commit -m "feat(partogram): scaffold CDSS analyzePartograph + helpers"
```

---

### Task 8: Implement `analyzeFhr` (rules 1–4)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-fhr.test.ts`

Reference Pascal source: `PartographCDSSUnit.pas:200–226`.

**Step 1: Write the failing tests** (threshold sweep — `(t-1, t, t+1)` for each rule)

```ts
// tests/unit/services/partogram-cdss-fhr.test.ts
import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import type { PartographObservationDto } from '@/types/api';

const obs = (i: number, fhr: number | null,
             dt = `2026-04-19T1${i}:00:00Z`): PartographObservationDto => ({
  id: `o-${i}`, observeDatetime: dt, hourNo: i, fetalHeartRate: fhr,
  amnioticFluid: null, amnioticTypeName: null, moulding: null,
  cervicalDilationCm: null, descentOfHead: null,
  contractionPer10Min: null, contractionDurationSec: null,
  contractionStrength: null, oxytocinUml: null, oxytocinDropsMin: null,
  drugsIvFluids: null, pulse: null, bpSystolic: null, bpDiastolic: null,
  temperature: null, urineVolumeMl: null, urineProtein: null,
  urineGlucose: null, urineAcetone: null, note: null, entryStaff: null,
});

describe('analyzeFhr — rule 1 (CRITICAL: <100 or >180)', () => {
  it('FHR 99 → CRITICAL', () => {
    const r = _internals.analyzeFhr([obs(0, 99)]);
    expect(r.find((a) => a.severity === 'CRITICAL')).toBeDefined();
  });
  it('FHR 100 → not CRITICAL (it is ALERT by rule 2)', () => {
    const r = _internals.analyzeFhr([obs(0, 100)]);
    expect(r.every((a) => a.severity !== 'CRITICAL')).toBe(true);
  });
  it('FHR 181 → CRITICAL', () => {
    const r = _internals.analyzeFhr([obs(0, 181)]);
    expect(r.some((a) => a.severity === 'CRITICAL')).toBe(true);
  });
});

describe('analyzeFhr — rule 2 (ALERT: <110 or >160)', () => {
  it('FHR 109 → ALERT', () => {
    const r = _internals.analyzeFhr([obs(0, 109)]);
    expect(r.some((a) => a.severity === 'ALERT')).toBe(true);
  });
  it('FHR 110 → no alert', () => {
    expect(_internals.analyzeFhr([obs(0, 110)])).toEqual([]);
  });
  it('FHR 160 → no alert', () => {
    expect(_internals.analyzeFhr([obs(0, 160)])).toEqual([]);
  });
  it('FHR 161 → ALERT', () => {
    const r = _internals.analyzeFhr([obs(0, 161)]);
    expect(r.some((a) => a.severity === 'ALERT')).toBe(true);
  });
});

describe('analyzeFhr — rule 3 (CRITICAL: 2 consecutive low <110)', () => {
  it('two readings <110 in a row → CRITICAL on the second', () => {
    const r = _internals.analyzeFhr([obs(0, 105), obs(1, 100)]);
    const crits = r.filter((a) => a.severity === 'CRITICAL');
    // Could be from rule 1 (FHR<100? no, 100 is not <100) — must come from rule 3
    expect(crits.some((a) =>
      a.message.includes('ช้าต่อเนื่อง'))).toBe(true);
  });
  it('one low then a normal → no consecutive-low CRITICAL', () => {
    const r = _internals.analyzeFhr([obs(0, 105), obs(1, 130)]);
    expect(r.every((a) => !a.message.includes('ช้าต่อเนื่อง'))).toBe(true);
  });
});

describe('analyzeFhr — rule 4 (CRITICAL: 2 consecutive high >160)', () => {
  it('two readings >160 in a row → CRITICAL', () => {
    const r = _internals.analyzeFhr([obs(0, 165), obs(1, 170)]);
    expect(r.some((a) => a.message.includes('เร็วต่อเนื่อง'))).toBe(true);
  });
});

describe('analyzeFhr — null FHR is ignored', () => {
  it('null FHR produces no alerts', () => {
    expect(_internals.analyzeFhr([obs(0, null)])).toEqual([]);
  });
});
```

**Step 2: Run to verify fail.**

Run: `npx vitest run tests/unit/services/partogram-cdss-fhr.test.ts`
Expected: FAIL.

**Step 3: Implement `analyzeFhr`**

Replace the no-op `analyzeFhr` in `src/services/partogram.ts`:

```ts
function analyzeFhr(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  let consecLow = 0, consecHigh = 0;

  for (let i = 0; i < obs.length; i++) {
    const fhr = obs[i].fetalHeartRate;
    if (fhr == null || fhr <= 0) {
      consecLow = 0; consecHigh = 0;
      continue;
    }

    // Rule 1: out of safe range
    if (fhr < 100 || fhr > 180) {
      out.push({ severity: 'CRITICAL', section: 'FHR',
        message: `FHR ${fhr} ครั้ง/นาที (ผิดปกติรุนแรง)`, obsIndex: i });
    } else if (fhr < 110 || fhr > 160) {
      // Rule 2: mildly out of range
      out.push({ severity: 'ALERT', section: 'FHR',
        message: `FHR ${fhr} ครั้ง/นาที (นอกช่วง 110-160)`, obsIndex: i });
    }

    // Rules 3 / 4: consecutive bands
    if (fhr < 110) consecLow++; else consecLow = 0;
    if (fhr > 160) consecHigh++; else consecHigh = 0;
    if (consecLow === 2)
      out.push({ severity: 'CRITICAL', section: 'FHR',
        message: 'หัวใจทารกเต้นช้าต่อเนื่อง 2 ครั้ง', obsIndex: i });
    if (consecHigh === 2)
      out.push({ severity: 'CRITICAL', section: 'FHR',
        message: 'หัวใจทารกเต้นเร็วต่อเนื่อง 2 ครั้ง', obsIndex: i });
  }
  return out;
}
```

**Step 4: Run to verify pass.**

Run: `npx vitest run tests/unit/services/partogram-cdss-fhr.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/partogram.ts tests/unit/services/partogram-cdss-fhr.test.ts
git commit -m "feat(partogram): port FHR CDSS rules (1-4) from Pascal"
```

---

### Task 9: Implement `analyzeLiquorMoulding` (rules 5–9)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-liquor-moulding.test.ts`

Reference: `PartographCDSSUnit.pas:228–255`.

**Step 1: Write the failing tests** (case-insensitive substring matching mirrors the Pascal `LowerCase()` + `Pos()`)

```ts
// Skeleton — author every assert listed below.
import { describe, it, expect } from 'vitest';
import { _internals } from '@/services/partogram';
import type { PartographObservationDto } from '@/types/api';

const blank: Omit<PartographObservationDto, 'id' | 'observeDatetime'> = {
  hourNo: 0, fetalHeartRate: null, amnioticFluid: null, amnioticTypeName: null,
  moulding: null, cervicalDilationCm: null, descentOfHead: null,
  contractionPer10Min: null, contractionDurationSec: null,
  contractionStrength: null, oxytocinUml: null, oxytocinDropsMin: null,
  drugsIvFluids: null, pulse: null, bpSystolic: null, bpDiastolic: null,
  temperature: null, urineVolumeMl: null, urineProtein: null,
  urineGlucose: null, urineAcetone: null, note: null, entryStaff: null,
};
const obs = (over: Partial<PartographObservationDto>): PartographObservationDto =>
  ({ id: 'o', observeDatetime: '2026-04-19T10:00:00Z', ...blank, ...over });

// Rule 5 — Thick mec → CRITICAL
//   amniotic 'Thick' → CRITICAL
//   amniotic 'thick mec' → CRITICAL
//   amniotic 'CLEAR' → no alert
// Rule 6 — Mec / moderate / mild → ALERT
//   amniotic 'Meconium' → ALERT
//   amniotic 'Moderate mec' → ALERT
//   amniotic 'Mild stain' → ALERT
// Rule 7 — Blood-stained → ALERT
//   amniotic 'Blood stained' → ALERT (Section LIQUOR)
// Rule 8 — Moulding +++ → CRITICAL
//   moulding '+++' → CRITICAL
// Rule 9 — Moulding ++ → ALERT (must NOT also fire on '+++')
//   moulding '++' → ALERT
//   moulding '+++' → only CRITICAL, not ALERT (because Pascal short-circuits)
//   moulding '+' → no alert
```

Author the test file fully — every bullet above is one `it()` block. Cross-reference against `PartographCDSSUnit.pas:236–254`. Note the Pascal `+++` branch returns BEFORE checking `++`, so your TS code must do the same.

**Step 2: Run to verify fail.**

Run: `npx vitest run tests/unit/services/partogram-cdss-liquor-moulding.test.ts`
Expected: FAIL.

**Step 3: Implement**

```ts
function analyzeLiquorMoulding(obs: PartographObservationDto[]): CdssAlertDto[] {
  const out: CdssAlertDto[] = [];
  for (let i = 0; i < obs.length; i++) {
    const a = (obs[i].amnioticFluid ?? '').toLowerCase();
    if (a.includes('thick')) {
      out.push({ severity: 'CRITICAL', section: 'LIQUOR',
        message: 'น้ำคร่ำขี้เทาข้น', obsIndex: i });
    } else if (a.includes('mec') || a.includes('moder') || a.includes('mild')) {
      out.push({ severity: 'ALERT', section: 'LIQUOR',
        message: 'น้ำคร่ำมีขี้เทา', obsIndex: i });
    } else if (a.includes('blood')) {
      out.push({ severity: 'ALERT', section: 'LIQUOR',
        message: 'น้ำคร่ำปนเลือด', obsIndex: i });
    }

    const m = obs[i].moulding ?? '';
    if (m.includes('+++')) {
      out.push({ severity: 'CRITICAL', section: 'MOULDING',
        message: 'กะโหลกเกยกันรุนแรง (+++)', obsIndex: i });
    } else if (m.includes('++')) {
      out.push({ severity: 'ALERT', section: 'MOULDING',
        message: 'กะโหลกเกยกัน (++)', obsIndex: i });
    }
  }
  return out;
}
```

**Step 4: Run to verify pass.**

Run: `npx vitest run tests/unit/services/partogram-cdss-liquor-moulding.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/partogram.ts \
        tests/unit/services/partogram-cdss-liquor-moulding.test.ts
git commit -m "feat(partogram): port liquor + moulding CDSS rules (5-9)"
```

---

### Task 10: Implement `analyzeCervix` (rules 10–14)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-cervix.test.ts`

Reference: `PartographCDSSUnit.pas:257–353`. The most complex analyzer — covers alert/action lines, latent prolongation, LCG time-per-cm stall, active-phase arrest.

**Step 1: Write the failing tests** — author one `describe` per rule:

- Rule 10 (ALERT, past Alert line — `dilation < expected`)
- Rule 11 (CRITICAL, past Action line — `dilation < expected − 4`)
- Rule 12 (ALERT, latent prolonged — all `<4 cm` spanning `>8 h`)
- Rule 13 (ALERT, LCG stall — `{5:6h, 6:5h, 7:3h, 8:2.5h, 9:2h}`)
- Rule 14 (CRITICAL, active-phase arrest — last 2 obs `≥5 cm`, `Δ<0.5`, span `>2 h`)

Use ISO timestamps spaced realistically (`2026-04-19T08:00:00Z`, `…T11:00:00Z`, etc.) so date arithmetic is unambiguous. Provide one threshold-sweep test per numeric boundary (e.g. for rule 12, span 8.0 h = clean, span 8.1 h = ALERT).

**Step 2: Run to verify fail.**

**Step 3: Implement** — port `AnalyzeCervix` faithfully. Helpers `firstObsDt()`, `firstIndexAtDilation()`, and `lcgTimeThreshold(cm: number): number` are pure functions; place them inside `partogram.ts` (not exported).

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(partogram): port cervix CDSS rules (alert/action/LCG/arrest, 10-14)"
```

---

### Task 11: Implement `analyzeContractions` (rules 15–19)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-contractions.test.ts`

Reference: `PartographCDSSUnit.pas:355–397`.

Cover:

- Rule 15 (`>5/10 min` → ALERT)
- Rule 16 (`≤2/10 min` → ALERT)
- Rule 17 (sustained >5/10 min for `≥30 min` → CRITICAL — needs at least 2 readings spanning ≥30 min)
- Rule 18 (duration `>60 s` → ALERT)
- Rule 19 (duration `<20 s` → ALERT)

Threshold sweep at 5/10 vs 6/10, 2/10 vs 3/10, 60 s vs 61 s, 20 s vs 19 s.

Standard 5-step TDD cycle. Commit:

```bash
git commit -m "feat(partogram): port contractions CDSS rules (15-19)"
```

---

### Task 12: Implement `analyzeMaternal` (rules 20–28 — pulse, BP, temp)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-maternal.test.ts`

Reference: `PartographCDSSUnit.pas:399–451`.

Threshold sweep is mandatory here — 9 rules × 3 boundaries = 27 boundary tests. Group:

- Pulse: 60 / 120 / 140
- SBP: 80 / 140 / 160
- DBP: 90 / 110
- Temp: 35.0 / 37.5 / 38.5

Commit:

```bash
git commit -m "feat(partogram): port maternal CDSS rules (pulse/BP/temp, 20-28)"
```

---

### Task 13: Implement `analyzeUrine` (rules 29–31)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-urine.test.ts`

Reference: `PartographCDSSUnit.pas:453–470`.

Critical edge: `'+'` does NOT match `++`-substring rule (Pascal uses `Pos('++', X)`). Test:

- `urineProtein = '+'` → no alert
- `urineProtein = '++'` → ALERT
- `urineProtein = '+++'` → ALERT (also matches `++`)

Commit:

```bash
git commit -m "feat(partogram): port urine CDSS rules (29-31)"
```

---

### Task 14: Implement `analyzeTimeGaps` (rule 32)

**Files:**
- Modify: `src/services/partogram.ts`
- Test: `tests/unit/services/partogram-cdss-time-gaps.test.ts`

Reference: `PartographCDSSUnit.pas:472–485`.

Cover:

- Two obs 4 h apart at dilation `≥4 cm` → no alert (gap is exactly 4 h, Pascal uses `>`)
- Two obs 4.1 h apart at dilation `≥4 cm` → WARN
- Two obs 6 h apart at dilation `<4 cm` (latent phase) → no alert (rule gates on active phase)

Commit:

```bash
git commit -m "feat(partogram): port observation-gap CDSS rule (32)"
```

---

### Task 15: Pascal-parity smoke test on real HOSxP rows

**Files:**
- Create: `tests/fixtures/partograph-hosxp-sample.json`
- Test: `tests/unit/services/partogram-cdss-parity.test.ts`

The local HOSxP MySQL instance has 2 partograph rows (`ipt_labour_partograph_id` 2 and 3, AN `000055807`). Snapshot them as a JSON fixture and assert the alert set matches what the Pascal renderer would produce for the same input.

**Step 1: Capture the fixture**

Pull the rows via the local MySQL MCP and shape them into `PartographObservationDto` JSON:

```json
[
  {
    "id": "fx-2",
    "observeDatetime": "2026-04-18T13:29:50Z",
    "hourNo": 1,
    "fetalHeartRate": 115,
    "amnioticFluid": "Blood stained",
    "amnioticTypeName": null,
    "moulding": "++",
    "cervicalDilationCm": null,
    "descentOfHead": null,
    "contractionPer10Min": null,
    "contractionDurationSec": null,
    "contractionStrength": null,
    "oxytocinUml": null,
    "oxytocinDropsMin": null,
    "drugsIvFluids": null,
    "pulse": 65,
    "bpSystolic": 120,
    "bpDiastolic": 75,
    "temperature": 37.4,
    "urineVolumeMl": null,
    "urineProtein": null,
    "urineGlucose": null,
    "urineAcetone": null,
    "note": null,
    "entryStaff": "bms"
  },
  {
    "id": "fx-3",
    "observeDatetime": "2026-04-18T14:28:50Z",
    "hourNo": 2,
    "fetalHeartRate": 125,
    "amnioticFluid": "Clear",
    "amnioticTypeName": null,
    "moulding": "+",
    "cervicalDilationCm": null,
    "descentOfHead": null,
    "contractionPer10Min": null,
    "contractionDurationSec": null,
    "contractionStrength": null,
    "oxytocinUml": null,
    "oxytocinDropsMin": null,
    "drugsIvFluids": null,
    "pulse": 75,
    "bpSystolic": 124,
    "bpDiastolic": 85,
    "temperature": 37.8,
    "urineVolumeMl": null,
    "urineProtein": null,
    "urineGlucose": null,
    "urineAcetone": null,
    "note": null,
    "entryStaff": "bms"
  }
]
```

**Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import fixture from '../../fixtures/partograph-hosxp-sample.json';
import { analyzePartograph } from '@/services/partogram';
import type { PartographObservationDto, CdssAlertDto } from '@/types/api';

describe('partograph CDSS parity — local HOSxP rows', () => {
  const obs = fixture as PartographObservationDto[];
  const alerts: CdssAlertDto[] = analyzePartograph({ an: '000055807' }, obs);

  it('flags row 1 amniotic blood-stained as ALERT', () => {
    expect(alerts.some((a) =>
      a.section === 'LIQUOR' && a.severity === 'ALERT' && a.obsIndex === 0,
    )).toBe(true);
  });

  it('flags row 1 moulding ++ as ALERT', () => {
    expect(alerts.some((a) =>
      a.section === 'MOULDING' && a.severity === 'ALERT' && a.obsIndex === 0,
    )).toBe(true);
  });

  it('flags row 2 temperature 37.8 as ALERT', () => {
    expect(alerts.some((a) =>
      a.section === 'TEMP' && a.severity === 'ALERT' && a.obsIndex === 1,
    )).toBe(true);
  });

  it('does NOT flag normal pulse 65/75 or BP 120/75 + 124/85', () => {
    expect(alerts.every((a) =>
      a.section !== 'PULSE' && a.section !== 'BP',
    )).toBe(true);
  });

  it('does NOT flag normal FHR 115/125', () => {
    expect(alerts.every((a) => a.section !== 'FHR')).toBe(true);
  });

  it('total alert count is 3 (LIQUOR row 1 + MOULDING row 1 + TEMP row 2)', () => {
    expect(alerts).toHaveLength(3);
  });
});
```

**Step 3: Run.**

Run: `npx vitest run tests/unit/services/partogram-cdss-parity.test.ts`
Expected: PASS (all rules already implemented). If anything fails, investigate the specific rule — do NOT update the fixture to make the test pass.

**Step 4: Commit**

```bash
git add tests/fixtures/partograph-hosxp-sample.json \
        tests/unit/services/partogram-cdss-parity.test.ts
git commit -m "test(partogram): pascal-parity smoke test on real HOSxP rows"
```

---

## Phase 3 — Sync Handler (HOSxP polling path)

### Task 16: Add `PARTOGRAPH_OBSERVATIONS` SQL template

**Files:**
- Modify: `src/config/hosxp-queries.ts`
- Test: `tests/unit/config/hosxp-queries-partograph.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/config/hosxp-queries-partograph.test.ts
import { describe, it, expect } from 'vitest';
import { PARTOGRAPH_OBSERVATIONS, getQuery } from '@/config/hosxp-queries';

describe('PARTOGRAPH_OBSERVATIONS', () => {
  it('exists for both dialects', () => {
    expect(PARTOGRAPH_OBSERVATIONS.postgresql).toMatch(/ipt_labour_partograph/);
    expect(PARTOGRAPH_OBSERVATIONS.mysql).toMatch(/ipt_labour_partograph/);
  });

  it('joins labour_amniotic_type for the human-readable label', () => {
    expect(PARTOGRAPH_OBSERVATIONS.postgresql).toMatch(/labour_amniotic_type/);
    expect(PARTOGRAPH_OBSERVATIONS.mysql).toMatch(/labour_amniotic_type/);
  });

  it('filters to currently-admitted patients', () => {
    expect(getQuery(PARTOGRAPH_OBSERVATIONS, 'postgresql'))
      .toMatch(/dchdate IS NULL/);
    expect(getQuery(PARTOGRAPH_OBSERVATIONS, 'mysql'))
      .toMatch(/dchdate IS NULL/);
  });

  it('orders by AN then observe_datetime', () => {
    expect(PARTOGRAPH_OBSERVATIONS.postgresql)
      .toMatch(/ORDER BY lp\.an, lp\.observe_datetime/);
  });
});
```

**Step 2: Run to verify fail.**

**Step 3: Add the template** — copy from design doc Section 3a verbatim into `src/config/hosxp-queries.ts`.

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(hosxp): add PARTOGRAPH_OBSERVATIONS dual-dialect query"
```

---

### Task 17: Implement `upsertPartographObservations()` + `rollUpSeverityForPatient()`

**Files:**
- Create: `src/services/sync/partograph.ts`
- Test: `tests/unit/services/sync-partograph-upsert.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/services/sync-partograph-upsert.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { syncSchema } from '@/db/schema-sync';
import {
  upsertPartographObservations, type PartographRow,
} from '@/services/sync/partograph';

let db: SqliteAdapter;
const HOSPITAL_ID = 'h-1';
const PATIENT_ID = 'p-1';

beforeEach(async () => {
  db = new SqliteAdapter(':memory:');
  await syncSchema(db);
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    [HOSPITAL_ID, '10670', 'Test', 'M2', new Date().toISOString()],
  );
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date,
        labor_status, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [PATIENT_ID, HOSPITAL_ID, 'HN1', 'AN1', 'enc-name', 25,
     '2026-04-18T08:00:00Z',
     '2026-04-18T08:00:00Z', '2026-04-18T08:00:00Z', '2026-04-18T08:00:00Z'],
  );
});

const mkRow = (over: Partial<PartographRow>): PartographRow => ({
  hospitalId: HOSPITAL_ID, patientId: PATIENT_ID,
  sourceSystem: 'hosxp', sourcePk: '1',
  observeDatetime: '2026-04-18T10:00:00Z',
  hourNo: 1,
  fetalHeartRate: 130, amnioticFluid: 'Clear', amnioticTypeId: null,
  amnioticTypeName: null, moulding: null,
  cervicalDilationCm: null, descentOfHead: null,
  contractionPer10Min: null, contractionDurationSec: null,
  contractionStrength: null, oxytocinUml: null, oxytocinDropsMin: null,
  drugsIvFluids: null,
  pulse: null, bpSystolic: null, bpDiastolic: null, temperature: null,
  urineVolumeMl: null, urineProtein: null, urineGlucose: null,
  urineAcetone: null,
  note: null, entryStaff: null, entryDatetime: null,
  ...over,
});

describe('upsertPartographObservations', () => {
  it('inserts new rows', async () => {
    const r = await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({})]);
    expect(r.upserted).toBe(1);
    const stored = await db.query(
      'SELECT id, source_pk FROM cached_partograph_observations');
    expect(stored).toHaveLength(1);
  });

  it('UPSERTs on (hospital_id, source_system, source_pk) collision', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({ fetalHeartRate: 130 })]);
    await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({ fetalHeartRate: 145 })]);  // same source_pk
    const stored = await db.query<{ fetal_heart_rate: number }>(
      'SELECT fetal_heart_rate FROM cached_partograph_observations');
    expect(stored).toHaveLength(1);
    expect(stored[0].fetal_heart_rate).toBe(145);
  });

  it('rolls up severity to cached_patients', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({ moulding: '++' })]);  // ALERT
    const p = await db.query<{
      partograph_severity: string | null;
      partograph_alert_count: number | null;
    }>('SELECT partograph_severity, partograph_alert_count ' +
       'FROM cached_patients WHERE id = ?', [PATIENT_ID]);
    expect(p[0].partograph_severity).toBe('ALERT');
    expect(p[0].partograph_alert_count).toBeGreaterThan(0);
  });

  it('reports severity changes', async () => {
    const r = await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({ moulding: '+++' })]);
    expect(r.severityChanges).toEqual([
      { patientId: PATIENT_ID, an: 'AN1',
        from: null, to: 'CRITICAL', alertCount: expect.any(Number) },
    ]);
  });

  it('does not report severity change when severity stays the same', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({ sourcePk: '1', moulding: '++' })]);
    const r = await upsertPartographObservations(db, HOSPITAL_ID,
      [mkRow({ sourcePk: '2', moulding: '++',
               observeDatetime: '2026-04-18T11:00:00Z' })]);
    expect(r.severityChanges).toEqual([]);
  });

  it('handles delete action by removing the row', async () => {
    await upsertPartographObservations(db, HOSPITAL_ID, [mkRow({})]);
    const r = await upsertPartographObservations(db, HOSPITAL_ID,
      [{ ...mkRow({}), action: 'delete' }]);
    expect(r.deleted).toBe(1);
    const stored = await db.query(
      'SELECT id FROM cached_partograph_observations');
    expect(stored).toHaveLength(0);
  });
});
```

**Step 2: Run to verify fail.**

**Step 3: Implement** the handler at `src/services/sync/partograph.ts` with:

- `PartographRow` interface (see test for shape; add `action?: 'upsert' | 'delete'`).
- `upsertPartographObservations()` returning `{ upserted, deleted, severityChanges: SeverityChange[] }`.
- Internal helper `rollUpSeverityForPatient(db, hospitalId, patientId)` — queries existing observations for that patient, runs `analyzePartograph()`, writes `partograph_severity` + `partograph_alert_count`, returns `{ before, after, alertCount }`.

For UPSERT in SQLite use `INSERT OR REPLACE INTO … (id, …) VALUES (...)` with the `id` looked up via the unique key (or use `ON CONFLICT(hospital_id, source_system, source_pk) DO UPDATE`). For Postgres use `ON CONFLICT … DO UPDATE`. Pass the SQL through the existing `?`-placeholder convention so both adapters handle it.

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(sync): partograph upsert + severity roll-up handler"
```

---

### Task 18: Wire `pollHospital()` to fetch and persist partograph rows

**Files:**
- Modify: `src/services/sync/polling.ts`
- Test: extend `tests/integration/sync-pipeline.test.ts` (or create a new one if isolating)

**Step 1: Write the failing test** — add a `describe('partograph sync', …)` block that:

1. Stubs `BmsSessionClient.executeQuery` to return one mock partograph row when given the `PARTOGRAPH_OBSERVATIONS` SQL.
2. Runs `pollHospital()`.
3. Asserts a row landed in `cached_partograph_observations`.
4. Asserts `cached_patients.partograph_severity` reflects the rule outcome.

**Step 2: Run to verify fail.**

**Step 3: Modify `pollHospital()`**

After the existing `ACTIVE_LABOR_PATIENTS` block (and AFTER `upsertCachedPatients`, so the patient_id resolution works), add:

```ts
const partographSql = getQuery(PARTOGRAPH_OBSERVATIONS, databaseType);
const partographResult = await client.executeQuery(partographSql, bmsUrl, jwt);

if (partographResult.data.length > 0) {
  // Resolve AN → patient_id once for the batch
  const ans = Array.from(new Set(partographResult.data.map((r) => String(r.an))));
  const placeholders = ans.map(() => '?').join(',');
  const patientRows = await db.query<{ id: string; an: string }>(
    `SELECT id, an FROM cached_patients
       WHERE hospital_id = ? AND an IN (${placeholders})`,
    [hospitalId, ...ans],
  );
  const patientByAn = new Map(patientRows.map((p) => [p.an, p.id]));

  const rows: PartographRow[] = partographResult.data
    .map((row) => {
      const pid = patientByAn.get(String(row.an));
      if (!pid) return null;
      return {
        hospitalId, patientId: pid,
        sourceSystem: 'hosxp',
        sourcePk: String(row.ipt_labour_partograph_id),
        observeDatetime: String(row.observe_datetime),
        hourNo: row.hour_no != null ? Number(row.hour_no) : null,
        fetalHeartRate: row.fetal_heart_rate != null ? Number(row.fetal_heart_rate) : null,
        amnioticFluid: row.amniotic_fluid as string | null,
        amnioticTypeId: row.labour_amniotic_type_id != null
          ? Number(row.labour_amniotic_type_id) : null,
        amnioticTypeName: row.amniotic_type_name as string | null,
        moulding: row.moulding as string | null,
        cervicalDilationCm: row.cervical_dilation_cm != null
          ? Number(row.cervical_dilation_cm) : null,
        descentOfHead: row.descent_of_head as string | null,
        contractionPer10Min: row.contraction_per_10min != null
          ? Number(row.contraction_per_10min) : null,
        contractionDurationSec: row.contraction_duration_sec != null
          ? Number(row.contraction_duration_sec) : null,
        contractionStrength: row.contraction_strength as string | null,
        oxytocinUml: row.oxytocin_uml != null ? Number(row.oxytocin_uml) : null,
        oxytocinDropsMin: row.oxytocin_drops_min != null
          ? Number(row.oxytocin_drops_min) : null,
        drugsIvFluids: row.drugs_iv_fluids as string | null,
        pulse: row.pulse != null ? Number(row.pulse) : null,
        bpSystolic: row.bp_systolic != null ? Number(row.bp_systolic) : null,
        bpDiastolic: row.bp_diastolic != null ? Number(row.bp_diastolic) : null,
        temperature: row.temperature != null ? Number(row.temperature) : null,
        urineVolumeMl: row.urine_volume_ml != null
          ? Number(row.urine_volume_ml) : null,
        urineProtein: row.urine_protein as string | null,
        urineGlucose: row.urine_glucose as string | null,
        urineAcetone: row.urine_acetone as string | null,
        note: row.note as string | null,
        entryStaff: row.entry_staff as string | null,
        entryDatetime: row.entry_datetime != null
          ? String(row.entry_datetime) : null,
      };
    })
    .filter((r): r is PartographRow => r !== null);

  const result = await upsertPartographObservations(db, hospitalId, rows);

  for (const sc of result.severityChanges) {
    sseManager.broadcast('patient-update', {
      type: 'partograph_severity_changed',
      hcode, an: sc.an, severity: sc.to, alertCount: sc.alertCount,
    });
  }

  logger.info('partograph_sync_complete', {
    hospitalId, observationsUpserted: result.upserted,
    patientsTouched: rows.length,
    severityChanges: result.severityChanges.length,
  });
}
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(sync): pull ipt_labour_partograph each polling cycle"
```

---

## Phase 4 — Webhook Path

### Task 19: Add `WebhookPartographPayload` types + `validatePartographPayload`

**Files:**
- Modify: `src/services/webhook.ts`
- Test: `tests/unit/services/webhook-validator-partograph.test.ts`

**Step 1: Write the failing tests** — author every case below as one `it()`:

- Empty `observations` array → invalid.
- 201 observations → invalid (cap is 200).
- Missing `an` → invalid, error message names the field.
- Missing `externalObservationId` → invalid.
- Missing `observeDatetime` → invalid.
- Garbage `observeDatetime` (`'tomorrow'`) → invalid.
- Action `'delete'` with only `an` + `externalObservationId` → valid.
- Out-of-range `fetalHeartRate: 12` → still **valid** (soft warning, accepted).
- Unknown `contractionStrength: 'epic'` → still valid.
- Happy-path 3-row payload → valid, payload returned.

**Step 2: Run to verify fail.**

**Step 3: Implement** in `src/services/webhook.ts`:

```ts
export interface WebhookPartographObservation {
  an: string;
  externalObservationId: string;
  observeDatetime: string;
  hourNo?: number | null;
  fetalHeartRate?: number | null;
  amnioticFluid?: string | null;
  amnioticTypeId?: number | null;
  moulding?: string | null;
  cervicalDilationCm?: number | null;
  descentOfHead?: string | null;
  contractionPer10Min?: number | null;
  contractionDurationSec?: number | null;
  contractionStrength?: 'mild' | 'moderate' | 'strong' | null;
  oxytocinUml?: number | null;
  oxytocinDropsMin?: number | null;
  drugsIvFluids?: string | null;
  pulse?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  temperature?: number | null;
  urineVolumeMl?: number | null;
  urineProtein?: string | null;
  urineGlucose?: string | null;
  urineAcetone?: string | null;
  note?: string | null;
  entryStaff?: string | null;
  entryDatetime?: string | null;
  action?: 'upsert' | 'delete';
}

export interface WebhookPartographPayload {
  type: 'partograph';
  hospitalCode: string;
  observations: WebhookPartographObservation[];
}

export function validatePartographPayload(body: unknown): {
  valid: boolean;
  error?: string;
  payload?: WebhookPartographPayload;
} {
  if (!body || typeof body !== 'object')
    return { valid: false, error: 'Request body must be a JSON object' };
  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.observations))
    return { valid: false, error: '"observations" must be an array' };
  if (obj.observations.length === 0)
    return { valid: false, error: '"observations" must not be empty' };
  if (obj.observations.length > 200)
    return { valid: false, error: '"observations" must not exceed 200 items per request' };

  const errors: string[] = [];
  for (let i = 0; i < obj.observations.length; i++) {
    const o = obj.observations[i] as Record<string, unknown>;
    if (!o.an || typeof o.an !== 'string')
      errors.push(`observations[${i}].an is required (string)`);
    if (!o.externalObservationId || typeof o.externalObservationId !== 'string')
      errors.push(`observations[${i}].externalObservationId is required (string ≤64)`);
    else if ((o.externalObservationId as string).length > 64)
      errors.push(`observations[${i}].externalObservationId must be ≤64 chars`);

    if (o.action !== 'delete') {
      if (!o.observeDatetime || typeof o.observeDatetime !== 'string')
        errors.push(`observations[${i}].observeDatetime is required (ISO 8601)`);
      else if (Number.isNaN(new Date(o.observeDatetime as string).getTime()))
        errors.push(`observations[${i}].observeDatetime must be a valid ISO 8601`);
    }
  }
  if (errors.length > 0)
    return { valid: false, error: `Validation errors: ${errors.join('; ')}` };

  return { valid: true, payload: obj as unknown as WebhookPartographPayload };
}
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(webhook): partograph payload types + validator"
```

---

### Task 20: Implement `processPartographWebhook()`

**Files:**
- Modify: `src/services/webhook.ts`
- Test: `tests/unit/services/webhook-process-partograph.test.ts`

**Step 1: Write the failing test** — covers:

- Resolves `an` → `patient_id` for the hospital.
- Skips rows for unknown ANs and reports them in `observationsSkipped[]`.
- Calls `upsertPartographObservations()` with the resolved rows.
- Broadcasts `partograph_severity_changed` only for severity changes.
- Updates `hospitals.connection_status = 'ONLINE'` and `last_sync_at`.

**Step 2: Run to verify fail.**

**Step 3: Implement**

```ts
export interface WebhookPartographResult {
  observationsAccepted: number;
  observationsSkipped: { an: string; externalObservationId: string; reason: string }[];
}

export async function processPartographWebhook(
  db: DatabaseAdapter,
  hospitalId: string,
  payload: WebhookPartographPayload,
  sseManager: SseManager,
): Promise<WebhookPartographResult> {
  const hospitalRows = await db.query<{ hcode: string }>(
    'SELECT hcode FROM hospitals WHERE id = ?', [hospitalId]);
  const hcode = hospitalRows[0]?.hcode ?? '';

  const ans = Array.from(new Set(payload.observations.map((o) => o.an)));
  const placeholders = ans.map(() => '?').join(',');
  const patientRows = ans.length
    ? await db.query<{ id: string; an: string }>(
        `SELECT id, an FROM cached_patients
           WHERE hospital_id = ? AND an IN (${placeholders})`,
        [hospitalId, ...ans])
    : [];
  const byAn = new Map(patientRows.map((p) => [p.an, p.id]));

  const skipped: WebhookPartographResult['observationsSkipped'] = [];
  const rows: PartographRow[] = [];
  for (const o of payload.observations) {
    const pid = byAn.get(o.an);
    if (!pid) {
      skipped.push({ an: o.an, externalObservationId: o.externalObservationId,
                     reason: 'patient_not_found' });
      continue;
    }
    rows.push({
      hospitalId, patientId: pid,
      sourceSystem: 'webhook', sourcePk: o.externalObservationId,
      observeDatetime: o.observeDatetime,
      hourNo: o.hourNo ?? null,
      fetalHeartRate: o.fetalHeartRate ?? null,
      amnioticFluid: o.amnioticFluid ?? null,
      amnioticTypeId: o.amnioticTypeId ?? null,
      amnioticTypeName: o.amnioticFluid ?? null,
      moulding: o.moulding ?? null,
      cervicalDilationCm: o.cervicalDilationCm ?? null,
      descentOfHead: o.descentOfHead ?? null,
      contractionPer10Min: o.contractionPer10Min ?? null,
      contractionDurationSec: o.contractionDurationSec ?? null,
      contractionStrength: o.contractionStrength ?? null,
      oxytocinUml: o.oxytocinUml ?? null,
      oxytocinDropsMin: o.oxytocinDropsMin ?? null,
      drugsIvFluids: o.drugsIvFluids ?? null,
      pulse: o.pulse ?? null,
      bpSystolic: o.bpSystolic ?? null,
      bpDiastolic: o.bpDiastolic ?? null,
      temperature: o.temperature ?? null,
      urineVolumeMl: o.urineVolumeMl ?? null,
      urineProtein: o.urineProtein ?? null,
      urineGlucose: o.urineGlucose ?? null,
      urineAcetone: o.urineAcetone ?? null,
      note: o.note ?? null,
      entryStaff: o.entryStaff ?? null,
      entryDatetime: o.entryDatetime ?? null,
      action: o.action,
    });
  }

  const result = await upsertPartographObservations(db, hospitalId, rows);

  for (const sc of result.severityChanges) {
    sseManager.broadcast('patient-update', {
      type: 'partograph_severity_changed',
      hcode, an: sc.an, severity: sc.to, alertCount: sc.alertCount,
    });
  }

  await db.execute(
    "UPDATE hospitals SET connection_status = 'ONLINE', last_sync_at = ? WHERE id = ?",
    [new Date().toISOString(), hospitalId]);

  return {
    observationsAccepted: result.upserted + result.deleted,
    observationsSkipped: skipped,
  };
}
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(webhook): processPartographWebhook handler"
```

---

### Task 21: Wire `type: 'partograph'` branch into webhook route

**Files:**
- Modify: `src/app/api/webhooks/patient-data/route.ts`

**Step 1: Write the failing integration test** — extend `tests/integration/webhook-pipeline.test.ts` with a `describe('partograph webhook', …)` block that POSTs a `type: 'partograph'` payload to the route handler and asserts:

- Returns 200 with `success: true` and `observationsAccepted`.
- Row lands in `cached_partograph_observations`.
- Bad payload (missing `externalObservationId`) returns 400 with `VALIDATION_FAILED`.

**Step 2: Run to verify fail.**

**Step 3: Add the branch** in `route.ts`, after the existing `referral_update` branch and before the default labor-patient handler:

```ts
if (payloadType === 'partograph') {
  const validation = validatePartographPayload(body);
  if (!validation.valid || !validation.payload) {
    return NextResponse.json(
      apiError('VALIDATION_FAILED', validation.error ?? 'unknown validation error'),
      { status: 400 });
  }
  const result = await processPartographWebhook(
    db, keyInfo.hospitalId, validation.payload, sseManager);
  return NextResponse.json({
    success: true, ...result, timestamp: new Date().toISOString(),
  });
}
```

Add the imports at the top:

```ts
import { processPartographWebhook, validatePartographPayload } from '@/services/webhook';
import type { WebhookPartographPayload } from '@/services/webhook';
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(api): route type:'partograph' webhook payloads"
```

---

## Phase 5 — API Extension

### Task 22: Extend `PartogramResponse` and `PatientListItem`

**Files:**
- Modify: `src/types/api.ts`
- Test: `tests/unit/api/partogram-response-shape.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { PartogramResponse, PatientListItem } from '@/types/api';

describe('PartogramResponse extension', () => {
  it('partogram has observations[]', () => {
    expectTypeOf<PartogramResponse['partogram']['observations']>()
      .toBeArray();
  });
  it('partogram has alerts[] and severity', () => {
    expectTypeOf<PartogramResponse['partogram']['alerts']>().toBeArray();
    expectTypeOf<PartogramResponse['partogram']['severity']>().not.toBeNullable();
  });
});

describe('PatientListItem partograph fields', () => {
  it('exposes partographSeverity and partographAlertCount', () => {
    expectTypeOf<PatientListItem['partographSeverity']>()
      .toEqualTypeOf<'INFO' | 'WARN' | 'ALERT' | 'CRITICAL' | null>();
    expectTypeOf<PatientListItem['partographAlertCount']>()
      .toEqualTypeOf<number | null>();
  });
});
```

**Step 2: Run to verify fail.**

**Step 3: Extend the types** — replace `PartogramResponse` and add fields to `PatientListItem`:

```ts
export interface PartogramResponse {
  partogram: {
    startTime: string;
    entries: PartogramEntry[];                    // back-compat
    observations: PartographObservationDto[];
    alerts: CdssAlertDto[];
    severity: {
      highest: CdssSeverity | null;
      counts: { critical: number; alert: number; warn: number; info: number };
    };
    source: 'hosxp' | 'webhook' | 'mixed' | 'none';
    lastObservedAt: string | null;
  };
}
```

Add to `PatientListItem`:

```ts
partographSeverity:   CdssSeverity | null;
partographAlertCount: number | null;
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(types): extend PartogramResponse + PatientListItem with partograph severity"
```

---

### Task 23: Update `GET /api/patients/[an]/partogram` to return extended response

**Files:**
- Modify: `src/app/api/patients/[an]/partogram/route.ts`
- Test: `tests/unit/api/partogram-extended.test.ts`

**Step 1: Write the failing test** — covers:

- Empty partograph → returns `observations: []`, `alerts: []`, `severity.highest: null`, `source: 'none'`.
- 1 row with `moulding: '++'` → `alerts` contains a MOULDING ALERT, `severity.highest: 'ALERT'`, `severity.counts.alert: 1`.
- Mixed-source rows → `source: 'mixed'`.
- Legacy `entries[]` still populated for any row with non-null `cervicalDilationCm`.

**Step 2: Run to verify fail.**

**Step 3: Replace the handler body** with the design's pseudocode (Section 5). Key parts:

```ts
const observations = await db.query<{
  id: string; observe_datetime: string; hour_no: number | null;
  fetal_heart_rate: number | null; amniotic_fluid: string | null;
  amniotic_type_name: string | null; moulding: string | null;
  cervical_dilation_cm: number | null; descent_of_head: string | null;
  contraction_per_10min: number | null; contraction_duration_sec: number | null;
  contraction_strength: string | null;
  oxytocin_uml: number | null; oxytocin_drops_min: number | null;
  drugs_iv_fluids: string | null;
  pulse: number | null; bp_systolic: number | null;
  bp_diastolic: number | null; temperature: number | null;
  urine_volume_ml: number | null; urine_protein: string | null;
  urine_glucose: string | null; urine_acetone: string | null;
  note: string | null; entry_staff: string | null;
  source_system: string;
}>(
  `SELECT * FROM cached_partograph_observations
     WHERE patient_id = ?
     ORDER BY observe_datetime ASC`,
  [patient.id],
);

const dtos: PartographObservationDto[] = observations.map((r) => ({
  id: r.id, observeDatetime: r.observe_datetime, hourNo: r.hour_no,
  fetalHeartRate: r.fetal_heart_rate, amnioticFluid: r.amniotic_fluid,
  amnioticTypeName: r.amniotic_type_name, moulding: r.moulding,
  cervicalDilationCm: r.cervical_dilation_cm, descentOfHead: r.descent_of_head,
  contractionPer10Min: r.contraction_per_10min,
  contractionDurationSec: r.contraction_duration_sec,
  contractionStrength: r.contraction_strength,
  oxytocinUml: r.oxytocin_uml, oxytocinDropsMin: r.oxytocin_drops_min,
  drugsIvFluids: r.drugs_iv_fluids,
  pulse: r.pulse, bpSystolic: r.bp_systolic, bpDiastolic: r.bp_diastolic,
  temperature: r.temperature, urineVolumeMl: r.urine_volume_ml,
  urineProtein: r.urine_protein, urineGlucose: r.urine_glucose,
  urineAcetone: r.urine_acetone, note: r.note, entryStaff: r.entry_staff,
}));

const alerts = analyzePartograph({ an: patientId }, dtos);

const entries = generatePartogramEntries(
  dtos.filter((o) => o.cervicalDilationCm != null)
      .map((o) => ({ measuredAt: o.observeDatetime,
                     cervixCm: o.cervicalDilationCm! })),
);

const sourceSet = new Set(observations.map((o) => o.source_system));
const source = sourceSet.size === 0 ? 'none'
             : sourceSet.size > 1  ? 'mixed'
             : (sourceSet.values().next().value as 'hosxp' | 'webhook');

const response: PartogramResponse = {
  partogram: {
    startTime: patient.admit_date, entries, observations: dtos, alerts,
    severity: {
      highest: highestSeverity(alerts),
      counts: {
        critical: countBySeverity(alerts, 'CRITICAL'),
        alert:    countBySeverity(alerts, 'ALERT'),
        warn:     countBySeverity(alerts, 'WARN'),
        info:     countBySeverity(alerts, 'INFO'),
      },
    },
    source, lastObservedAt: dtos.at(-1)?.observeDatetime ?? null,
  },
};
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(api): extended partogram response with observations + alerts + severity"
```

---

### Task 24: Surface `partographSeverity` in the patient-list query

**Files:**
- Modify: `src/services/dashboard.ts` (the patient-list builder; if it lives elsewhere find via `grep PatientListItem src/`)
- Test: extend whichever test file covers patient-list mapping

**Step 1: Write the failing test** — given a cached patient with `partograph_severity = 'CRITICAL'` and `partograph_alert_count = 3`, the produced `PatientListItem` carries those values.

**Step 2: Run to verify fail.**

**Step 3: Add the columns** to the `SELECT` and the row mapper:

```sql
SELECT cp.id, cp.hn, cp.an, …,
       cp.partograph_severity, cp.partograph_alert_count
  FROM cached_patients cp
  …
```

```ts
return rows.map((r) => ({
  …,
  partographSeverity:   (r.partograph_severity as CdssSeverity | null) ?? null,
  partographAlertCount: r.partograph_alert_count ?? null,
}));
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(api): expose partograph severity on patient list"
```

---

## Phase 6 — pglite Integration Tests

### Task 25: `partograph-sync-pglite.test.ts`

**Files:**
- Create: `tests/integration/partograph-sync-pglite.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createPgliteDb } from '../helpers/createPgliteDb';
import {
  upsertPartographObservations, type PartographRow,
} from '@/services/sync/partograph';
import type { DatabaseAdapter } from '@/db/adapter';

let db: DatabaseAdapter;
const HID = 'h-1', PID = 'p-1';

beforeEach(async () => {
  db = await createPgliteDb();
  await db.execute(
    `INSERT INTO hospitals (id, hcode, name, level, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    [HID, '10670', 'Test', 'M2', new Date().toISOString()]);
  await db.execute(
    `INSERT INTO cached_patients
       (id, hospital_id, hn, an, name, age, admit_date,
        labor_status, synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
    [PID, HID, 'HN1', 'AN1', 'enc', 25,
     '2026-04-18T08:00:00Z',
     '2026-04-18T08:00:00Z', '2026-04-18T08:00:00Z', '2026-04-18T08:00:00Z']);
});

describe('partograph sync against real Postgres dialect (pglite)', () => {
  const mk = (over: Partial<PartographRow> = {}): PartographRow => ({
    hospitalId: HID, patientId: PID,
    sourceSystem: 'hosxp', sourcePk: '1',
    observeDatetime: '2026-04-18T10:00:00Z', hourNo: 1,
    fetalHeartRate: 130, amnioticFluid: 'Clear', amnioticTypeId: null,
    amnioticTypeName: null, moulding: null,
    cervicalDilationCm: null, descentOfHead: null,
    contractionPer10Min: null, contractionDurationSec: null,
    contractionStrength: null, oxytocinUml: null, oxytocinDropsMin: null,
    drugsIvFluids: null,
    pulse: null, bpSystolic: null, bpDiastolic: null, temperature: null,
    urineVolumeMl: null, urineProtein: null, urineGlucose: null,
    urineAcetone: null, note: null, entryStaff: null, entryDatetime: null,
    ...over,
  });

  it('round-trips all 22 fields with correct types', async () => {
    await upsertPartographObservations(db, HID, [mk({
      fetalHeartRate: 142, amnioticFluid: 'Clear', moulding: '+',
      cervicalDilationCm: 4.5, descentOfHead: '3/5',
      contractionPer10Min: 3, contractionDurationSec: 45,
      contractionStrength: 'moderate',
      oxytocinUml: 5.0, oxytocinDropsMin: 12,
      drugsIvFluids: 'NSS 1000 + Oxytocin 10u',
      pulse: 88, bpSystolic: 120, bpDiastolic: 80, temperature: 37.0,
      urineVolumeMl: 200, urineProtein: 'neg', urineGlucose: 'neg',
      urineAcetone: 'neg', note: 'normal',
    })]);
    const rows = await db.query<{ cervical_dilation_cm: string; pulse: number;
                                  temperature: string }>(
      'SELECT cervical_dilation_cm, pulse, temperature FROM cached_partograph_observations');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].cervical_dilation_cm)).toBe(4.5);
    expect(rows[0].pulse).toBe(88);
    expect(Number(rows[0].temperature)).toBe(37.0);
  });

  it('UPSERT updates instead of duplicating on second insert with same source_pk', async () => {
    await upsertPartographObservations(db, HID, [mk({ fetalHeartRate: 130 })]);
    await upsertPartographObservations(db, HID, [mk({ fetalHeartRate: 145 })]);
    const rows = await db.query<{ fetal_heart_rate: number }>(
      'SELECT fetal_heart_rate FROM cached_partograph_observations');
    expect(rows).toHaveLength(1);
    expect(rows[0].fetal_heart_rate).toBe(145);
  });

  it('flips cached_patients.partograph_severity NULL → ALERT after a moulding ++', async () => {
    const before = await db.query<{ partograph_severity: string | null }>(
      'SELECT partograph_severity FROM cached_patients WHERE id = ?', [PID]);
    expect(before[0].partograph_severity).toBeNull();
    await upsertPartographObservations(db, HID, [mk({ moulding: '++' })]);
    const after = await db.query<{ partograph_severity: string | null }>(
      'SELECT partograph_severity FROM cached_patients WHERE id = ?', [PID]);
    expect(after[0].partograph_severity).toBe('ALERT');
  });
});
```

**Step 2: Run.**

Run: `npx vitest run tests/integration/partograph-sync-pglite.test.ts`
Expected: PASS — 3 tests. If a Postgres-dialect issue emerges (e.g. type cast for DECIMAL or `ON CONFLICT`), the bug lives in the upsert SQL — fix it in `src/services/sync/partograph.ts` and re-run.

**Step 3: Commit**

```bash
git commit -m "test(integration): partograph sync round-trip on pglite"
```

---

### Task 26: `partograph-webhook-pglite.test.ts`

**Files:**
- Create: `tests/integration/partograph-webhook-pglite.test.ts`

Mirrors Task 25's structure but exercises the full `processPartographWebhook` path. Asserts:

- 200 response with shape `{ success, observationsAccepted, observationsSkipped: [], timestamp }`.
- Unknown ANs land in `observationsSkipped[]` with `reason: 'patient_not_found'`.
- Mocked `SseManager.broadcast` was called exactly once with `type: 'partograph_severity_changed'` and the correct severity when the row triggers a CDSS alert.

Standard 5-step TDD cycle. Commit:

```bash
git commit -m "test(integration): webhook → severity-change SSE on pglite"
```

---

## Phase 7 — UI

### Task 27: `AlertSummaryPanel` component

**Files:**
- Create: `src/components/patient/AlertSummaryPanel.tsx`
- Test: `tests/unit/components/AlertSummaryPanel.test.tsx`

**Step 1: Write the failing test** with React Testing Library — assert:

- Renders nothing when `alerts.length === 0`.
- Groups by severity in CRITICAL → ALERT → WARN → INFO order.
- Each alert row shows the Thai message + section + the observation timestamp resolved via `obsIndex`.
- Cross-cutting alerts (`obsIndex === -1`) render with the label "ภาพรวม" instead of a timestamp.

**Step 2: Run to verify fail.**

**Step 3: Implement** — pure presentational component. Use the existing `cn`/Tailwind utilities and Lucide `AlertCircle`. Severity color map:

```ts
const SEVERITY_DOT: Record<CdssSeverity, string> = {
  CRITICAL: 'bg-red-500',
  ALERT:    'bg-orange-500',
  WARN:     'bg-amber-400',
  INFO:     'bg-slate-400',
};
const SEVERITY_LABEL_TH: Record<CdssSeverity, string> = {
  CRITICAL: 'วิกฤต', ALERT: 'เตือน', WARN: 'ระวัง', INFO: 'ข้อมูล',
};
```

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(ui): AlertSummaryPanel for partograph CDSS alerts"
```

---

### Task 28: Rebuild `PartogramChart` as 4-panel WHO-style chart

**Files:**
- Modify: `src/components/charts/PartogramChart.tsx`
- Test: `tests/unit/components/PartogramChart.test.tsx`

**Step 1: Write the failing test** — Recharts renders to SVG; use Testing Library to assert:

- Empty `observations` shows the placeholder.
- 3 observations renders 4 panels (find by stable `data-testid`s — `partogram-panel-fhr`, `partogram-panel-cervix`, `partogram-panel-contractions`, `partogram-panel-vitals`).
- Severity chip in the header reflects `highestSeverity(alerts)` — e.g. for one ALERT shows "เตือน".
- Time axis ticks at 0, 4, 8, 12, 16, 20, 24.

**Step 2: Run to verify fail.**

**Step 3: Implement.** Rewrite the file to match the design (Section 6a). Props:

```tsx
interface PartogramChartProps {
  observations: PartographObservationDto[];
  alerts:       CdssAlertDto[];
  startTime:    string;
}
```

Use four `<ComposedChart>` instances inside one `<Card>`, each with their own `<XAxis>` configured identically (so they align). Time mapping helper:

```tsx
function hoursAt(o: PartographObservationDto, startTime: string): number {
  if (o.hourNo != null) return o.hourNo;
  const ms = new Date(o.observeDatetime).getTime() - new Date(startTime).getTime();
  return Math.round((ms / 3600000) * 10) / 10;
}
```

Color the dots in the dilation panel per `highestSeverity(alertsForObsIndex(alerts, i))`.

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(ui): 4-panel WHO partograph chart (FHR + cervix + contractions + vitals)"
```

---

### Task 29: Wire chart + alert panel into patient detail page

**Files:**
- Modify: `src/app/(dashboard)/patients/[an]/page.tsx`
- Test: extend Playwright e2e at the end of phase 8

**Step 1:** Update the import + JSX. Replace the existing `<PartogramChart entries={…} startTime={…} />` block with:

```tsx
{partogram && (
  <>
    {partogram.alerts.length > 0 && (
      <AlertSummaryPanel
        alerts={partogram.alerts}
        observations={partogram.observations}
      />
    )}
    <PartogramChart
      observations={partogram.observations}
      alerts={partogram.alerts}
      startTime={partogram.startTime}
    />
  </>
)}
```

Add the import for `AlertSummaryPanel`. Confirm `usePartogram` returns the new shape (`partogram.observations`, `partogram.alerts` — already populated from the extended API in Task 23).

**Step 2:** Run `npm run dev`, open a patient page locally, manually verify the chart renders with sample data. Constitution §V — verify in the browser, not just type-check.

**Step 3: Commit**

```bash
git commit -m "feat(ui): patient detail uses 4-panel partogram + alert summary"
```

---

### Task 30: Severity dot on `HighRiskPatientList`

**Files:**
- Modify: `src/components/dashboard/HighRiskPatientList.tsx`
- Test: `tests/unit/components/HighRiskPatientList-partograph-dot.test.tsx`

**Step 1: Write the failing test** — patient with `partographSeverity: 'CRITICAL'` shows a red dot with `title="Partograph: วิกฤต (3 ข้อ)"`; patient with `null` shows nothing.

**Step 2: Run to verify fail.**

**Step 3: Implement** the dot per design Section 6c. Reuse the `SEVERITY_DOT` color map from `AlertSummaryPanel` — extract it to `src/components/patient/cdss-presentation.ts` to satisfy DRY (Constitution §III), and import from both components.

**Step 4: Run to verify pass.**

**Step 5: Commit**

```bash
git commit -m "feat(ui): severity dot on dashboard high-risk patient cards"
```

---

### Task 31: Critical glow on kiosk monitor patient cards

**Files:**
- Modify: whatever kiosk patient card file currently applies the high-CPD glow class (find via `grep -r "shadow-red" src/components`)

**Step 1: Locate the existing glow class** and add `partographSeverity === 'CRITICAL'` as an OR condition:

```tsx
const isCriticalGlow = patient.cpdScore?.riskLevel === 'high'
  || patient.partographSeverity === 'CRITICAL';
```

**Step 2:** Manually test in kiosk mode (`/?kiosk=1` or wherever the kiosk route is) with a fixture patient.

**Step 3: Commit**

```bash
git commit -m "feat(ui): kiosk red glow on critical partograph severity"
```

---

## Phase 8 — Finalisation

### Task 32: Playwright E2E — webhook to UI round trip

**Files:**
- Create: `tests/e2e/partograph-webhook-to-ui.spec.ts`

**Step 1:** Write the spec:

```ts
import { test, expect } from '@playwright/test';

test('partograph webhook → patient page renders chart + critical alert', async ({
  request, page,
}) => {
  // Pre-seed patient via existing webhook (assumes test API key in env)
  await request.post('/api/webhooks/patient-data', {
    headers: { Authorization: `Bearer ${process.env.TEST_WEBHOOK_KEY}` },
    data: {
      hospitalCode: '10670',
      patients: [{
        hn: 'HN-E2E', an: 'AN-E2E', cid: '1234567890123',
        name: 'นางทดสอบ ระบบ', age: 25, admit_date: '2026-04-19T08:00:00Z',
      }],
    },
  });

  // Push a partograph observation that triggers CRITICAL (moulding +++)
  await request.post('/api/webhooks/patient-data', {
    headers: { Authorization: `Bearer ${process.env.TEST_WEBHOOK_KEY}` },
    data: {
      type: 'partograph', hospitalCode: '10670',
      observations: [{
        an: 'AN-E2E', externalObservationId: 'e2e-1',
        observeDatetime: '2026-04-19T10:00:00Z',
        moulding: '+++',
      }],
    },
  });

  // Visit patient page, expect chart + alert
  await page.goto('/patients/10670-AN-E2E');
  await expect(page.getByText('Partograph')).toBeVisible();
  await expect(page.getByText('วิกฤต')).toBeVisible();
  await expect(page.getByText('กะโหลกเกยกันรุนแรง (+++)')).toBeVisible();
});
```

**Step 2:** Run: `npx playwright test tests/e2e/partograph-webhook-to-ui.spec.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git commit -m "test(e2e): webhook → patient page renders partograph + critical alert"
```

---

### Task 33: Final verification

**Step 1:** Run the full test suite + lint:

```bash
npm test && npm run lint
```

Expected: all pass, zero warnings (Constitution §I).

**Step 2:** Type-check:

```bash
npx tsc --noEmit
```

Expected: clean.

**Step 3:** Update CLAUDE.md `Recent Changes`:

In `CLAUDE.md`, prepend to the `## Recent Changes` list:

```
- 001-kk-lrms-app: Partograph time-series ingestion (HOSxP ipt_labour_partograph + webhook), Pascal CDSS port, 4-panel chart, dashboard severity dot
```

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note partograph support in recent changes"
```

**Step 5:** Push the branch and open a PR (only when explicitly asked by the user — don't auto-push).

```bash
git push -u origin feat/partograph-support
```

---

## Cross-cutting reminders

- **Every task ends with a commit.** No multi-task batches.
- **Every numeric threshold gets the (t-1, t, t+1) sweep.** This is the single biggest source of Pascal-port bugs.
- **Pascal source-of-truth:** if you find yourself guessing, re-read `C:\Projects\BMS XE2 Application\BMS HOSxP XE\hosxpxe\HOSxPLaborPackage\PartographCDSSUnit.pas`.
- **Thai messages copy-paste verbatim from Pascal.** Do not paraphrase.
- **Don't touch `cached_vital_signs.cervix_cm`.** Convergence is a separate later cleanup (named in design Section 7g).
- **Before claiming "done":** invoke `superpowers:verification-before-completion`.

---

## Rollback plan

If anything ships broken:

1. `git revert` the merge commit on `main`.
2. The new table and columns stay (idempotent schema-sync, no data loss).
3. Old `PartogramResponse` shape continues to work because `entries[]` is unchanged.
4. Webhook senders pushing `type: 'partograph'` will get 404 once route is reverted — they should retry until the fix lands.
