# Pregnancy → Labor → Newborn Continuum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand kk-lrms from labor-only to full maternal journey tracking (pregnancy → labor → newborn) with 4-tier ANC risk classification, referral workflow, and province-wide dashboard.

**Architecture:** "Maternal Journey" anchor entity connects all stages. New tables (`maternal_journeys`, `cached_anc_visits`, `cached_anc_risks`, `cached_referrals`, `cached_newborns`) link to existing tables. Existing labor module unchanged except adding `journey_id` FK to `cached_patients`. Stage-appropriate risk models: 4-tier ANC during pregnancy, CPD during labor.

**Tech Stack:** TypeScript 5.x, Next.js 15 (App Router), React 19, PostgreSQL 16+, SQLite (tests), Vitest, Playwright, SWR, shadcn/ui, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-29-pregnancy-continuum-design.md`

---

## Phase 1: Foundation — Types, Tables, Config (Tasks 1-4)

### Task 1: Domain Types — New Enums and Interfaces

**Files:**
- Modify: `src/types/domain.ts`
- Test: `tests/unit/types/domain-enums.test.ts`

- [ ] **Step 1: Write failing test for new enums**

```typescript
// tests/unit/types/domain-enums.test.ts
import { describe, it, expect } from 'vitest';
import {
  CareStage,
  AncRiskLevel,
  ReferralStatus,
  UrgencyLevel,
} from '@/types/domain';

describe('New Domain Enums', () => {
  describe('CareStage', () => {
    it('has all 4 stages', () => {
      expect(CareStage.PREGNANCY).toBe('PREGNANCY');
      expect(CareStage.LABOR).toBe('LABOR');
      expect(CareStage.DELIVERED).toBe('DELIVERED');
      expect(CareStage.POSTPARTUM).toBe('POSTPARTUM');
    });
  });

  describe('AncRiskLevel', () => {
    it('has 4 tiers: LOW, HR1, HR2, HR3', () => {
      expect(AncRiskLevel.LOW).toBe('LOW');
      expect(AncRiskLevel.HR1).toBe('HR1');
      expect(AncRiskLevel.HR2).toBe('HR2');
      expect(AncRiskLevel.HR3).toBe('HR3');
    });
  });

  describe('ReferralStatus', () => {
    it('has all 5 statuses', () => {
      expect(ReferralStatus.INITIATED).toBe('INITIATED');
      expect(ReferralStatus.ACCEPTED).toBe('ACCEPTED');
      expect(ReferralStatus.REJECTED).toBe('REJECTED');
      expect(ReferralStatus.IN_TRANSIT).toBe('IN_TRANSIT');
      expect(ReferralStatus.ARRIVED).toBe('ARRIVED');
    });
  });

  describe('UrgencyLevel', () => {
    it('has 3 levels', () => {
      expect(UrgencyLevel.ROUTINE).toBe('ROUTINE');
      expect(UrgencyLevel.URGENT).toBe('URGENT');
      expect(UrgencyLevel.EMERGENCY).toBe('EMERGENCY');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/types/domain-enums.test.ts`
Expected: FAIL — `CareStage` is not exported

- [ ] **Step 3: Add enums and interfaces to domain.ts**

Add to the end of `src/types/domain.ts`:

```typescript
// --- Maternal Journey Continuum (Pregnancy → Labor → Newborn) ---

export enum CareStage {
  PREGNANCY = 'PREGNANCY',
  LABOR = 'LABOR',
  DELIVERED = 'DELIVERED',
  POSTPARTUM = 'POSTPARTUM',
}

export enum AncRiskLevel {
  LOW = 'LOW',
  HR1 = 'HR1',
  HR2 = 'HR2',
  HR3 = 'HR3',
}

export enum ReferralStatus {
  INITIATED = 'INITIATED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED = 'ARRIVED',
}

export enum UrgencyLevel {
  ROUTINE = 'ROUTINE',
  URGENT = 'URGENT',
  EMERGENCY = 'EMERGENCY',
}

export interface MaternalJourney {
  id: string;
  hospitalId: string;
  currentHospitalId: string;
  hn: string;
  personAncId: number | null;
  name: string;
  cid: string | null;
  cidHash: string | null;
  age: number;
  gravida: number;
  para: number;
  lmp: string | null;
  edc: string | null;
  careStage: CareStage;
  ancRiskLevel: AncRiskLevel;
  ancVisitCount: number;
  lastAncDate: string | null;
  gaWeeks: number | null;
  registeredAt: Date;
  stageChangedAt: Date;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CachedAncVisit {
  id: string;
  journeyId: string;
  visitDate: string;
  visitNumber: number;
  gaWeeks: number | null;
  gaDays: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
  presentation: string | null;
  engagement: string | null;
  passQuality: boolean | null;
  providerCode: string | null;
  syncedAt: Date;
  createdAt: Date;
}

export interface CachedAncRisk {
  id: string;
  journeyId: string;
  riskLevel: AncRiskLevel;
  triggeredRules: string[];
  riskFactors: Record<string, unknown>;
  recommendedFacility: string | null;
  recommendedProvider: string | null;
  screenedAt: Date;
  createdAt: Date;
}

export interface CachedReferral {
  id: string;
  journeyId: string;
  referNumber: string | null;
  fromHospitalId: string;
  toHospitalId: string;
  status: ReferralStatus;
  reason: string;
  diagnosisCode: string | null;
  urgencyLevel: UrgencyLevel;
  rejectionReason: string | null;
  suggestedAlternativeId: string | null;
  transportMode: string | null;
  initiatedAt: Date;
  acceptedAt: Date | null;
  departedAt: Date | null;
  arrivedAt: Date | null;
  rejectedAt: Date | null;
  initiatedBy: string | null;
  acceptedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CachedNewborn {
  id: string;
  journeyId: string;
  infantNumber: number;
  sex: string | null;
  birthWeightG: number | null;
  bodyLengthCm: number | null;
  headCircumCm: number | null;
  temperature: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  apgar1min: number | null;
  apgar5min: number | null;
  apgar10min: number | null;
  resuscitation: Record<string, boolean>;
  vaccinations: Record<string, boolean>;
  infantIcd10: string | null;
  infantHn: string | null;
  infantAn: string | null;
  dischargeStatus: string | null;
  bornAt: Date;
  syncedAt: Date;
  createdAt: Date;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/types/domain-enums.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/domain.ts tests/unit/types/domain-enums.test.ts
git commit -m "feat: add maternal journey domain types — CareStage, AncRiskLevel, ReferralStatus enums and interfaces"
```

---

### Task 2: Database Tables — 5 New Table Definitions

**Files:**
- Create: `src/db/tables/maternal-journeys.ts`
- Create: `src/db/tables/cached-anc-visits.ts`
- Create: `src/db/tables/cached-anc-risks.ts`
- Create: `src/db/tables/cached-referrals.ts`
- Create: `src/db/tables/cached-newborns.ts`
- Modify: `src/db/tables/cached-patients.ts` (add `journey_id`)
- Modify: `src/db/tables/index.ts` (register new tables)
- Test: `tests/unit/db/schema-sync-journey.test.ts`

- [ ] **Step 1: Write failing test for new table schemas**

```typescript
// tests/unit/db/schema-sync-journey.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import type { DatabaseAdapter } from '@/db/adapter';

describe('Schema Sync — Journey Tables', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = createSqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
  });

  it('creates maternal_journeys table with all columns', async () => {
    const cols = await db.getColumnInfo('maternal_journeys');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('hospital_id');
    expect(colNames).toContain('current_hospital_id');
    expect(colNames).toContain('hn');
    expect(colNames).toContain('person_anc_id');
    expect(colNames).toContain('care_stage');
    expect(colNames).toContain('anc_risk_level');
    expect(colNames).toContain('lmp');
    expect(colNames).toContain('edc');
    expect(colNames).toContain('gravida');
    expect(colNames).toContain('para');
  });

  it('creates cached_anc_visits table', async () => {
    const cols = await db.getColumnInfo('cached_anc_visits');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('visit_date');
    expect(colNames).toContain('ga_weeks');
    expect(colNames).toContain('fundal_height_cm');
    expect(colNames).toContain('bp_systolic');
    expect(colNames).toContain('fetal_hr');
  });

  it('creates cached_anc_risks table', async () => {
    const cols = await db.getColumnInfo('cached_anc_risks');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('risk_level');
    expect(colNames).toContain('triggered_rules');
    expect(colNames).toContain('risk_factors');
  });

  it('creates cached_referrals table', async () => {
    const cols = await db.getColumnInfo('cached_referrals');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('from_hospital_id');
    expect(colNames).toContain('to_hospital_id');
    expect(colNames).toContain('status');
    expect(colNames).toContain('urgency_level');
  });

  it('creates cached_newborns table', async () => {
    const cols = await db.getColumnInfo('cached_newborns');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
    expect(colNames).toContain('infant_number');
    expect(colNames).toContain('birth_weight_g');
    expect(colNames).toContain('apgar_1min');
    expect(colNames).toContain('apgar_5min');
    expect(colNames).toContain('resuscitation');
    expect(colNames).toContain('vaccinations');
  });

  it('adds journey_id column to cached_patients', async () => {
    const cols = await db.getColumnInfo('cached_patients');
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('journey_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db/schema-sync-journey.test.ts`
Expected: FAIL — `maternal_journeys` table not found

- [ ] **Step 3: Create all 5 table definition files**

Create `src/db/tables/maternal-journeys.ts`:

```typescript
import type { TableDefinition } from '../table-definition';

export const maternalJourneysTable: TableDefinition = {
  name: 'maternal_journeys',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    { name: 'current_hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    { name: 'hn', type: 'string', maxLength: 20 },
    { name: 'person_anc_id', type: 'integer', nullable: true },
    { name: 'name', type: 'string', maxLength: 255 },
    { name: 'cid', type: 'string', maxLength: 255, nullable: true },
    { name: 'cid_hash', type: 'string', maxLength: 64, nullable: true },
    { name: 'age', type: 'integer' },
    { name: 'gravida', type: 'integer' },
    { name: 'para', type: 'integer', defaultValue: 0 },
    { name: 'lmp', type: 'datetime', nullable: true },
    { name: 'edc', type: 'datetime', nullable: true },
    { name: 'care_stage', type: 'string', maxLength: 20, defaultValue: 'PREGNANCY' },
    { name: 'anc_risk_level', type: 'string', maxLength: 10, defaultValue: 'LOW' },
    { name: 'anc_visit_count', type: 'integer', defaultValue: 0 },
    { name: 'last_anc_date', type: 'datetime', nullable: true },
    { name: 'ga_weeks', type: 'integer', nullable: true },
    { name: 'registered_at', type: 'datetime' },
    { name: 'stage_changed_at', type: 'datetime' },
    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_mj_hospital_hn', columns: ['hospital_id', 'hn'], unique: true },
    { name: 'idx_mj_care_stage', columns: ['care_stage'] },
    { name: 'idx_mj_anc_risk_level', columns: ['anc_risk_level'] },
    { name: 'idx_mj_cid_hash', columns: ['cid_hash'] },
    { name: 'idx_mj_current_hospital', columns: ['current_hospital_id'] },
  ],
};
```

Create `src/db/tables/cached-anc-visits.ts`:

```typescript
import type { TableDefinition } from '../table-definition';

export const cachedAncVisitsTable: TableDefinition = {
  name: 'cached_anc_visits',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'journey_id', type: 'uuid', references: { table: 'maternal_journeys', column: 'id' } },
    { name: 'visit_date', type: 'datetime' },
    { name: 'visit_number', type: 'integer' },
    { name: 'ga_weeks', type: 'integer', nullable: true },
    { name: 'ga_days', type: 'integer', nullable: true },
    { name: 'fundal_height_cm', type: 'decimal', nullable: true },
    { name: 'weight_kg', type: 'decimal', nullable: true },
    { name: 'bp_systolic', type: 'integer', nullable: true },
    { name: 'bp_diastolic', type: 'integer', nullable: true },
    { name: 'fetal_hr', type: 'integer', nullable: true },
    { name: 'presentation', type: 'string', maxLength: 50, nullable: true },
    { name: 'engagement', type: 'string', maxLength: 50, nullable: true },
    { name: 'pass_quality', type: 'boolean', nullable: true },
    { name: 'provider_code', type: 'string', maxLength: 20, nullable: true },
    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_cav_journey_date', columns: ['journey_id', 'visit_date'], unique: true },
    { name: 'idx_cav_journey_id', columns: ['journey_id'] },
  ],
};
```

Create `src/db/tables/cached-anc-risks.ts`:

```typescript
import type { TableDefinition } from '../table-definition';

export const cachedAncRisksTable: TableDefinition = {
  name: 'cached_anc_risks',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'journey_id', type: 'uuid', references: { table: 'maternal_journeys', column: 'id' } },
    { name: 'risk_level', type: 'string', maxLength: 10 },
    { name: 'triggered_rules', type: 'json' },
    { name: 'risk_factors', type: 'json' },
    { name: 'recommended_facility', type: 'string', maxLength: 100, nullable: true },
    { name: 'recommended_provider', type: 'string', maxLength: 100, nullable: true },
    { name: 'screened_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_car_journey_screened', columns: ['journey_id', 'screened_at'] },
    { name: 'idx_car_risk_level', columns: ['risk_level'] },
  ],
};
```

Create `src/db/tables/cached-referrals.ts`:

```typescript
import type { TableDefinition } from '../table-definition';

export const cachedReferralsTable: TableDefinition = {
  name: 'cached_referrals',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'journey_id', type: 'uuid', references: { table: 'maternal_journeys', column: 'id' } },
    { name: 'refer_number', type: 'string', maxLength: 50, nullable: true },
    { name: 'from_hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    { name: 'to_hospital_id', type: 'uuid', references: { table: 'hospitals', column: 'id' } },
    { name: 'status', type: 'string', maxLength: 20, defaultValue: 'INITIATED' },
    { name: 'reason', type: 'text' },
    { name: 'diagnosis_code', type: 'string', maxLength: 20, nullable: true },
    { name: 'urgency_level', type: 'string', maxLength: 20, defaultValue: 'ROUTINE' },
    { name: 'rejection_reason', type: 'text', nullable: true },
    { name: 'suggested_alternative_id', type: 'uuid', nullable: true, references: { table: 'hospitals', column: 'id' } },
    { name: 'transport_mode', type: 'string', maxLength: 50, nullable: true },
    { name: 'initiated_at', type: 'datetime' },
    { name: 'accepted_at', type: 'datetime', nullable: true },
    { name: 'departed_at', type: 'datetime', nullable: true },
    { name: 'arrived_at', type: 'datetime', nullable: true },
    { name: 'rejected_at', type: 'datetime', nullable: true },
    { name: 'initiated_by', type: 'uuid', nullable: true, references: { table: 'users', column: 'id' } },
    { name: 'accepted_by', type: 'uuid', nullable: true, references: { table: 'users', column: 'id' } },
    { name: 'created_at', type: 'datetime' },
    { name: 'updated_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_cr_journey_id', columns: ['journey_id'] },
    { name: 'idx_cr_from_status', columns: ['from_hospital_id', 'status'] },
    { name: 'idx_cr_to_status', columns: ['to_hospital_id', 'status'] },
    { name: 'idx_cr_status', columns: ['status'] },
  ],
};
```

Create `src/db/tables/cached-newborns.ts`:

```typescript
import type { TableDefinition } from '../table-definition';

export const cachedNewbornsTable: TableDefinition = {
  name: 'cached_newborns',
  fields: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'journey_id', type: 'uuid', references: { table: 'maternal_journeys', column: 'id' } },
    { name: 'infant_number', type: 'integer' },
    { name: 'sex', type: 'string', maxLength: 5, nullable: true },
    { name: 'birth_weight_g', type: 'integer', nullable: true },
    { name: 'body_length_cm', type: 'decimal', nullable: true },
    { name: 'head_circum_cm', type: 'decimal', nullable: true },
    { name: 'temperature', type: 'decimal', nullable: true },
    { name: 'heart_rate', type: 'integer', nullable: true },
    { name: 'respiratory_rate', type: 'integer', nullable: true },
    { name: 'apgar_1min', type: 'integer', nullable: true },
    { name: 'apgar_5min', type: 'integer', nullable: true },
    { name: 'apgar_10min', type: 'integer', nullable: true },
    { name: 'resuscitation', type: 'json', nullable: true },
    { name: 'vaccinations', type: 'json', nullable: true },
    { name: 'infant_icd10', type: 'string', maxLength: 20, nullable: true },
    { name: 'infant_hn', type: 'string', maxLength: 20, nullable: true },
    { name: 'infant_an', type: 'string', maxLength: 20, nullable: true },
    { name: 'discharge_status', type: 'string', maxLength: 20, nullable: true },
    { name: 'born_at', type: 'datetime' },
    { name: 'synced_at', type: 'datetime' },
    { name: 'created_at', type: 'datetime' },
  ],
  indexes: [
    { name: 'idx_cn_journey_infant', columns: ['journey_id', 'infant_number'], unique: true },
    { name: 'idx_cn_journey_id', columns: ['journey_id'] },
  ],
};
```

- [ ] **Step 4: Add journey_id to cached_patients table**

In `src/db/tables/cached-patients.ts`, add before `{ name: 'synced_at', ... }`:

```typescript
    { name: 'journey_id', type: 'uuid', nullable: true, references: { table: 'maternal_journeys', column: 'id' } },
```

And add to the indexes array:

```typescript
    { name: 'idx_cp_journey_id', columns: ['journey_id'] },
```

- [ ] **Step 5: Register tables in index.ts**

Update `src/db/tables/index.ts` to import and register all new tables in creation order (maternal_journeys before its dependents, all before cached_patients modification takes effect):

```typescript
import type { TableDefinition } from '../table-definition';
import { hospitalsTable } from './hospitals';
import { hospitalBmsConfigTable } from './hospital-bms-config';
import { cachedPatientsTable } from './cached-patients';
import { cachedVitalSignsTable } from './cached-vital-signs';
import { cpdScoresTable } from './cpd-scores';
import { usersTable } from './users';
import { auditLogsTable } from './audit-logs';
import { webhookApiKeysTable } from './webhook-api-keys';
import { maternalJourneysTable } from './maternal-journeys';
import { cachedAncVisitsTable } from './cached-anc-visits';
import { cachedAncRisksTable } from './cached-anc-risks';
import { cachedReferralsTable } from './cached-referrals';
import { cachedNewbornsTable } from './cached-newborns';

export {
  hospitalsTable,
  hospitalBmsConfigTable,
  cachedPatientsTable,
  cachedVitalSignsTable,
  cpdScoresTable,
  usersTable,
  auditLogsTable,
  webhookApiKeysTable,
  maternalJourneysTable,
  cachedAncVisitsTable,
  cachedAncRisksTable,
  cachedReferralsTable,
  cachedNewbornsTable,
};

// All tables in creation order (respects foreign key dependencies)
export const ALL_TABLES: TableDefinition[] = [
  hospitalsTable,
  hospitalBmsConfigTable,
  usersTable,
  maternalJourneysTable,
  cachedPatientsTable,
  cachedVitalSignsTable,
  cpdScoresTable,
  auditLogsTable,
  webhookApiKeysTable,
  cachedAncVisitsTable,
  cachedAncRisksTable,
  cachedReferralsTable,
  cachedNewbornsTable,
];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/db/schema-sync-journey.test.ts`
Expected: PASS — all 6 assertions pass

- [ ] **Step 7: Run existing tests to verify no regression**

Run: `npx vitest run tests/unit/db/`
Expected: ALL PASS — existing schema-sync tests still pass

- [ ] **Step 8: Commit**

```bash
git add src/db/tables/ tests/unit/db/schema-sync-journey.test.ts
git commit -m "feat: add 5 new database tables for maternal journey continuum"
```

---

### Task 3: ANC Risk Rules Configuration

**Files:**
- Create: `src/config/anc-risk-rules.ts`
- Test: `tests/unit/config/anc-risk-rules.test.ts`

- [ ] **Step 1: Write failing test for ANC risk rules**

```typescript
// tests/unit/config/anc-risk-rules.test.ts
import { describe, it, expect } from 'vitest';
import {
  ANC_RISK_RULES,
  type AncRiskRule,
  type AncRiskInput,
  ANC_RISK_LEVEL_ORDER,
  ANC_RISK_CONFIGS,
} from '@/config/anc-risk-rules';
import { AncRiskLevel } from '@/types/domain';

const baseInput: AncRiskInput = {
  age: 25,
  heightCm: 160,
  prePregnancyBmi: 22,
  gravida: 2,
  bpSystolic: 120,
  bpDiastolic: 80,
  o2Sat: 98,
  hct: 36,
  hb: 12,
  hosxpRiskIds: [],
  classifyingItems: [],
  rhNegative: false,
  hbsAgPositive: false,
  syphilisPositive: false,
  hivPositive: false,
  thalassemiaDisease: false,
  niptHighRisk: false,
};

describe('ANC Risk Rules Configuration', () => {
  it('exports rules array with at least 20 rules', () => {
    expect(ANC_RISK_RULES.length).toBeGreaterThanOrEqual(20);
  });

  it('every rule has required fields: id, level, labelTh, labelEn, source, evaluate', () => {
    for (const rule of ANC_RISK_RULES) {
      expect(rule.id).toBeTruthy();
      expect(['HR1', 'HR2', 'HR3']).toContain(rule.level);
      expect(rule.labelTh).toBeTruthy();
      expect(rule.labelEn).toBeTruthy();
      expect(['computed', 'hosxp_risk', 'hosxp_classifying', 'lab']).toContain(rule.source);
      expect(typeof rule.evaluate).toBe('function');
    }
  });

  describe('HR1 rules', () => {
    it('hr1_age triggers for age < 17', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_age')!;
      expect(rule.evaluate({ ...baseInput, age: 16 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, age: 17 })).toBe(false);
    });

    it('hr1_age triggers for age >= 35', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_age')!;
      expect(rule.evaluate({ ...baseInput, age: 35 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, age: 34 })).toBe(false);
    });

    it('hr1_height triggers for height < 145', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_height')!;
      expect(rule.evaluate({ ...baseInput, heightCm: 144 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, heightCm: 145 })).toBe(false);
    });

    it('hr1_bmi_low triggers for BMI < 18.5', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_bmi_low')!;
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 18 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 18.5 })).toBe(false);
    });

    it('hr1_bmi_high triggers for BMI >= 23 and < 30', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_bmi_high')!;
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 23 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 29.9 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 30 })).toBe(false);
    });

    it('hr1_o2sat triggers for O2sat < 95', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr1_o2sat')!;
      expect(rule.evaluate({ ...baseInput, o2Sat: 94 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, o2Sat: 95 })).toBe(false);
    });
  });

  describe('HR2 rules', () => {
    it('hr2_bmi triggers for BMI 30-40', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr2_bmi')!;
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 30 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 39.9 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 40 })).toBe(false);
    });

    it('hr2_bp triggers for diastolic >= 90 or systolic >= 140', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr2_bp')!;
      expect(rule.evaluate({ ...baseInput, bpDiastolic: 90 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, bpSystolic: 140 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, bpSystolic: 139, bpDiastolic: 89 })).toBe(false);
    });

    it('hr2_gravida triggers for gravida >= 5', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr2_gravida')!;
      expect(rule.evaluate({ ...baseInput, gravida: 5 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, gravida: 4 })).toBe(false);
    });

    it('hr2_hiv triggers for HIV positive', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr2_hiv')!;
      expect(rule.evaluate({ ...baseInput, hivPositive: true })).toBe(true);
      expect(rule.evaluate({ ...baseInput, hivPositive: false })).toBe(false);
    });
  });

  describe('HR3 rules', () => {
    it('hr3_bmi triggers for BMI >= 40', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr3_bmi')!;
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 40 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, prePregnancyBmi: 39.9 })).toBe(false);
    });

    it('hr3_anemia triggers for Hct < 28 or Hb < 9', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr3_anemia')!;
      expect(rule.evaluate({ ...baseInput, hct: 27 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, hb: 8.5 })).toBe(true);
      expect(rule.evaluate({ ...baseInput, hct: 28, hb: 9 })).toBe(false);
    });

    it('hr3_nipt triggers for NIPT high risk', () => {
      const rule = ANC_RISK_RULES.find((r) => r.id === 'hr3_nipt')!;
      expect(rule.evaluate({ ...baseInput, niptHighRisk: true })).toBe(true);
      expect(rule.evaluate({ ...baseInput, niptHighRisk: false })).toBe(false);
    });
  });

  describe('ANC_RISK_LEVEL_ORDER', () => {
    it('orders HR3 > HR2 > HR1 > LOW', () => {
      expect(ANC_RISK_LEVEL_ORDER[AncRiskLevel.HR3]).toBeGreaterThan(ANC_RISK_LEVEL_ORDER[AncRiskLevel.HR2]);
      expect(ANC_RISK_LEVEL_ORDER[AncRiskLevel.HR2]).toBeGreaterThan(ANC_RISK_LEVEL_ORDER[AncRiskLevel.HR1]);
      expect(ANC_RISK_LEVEL_ORDER[AncRiskLevel.HR1]).toBeGreaterThan(ANC_RISK_LEVEL_ORDER[AncRiskLevel.LOW]);
    });
  });

  describe('ANC_RISK_CONFIGS', () => {
    it('has Thai labels and colors for all 4 levels', () => {
      for (const level of [AncRiskLevel.LOW, AncRiskLevel.HR1, AncRiskLevel.HR2, AncRiskLevel.HR3]) {
        const config = ANC_RISK_CONFIGS[level];
        expect(config.labelTh).toBeTruthy();
        expect(config.labelEn).toBeTruthy();
        expect(config.color).toBeTruthy();
        expect(config.facilityTh).toBeTruthy();
        expect(config.providerTh).toBeTruthy();
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config/anc-risk-rules.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the ANC risk rules config**

Create `src/config/anc-risk-rules.ts`:

```typescript
// ANC risk classification rules — 4-tier model from provincial screening guidelines
// แนวทางการคัดกรองและจัดการความเสี่ยงหญิงตั้งครรภ์

import { AncRiskLevel } from '@/types/domain';

export interface AncRiskInput {
  age: number;
  heightCm: number;
  prePregnancyBmi: number;
  gravida: number;
  bpSystolic: number;
  bpDiastolic: number;
  o2Sat: number;
  hct: number;
  hb: number;
  hosxpRiskIds: number[];
  classifyingItems: { itemId: number; value: string }[];
  rhNegative: boolean;
  hbsAgPositive: boolean;
  syphilisPositive: boolean;
  hivPositive: boolean;
  thalassemiaDisease: boolean;
  niptHighRisk: boolean;
}

export interface AncRiskRule {
  id: string;
  level: 'HR1' | 'HR2' | 'HR3';
  labelTh: string;
  labelEn: string;
  source: 'computed' | 'hosxp_risk' | 'hosxp_classifying' | 'lab';
  evaluate: (data: AncRiskInput) => boolean;
}

export interface AncRiskLevelConfig {
  level: AncRiskLevel;
  labelTh: string;
  labelEn: string;
  color: string;
  bgColor: string;
  facilityTh: string;
  providerTh: string;
  action: string;
}

export const ANC_RISK_LEVEL_ORDER: Record<AncRiskLevel, number> = {
  [AncRiskLevel.LOW]: 0,
  [AncRiskLevel.HR1]: 1,
  [AncRiskLevel.HR2]: 2,
  [AncRiskLevel.HR3]: 3,
};

export const ANC_RISK_CONFIGS: Record<AncRiskLevel, AncRiskLevelConfig> = {
  [AncRiskLevel.LOW]: {
    level: AncRiskLevel.LOW,
    labelTh: 'ความเสี่ยงต่ำ',
    labelEn: 'Low Risk',
    color: '#22c55e',
    bgColor: '#dcfce7',
    facilityTh: 'รพ.สต.',
    providerTh: 'พยาบาล/จนท.',
    action: 'ฝากครรภ์ปกติ',
  },
  [AncRiskLevel.HR1]: {
    level: AncRiskLevel.HR1,
    labelTh: 'เสี่ยงสูง ระดับ 1',
    labelEn: 'High Risk 1',
    color: '#eab308',
    bgColor: '#fef9c3',
    facilityTh: 'รพ.ชุมชน',
    providerTh: 'แพทย์/พยาบาล',
    action: 'ฝากครรภ์ รพ.ชุมชน โดยแพทย์',
  },
  [AncRiskLevel.HR2]: {
    level: AncRiskLevel.HR2,
    labelTh: 'เสี่ยงสูง ระดับ 2',
    labelEn: 'High Risk 2',
    color: '#f97316',
    bgColor: '#ffedd5',
    facilityTh: 'รพช.แม่ข่าย/รพท.',
    providerTh: 'สูติแพทย์',
    action: 'ส่งพบสูติแพทย์ รพ.แม่ข่าย/รพท.',
  },
  [AncRiskLevel.HR3]: {
    level: AncRiskLevel.HR3,
    labelTh: 'เสี่ยงสูง ระดับ 3',
    labelEn: 'High Risk 3',
    color: '#ef4444',
    bgColor: '#fee2e2',
    facilityTh: 'รพ.จังหวัด/รพศ.',
    providerTh: 'สูติแพทย์/MFM',
    action: 'ส่งต่อ รพ.จังหวัด/รพศ. ดูแลโดย MFM',
  },
};

export const ANC_RISK_RULES: AncRiskRule[] = [
  // --- HR1 rules ---
  { id: 'hr1_age', level: 'HR1', labelTh: 'อายุ < 17 ปี หรือ ≥ 35 ปี', labelEn: 'Age <17 or >=35', source: 'computed', evaluate: (d) => d.age < 17 || d.age >= 35 },
  { id: 'hr1_bmi_low', level: 'HR1', labelTh: 'BMI < 18.5', labelEn: 'BMI <18.5 (underweight)', source: 'computed', evaluate: (d) => d.prePregnancyBmi < 18.5 },
  { id: 'hr1_bmi_high', level: 'HR1', labelTh: 'BMI ≥ 23 (< 30)', labelEn: 'BMI >=23 and <30 (overweight)', source: 'computed', evaluate: (d) => d.prePregnancyBmi >= 23 && d.prePregnancyBmi < 30 },
  { id: 'hr1_o2sat', level: 'HR1', labelTh: 'O2sat < 95%', labelEn: 'O2 saturation <95%', source: 'computed', evaluate: (d) => d.o2Sat < 95 },
  { id: 'hr1_height', level: 'HR1', labelTh: 'ส่วนสูง < 145 ซม.', labelEn: 'Height <145cm', source: 'computed', evaluate: (d) => d.heightCm < 145 },
  { id: 'hr1_vaginal_bleeding', level: 'HR1', labelTh: 'เลือดออกทางช่องคลอด', labelEn: 'Vaginal bleeding', source: 'hosxp_classifying', evaluate: (d) => d.classifyingItems.some((i) => i.itemId === 1 && i.value === 'Y') },
  { id: 'hr1_previous_stillbirth', level: 'HR1', labelTh: 'เคยมีทารกตายในครรภ์/เสียชีวิตแรกเกิด', labelEn: 'Previous stillbirth/neonatal death', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(1) },
  { id: 'hr1_previous_lbw', level: 'HR1', labelTh: 'เคยคลอดน้ำหนัก <2500g หรือ >4000g', labelEn: 'Previous birth weight <2500g or >4000g', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(2) },
  { id: 'hr1_preeclampsia_hx', level: 'HR1', labelTh: 'ประวัติครรภ์เป็นพิษ (ตนเอง/ครอบครัว)', labelEn: 'History of preeclampsia (self/family)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(3) },
  { id: 'hr1_gdm_hx', level: 'HR1', labelTh: 'ประวัติเบาหวานในครรภ์ (ตนเอง/ครอบครัว)', labelEn: 'History of GDM (self/family)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(4) },
  { id: 'hr1_abnormal_exam', level: 'HR1', labelTh: 'ตรวจร่างกายพบความผิดปกติ', labelEn: 'Abnormal physical examination', source: 'hosxp_classifying', evaluate: (d) => d.classifyingItems.some((i) => i.itemId === 2 && i.value === 'Y') },

  // --- HR2 rules ---
  { id: 'hr2_bmi', level: 'HR2', labelTh: 'BMI 30-40', labelEn: 'BMI 30-40 (obese)', source: 'computed', evaluate: (d) => d.prePregnancyBmi >= 30 && d.prePregnancyBmi < 40 },
  { id: 'hr2_bp', level: 'HR2', labelTh: 'ความดัน Diastolic ≥90 หรือ Systolic ≥140', labelEn: 'BP: Diastolic >=90 or Systolic >=140', source: 'computed', evaluate: (d) => d.bpDiastolic >= 90 || d.bpSystolic >= 140 },
  { id: 'hr2_gravida', level: 'HR2', labelTh: 'ครรภ์ที่ 5 เป็นต้นไป', labelEn: 'Gravida >=5', source: 'computed', evaluate: (d) => d.gravida >= 5 },
  { id: 'hr2_rh_negative', level: 'HR2', labelTh: 'Rh Negative', labelEn: 'Rh Negative', source: 'lab', evaluate: (d) => d.rhNegative },
  { id: 'hr2_hbsag', level: 'HR2', labelTh: 'HBsAg positive', labelEn: 'Hepatitis B positive', source: 'lab', evaluate: (d) => d.hbsAgPositive },
  { id: 'hr2_syphilis', level: 'HR2', labelTh: 'Syphilis positive', labelEn: 'Syphilis positive', source: 'lab', evaluate: (d) => d.syphilisPositive },
  { id: 'hr2_hiv', level: 'HR2', labelTh: 'HIV positive', labelEn: 'HIV positive', source: 'lab', evaluate: (d) => d.hivPositive },
  { id: 'hr2_thalassemia', level: 'HR2', labelTh: 'Thalassemia disease', labelEn: 'Thalassemia disease', source: 'lab', evaluate: (d) => d.thalassemiaDisease },
  { id: 'hr2_previous_preterm', level: 'HR2', labelTh: 'ประวัติคลอดก่อนกำหนด (<37 wks)', labelEn: 'Previous preterm delivery (<37 wks)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(5) },
  { id: 'hr2_previous_csection', level: 'HR2', labelTh: 'เคยผ่าตัดคลอด/ผ่าตัดมดลูก', labelEn: 'Previous C-section or uterine surgery', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(6) },
  { id: 'hr2_chronic_disease', level: 'HR2', labelTh: 'โรคประจำตัว (ความดัน/เบาหวาน/ไทรอยด์/โลหิตจาง/จิตเวช)', labelEn: 'Chronic disease (HT/DM/thyroid/anemia/psychiatric)', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(7) },
  { id: 'hr2_substance_abuse', level: 'HR2', labelTh: 'ติดสารเสพติด/สุรา/บุหรี่', labelEn: 'Substance abuse/alcohol/smoking', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(8) },
  { id: 'hr2_miscarriage', level: 'HR2', labelTh: 'เคยแท้ง ≥3 ครั้ง หรือแท้งไตรมาสที่ 2', labelEn: '>=3 miscarriages or 2nd trimester miscarriage', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(9) },
  { id: 'hr2_twin_dcda', level: 'HR2', labelTh: 'Twin DCDA', labelEn: 'Twin DCDA', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(10) },
  { id: 'hr2_chromosomal', level: 'HR2', labelTh: 'เคยคลอดทารกโครโมโซมผิดปกติ/พิการแต่กำเนิด', labelEn: 'Previous chromosomal/congenital abnormality', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(11) },
  { id: 'hr2_gyn_surgery', level: 'HR2', labelTh: 'ประวัติผ่าตัดทางนรีเวช', labelEn: 'Previous gynecologic surgery', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(12) },

  // --- HR3 rules ---
  { id: 'hr3_bmi', level: 'HR3', labelTh: 'BMI ≥ 40', labelEn: 'BMI >=40 (morbidly obese)', source: 'computed', evaluate: (d) => d.prePregnancyBmi >= 40 },
  { id: 'hr3_anemia', level: 'HR3', labelTh: 'Severe anemia (Hct<28% หรือ Hb<9)', labelEn: 'Severe anemia (Hct<28% or Hb<9)', source: 'computed', evaluate: (d) => d.hct < 28 || d.hb < 9 },
  { id: 'hr3_nipt', level: 'HR3', labelTh: 'NIPT หรือ Quad test high risk', labelEn: 'NIPT or Quad test high risk', source: 'lab', evaluate: (d) => d.niptHighRisk },
  { id: 'hr3_twin_mcda', level: 'HR3', labelTh: 'Twin MCDA/MADA หรือ Triplet ขึ้นไป', labelEn: 'Twin MCDA/MADA or Triplet+', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(13) },
  { id: 'hr3_abnormal_us', level: 'HR3', labelTh: 'ผลตรวจทารกในครรภ์ผิดปกติ (Abnormal U/S)', labelEn: 'Abnormal fetal ultrasound', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(14) },
  { id: 'hr3_pelvic_mass', level: 'HR3', labelTh: 'มีก้อนในอุ้งเชิงกราน', labelEn: 'Pelvic mass', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(15) },
  { id: 'hr3_placenta_accreta', level: 'HR3', labelTh: 'ภาวะรกเกาะแน่น', labelEn: 'Placenta accreta', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(16) },
  { id: 'hr3_heart_disease', level: 'HR3', labelTh: 'โรคหัวใจ WHO ≥2', labelEn: 'Heart disease WHO class >=2', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(17) },
  { id: 'hr3_renal_autoimmune', level: 'HR3', labelTh: 'โรคไต/APS/SLE', labelEn: 'Renal disease/APS/SLE', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(18) },
  { id: 'hr3_uncontrolled_psych', level: 'HR3', labelTh: 'โรคจิตเวชที่ควบคุมไม่ได้', labelEn: 'Uncontrolled psychiatric disease', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(19) },
  { id: 'hr3_beyond_capability', level: 'HR3', labelTh: 'โรคทางอายุรกรรมที่เกินศักยภาพ รพ.แม่ข่าย', labelEn: 'Medical condition beyond facility capability', source: 'hosxp_risk', evaluate: (d) => d.hosxpRiskIds.includes(20) },
];

export function classifyAncRisk(input: AncRiskInput): { level: AncRiskLevel; triggeredRules: string[] } {
  const triggered: string[] = [];
  let highestLevel = AncRiskLevel.LOW;

  for (const rule of ANC_RISK_RULES) {
    if (rule.evaluate(input)) {
      triggered.push(rule.id);
      const ruleLevel = AncRiskLevel[rule.level as keyof typeof AncRiskLevel];
      if (ANC_RISK_LEVEL_ORDER[ruleLevel] > ANC_RISK_LEVEL_ORDER[highestLevel]) {
        highestLevel = ruleLevel;
      }
    }
  }

  return { level: highestLevel, triggeredRules: triggered };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/config/anc-risk-rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/anc-risk-rules.ts tests/unit/config/anc-risk-rules.test.ts
git commit -m "feat: add configurable ANC risk classification rules — 4-tier model with 38 rules"
```

---

### Task 4: Hospital Capabilities Configuration

**Files:**
- Create: `src/config/hospital-capabilities.ts`
- Test: `tests/unit/config/hospital-capabilities.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/config/hospital-capabilities.test.ts
import { describe, it, expect } from 'vitest';
import {
  HOSPITAL_CAPABILITIES,
  findCapableHospital,
  type HospitalCapability,
} from '@/config/hospital-capabilities';
import { AncRiskLevel } from '@/types/domain';

describe('Hospital Capabilities Configuration', () => {
  it('has capabilities for key hospitals', () => {
    const kkHosp = HOSPITAL_CAPABILITIES.find((h) => h.hcode === '10670');
    expect(kkHosp).toBeDefined();
    expect(kkHosp!.name).toBe('รพ.ขอนแก่น');
    expect(kkHosp!.referTo).toBeNull();

    const sirin = HOSPITAL_CAPABILITIES.find((h) => h.hcode === '10675');
    expect(sirin).toBeDefined();
    expect(sirin!.minGaWeeks).toBe(32);
    expect(sirin!.minFetalWeightG).toBe(1500);
  });

  it('รพ.พล has GA>=35, FW>=2000, refers to รพ.ขอนแก่น', () => {
    const phon = HOSPITAL_CAPABILITIES.find((h) => h.hcode === '10679');
    expect(phon).toBeDefined();
    expect(phon!.minGaWeeks).toBe(35);
    expect(phon!.minFetalWeightG).toBe(2000);
    expect(phon!.referTo).toBe('10670');
  });

  it('รพ.บ้านไผ่ has GA>=34, FW>=1800', () => {
    const banphai = HOSPITAL_CAPABILITIES.find((h) => h.hcode === '10674');
    expect(banphai).toBeDefined();
    expect(banphai!.minGaWeeks).toBe(34);
    expect(banphai!.minFetalWeightG).toBe(1800);
  });

  describe('findCapableHospital', () => {
    it('returns null for terminal hospital (รพ.ขอนแก่น)', () => {
      const result = findCapableHospital('10670', 28, 1200, AncRiskLevel.HR3);
      expect(result).toBeNull();
    });

    it('returns referTo hospital when case exceeds capability', () => {
      // รพ.พล can handle GA>=35, but patient is GA 30
      const result = findCapableHospital('10679', 30, 1500, AncRiskLevel.LOW);
      expect(result).toBe('10670'); // refers to รพ.ขอนแก่น
    });

    it('returns null when case is within capability', () => {
      // รพ.พล can handle GA>=35, patient is GA 37
      const result = findCapableHospital('10679', 37, 2500, AncRiskLevel.LOW);
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config/hospital-capabilities.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create hospital capabilities config**

Create `src/config/hospital-capabilities.ts`:

```typescript
// Hospital capability thresholds from provincial referral hierarchy
// ระบบการส่งต่อหญิงตั้งครรภ์ จ.ขอนแก่น

import { AncRiskLevel } from '@/types/domain';
import { ANC_RISK_LEVEL_ORDER } from './anc-risk-rules';

export interface HospitalCapability {
  hcode: string;
  name: string;
  minGaWeeks: number;
  minFetalWeightG: number;
  maxRiskLevel: AncRiskLevel;
  referTo: string | null;
}

export const HOSPITAL_CAPABILITIES: HospitalCapability[] = [
  // Provincial hospital — terminal (handles everything)
  { hcode: '10670', name: 'รพ.ขอนแก่น', minGaWeeks: 0, minFetalWeightG: 0, maxRiskLevel: AncRiskLevel.HR3, referTo: null },
  // Regional hubs
  { hcode: '10675', name: 'รพ.สิรินธร', minGaWeeks: 32, minFetalWeightG: 1500, maxRiskLevel: AncRiskLevel.HR3, referTo: '10670' },
  { hcode: '10674', name: 'รพ.บ้านไผ่', minGaWeeks: 34, minFetalWeightG: 1800, maxRiskLevel: AncRiskLevel.HR3, referTo: '10670' },
  { hcode: '10679', name: 'รพ.พล', minGaWeeks: 35, minFetalWeightG: 2000, maxRiskLevel: AncRiskLevel.HR3, referTo: '10670' },
  { hcode: '11446', name: 'รพ.ชุมแพ', minGaWeeks: 32, minFetalWeightG: 1500, maxRiskLevel: AncRiskLevel.HR3, referTo: '10670' },
  { hcode: '10998', name: 'รพ.ศรีนครินทร์', minGaWeeks: 0, minFetalWeightG: 0, maxRiskLevel: AncRiskLevel.HR3, referTo: null },
  // Community hospitals — refer to regional hubs
  { hcode: '10671', name: 'รพ.หนองเรือ', minGaWeeks: 35, minFetalWeightG: 2000, maxRiskLevel: AncRiskLevel.HR2, referTo: '10675' },
  { hcode: '10672', name: 'รพ.ชุมแพ(เดิม)', minGaWeeks: 35, minFetalWeightG: 2000, maxRiskLevel: AncRiskLevel.HR2, referTo: '11446' },
  { hcode: '10673', name: 'รพ.สีชมพู', minGaWeeks: 35, minFetalWeightG: 2000, maxRiskLevel: AncRiskLevel.HR2, referTo: '11446' },
  { hcode: '10676', name: 'รพ.น้ำพอง', minGaWeeks: 35, minFetalWeightG: 2000, maxRiskLevel: AncRiskLevel.HR2, referTo: '10670' },
  { hcode: '10677', name: 'รพ.อุบลรัตน์', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10676' },
  { hcode: '10678', name: 'รพ.บ้านฝาง', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10674' },
  { hcode: '10680', name: 'รพ.แวงใหญ่', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10679' },
  { hcode: '10681', name: 'รพ.แวงน้อย', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10679' },
  { hcode: '10682', name: 'รพ.หนองสองห้อง', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10679' },
  { hcode: '10683', name: 'รพ.ภูเวียง', minGaWeeks: 35, minFetalWeightG: 2000, maxRiskLevel: AncRiskLevel.HR2, referTo: '11446' },
  { hcode: '10684', name: 'รพ.มัญจาคีรี', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10679' },
  { hcode: '10685', name: 'รพ.ชนบท', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10674' },
  { hcode: '10686', name: 'รพ.เขาสวนกวาง', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10676' },
  { hcode: '10687', name: 'รพ.ภูผาม่าน', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '11446' },
  { hcode: '10688', name: 'รพ.ซำสูง', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10676' },
  { hcode: '10689', name: 'รพ.โคกโพธิ์ไชย', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10674' },
  { hcode: '10690', name: 'รพ.หนองนาคำ', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '11446' },
  { hcode: '11445', name: 'รพ.บ้านแฮด', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10674' },
  { hcode: '10999', name: 'รพ.พระยืน', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '10675' },
  { hcode: '11000', name: 'รพ.เวียงเก่า', minGaWeeks: 36, minFetalWeightG: 2200, maxRiskLevel: AncRiskLevel.HR1, referTo: '11446' },
];

export function getHospitalCapability(hcode: string): HospitalCapability | undefined {
  return HOSPITAL_CAPABILITIES.find((h) => h.hcode === hcode);
}

export function findCapableHospital(
  currentHcode: string,
  gaWeeks: number,
  fetalWeightG: number,
  riskLevel: AncRiskLevel,
): string | null {
  const current = getHospitalCapability(currentHcode);
  if (!current) return null;

  const exceedsGa = gaWeeks < current.minGaWeeks;
  const exceedsFw = fetalWeightG < current.minFetalWeightG;
  const exceedsRisk = ANC_RISK_LEVEL_ORDER[riskLevel] > ANC_RISK_LEVEL_ORDER[current.maxRiskLevel];

  if (exceedsGa || exceedsFw || exceedsRisk) {
    return current.referTo;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/config/hospital-capabilities.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/hospital-capabilities.ts tests/unit/config/hospital-capabilities.test.ts
git commit -m "feat: add hospital capability thresholds for 26 KK province hospitals"
```

---

## Phase 2: Core Services (Tasks 5-8)

### Task 5: ANC Risk Service

**Files:**
- Create: `src/services/anc-risk.ts`
- Test: `tests/unit/services/anc-risk.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/anc-risk.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateAncRisk } from '@/services/anc-risk';
import { AncRiskLevel } from '@/types/domain';
import type { AncRiskInput } from '@/config/anc-risk-rules';

const baseInput: AncRiskInput = {
  age: 25, heightCm: 160, prePregnancyBmi: 22, gravida: 2,
  bpSystolic: 120, bpDiastolic: 80, o2Sat: 98, hct: 36, hb: 12,
  hosxpRiskIds: [], classifyingItems: [],
  rhNegative: false, hbsAgPositive: false, syphilisPositive: false,
  hivPositive: false, thalassemiaDisease: false, niptHighRisk: false,
};

describe('ANC Risk Service', () => {
  describe('evaluateAncRisk', () => {
    it('returns LOW when no risk factors', () => {
      const result = evaluateAncRisk(baseInput);
      expect(result.level).toBe(AncRiskLevel.LOW);
      expect(result.triggeredRules).toEqual([]);
      expect(result.recommendation.facilityTh).toBe('รพ.สต.');
    });

    it('returns HR1 for age < 17', () => {
      const result = evaluateAncRisk({ ...baseInput, age: 16 });
      expect(result.level).toBe(AncRiskLevel.HR1);
      expect(result.triggeredRules).toContain('hr1_age');
    });

    it('returns HR2 when HR2 rule triggers (overrides HR1)', () => {
      const result = evaluateAncRisk({ ...baseInput, age: 16, hivPositive: true });
      expect(result.level).toBe(AncRiskLevel.HR2);
      expect(result.triggeredRules).toContain('hr1_age');
      expect(result.triggeredRules).toContain('hr2_hiv');
    });

    it('returns HR3 as highest level when multiple levels trigger', () => {
      const result = evaluateAncRisk({
        ...baseInput,
        age: 36,               // HR1
        hivPositive: true,      // HR2
        prePregnancyBmi: 42,    // HR3
      });
      expect(result.level).toBe(AncRiskLevel.HR3);
      expect(result.triggeredRules).toContain('hr1_age');
      expect(result.triggeredRules).toContain('hr2_hiv');
      expect(result.triggeredRules).toContain('hr3_bmi');
      expect(result.recommendation.facilityTh).toBe('รพ.จังหวัด/รพศ.');
    });

    it('returns all triggered rules even at lower levels', () => {
      const result = evaluateAncRisk({
        ...baseInput,
        age: 16,             // HR1
        heightCm: 140,       // HR1
        prePregnancyBmi: 17, // HR1
      });
      expect(result.level).toBe(AncRiskLevel.HR1);
      expect(result.triggeredRules.length).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/anc-risk.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the ANC risk service**

Create `src/services/anc-risk.ts`:

```typescript
// ANC risk classification service — evaluates rules and returns risk assessment
import { AncRiskLevel } from '@/types/domain';
import {
  ANC_RISK_RULES,
  ANC_RISK_LEVEL_ORDER,
  ANC_RISK_CONFIGS,
  type AncRiskInput,
  type AncRiskLevelConfig,
} from '@/config/anc-risk-rules';

export interface AncRiskResult {
  level: AncRiskLevel;
  triggeredRules: string[];
  recommendation: AncRiskLevelConfig;
}

export function evaluateAncRisk(input: AncRiskInput): AncRiskResult {
  const triggeredRules: string[] = [];
  let highestLevel = AncRiskLevel.LOW;

  for (const rule of ANC_RISK_RULES) {
    if (rule.evaluate(input)) {
      triggeredRules.push(rule.id);
      const ruleLevel = AncRiskLevel[rule.level as keyof typeof AncRiskLevel];
      if (ANC_RISK_LEVEL_ORDER[ruleLevel] > ANC_RISK_LEVEL_ORDER[highestLevel]) {
        highestLevel = ruleLevel;
      }
    }
  }

  return {
    level: highestLevel,
    triggeredRules,
    recommendation: ANC_RISK_CONFIGS[highestLevel],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/anc-risk.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/anc-risk.ts tests/unit/services/anc-risk.test.ts
git commit -m "feat: add ANC risk evaluation service — 4-tier classification with rule engine"
```

---

### Task 6: Journey Lifecycle Service

**Files:**
- Create: `src/services/journey.ts`
- Test: `tests/unit/services/journey.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/journey.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  createJourney,
  getJourneyByHn,
  transitionToLabor,
  transitionToDelivered,
  getActiveJourneys,
} from '@/services/journey';
import { CareStage, AncRiskLevel } from '@/types/domain';

describe('Journey Lifecycle Service', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-001';

  beforeEach(async () => {
    db = createSqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    // Seed a hospital
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', 1, 'ONLINE', datetime('now'), datetime('now'))`
    );
  });

  describe('createJourney', () => {
    it('creates a journey with PREGNANCY stage', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: '12345',
        personAncId: 100,
        name: 'Test Patient',
        cid: null,
        cidHash: null,
        age: 25,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      expect(journey.id).toBeTruthy();
      expect(journey.careStage).toBe(CareStage.PREGNANCY);
      expect(journey.hn).toBe('12345');
      expect(journey.gravida).toBe(1);
    });
  });

  describe('getJourneyByHn', () => {
    it('finds existing journey by HN and hospital', async () => {
      await createJourney(db, {
        hospitalId, hn: '12345', personAncId: 100,
        name: 'Test', cid: null, cidHash: null,
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      const found = await getJourneyByHn(db, '12345', hospitalId);
      expect(found).not.toBeNull();
      expect(found!.hn).toBe('12345');
    });

    it('returns null when no journey exists', async () => {
      const found = await getJourneyByHn(db, '99999', hospitalId);
      expect(found).toBeNull();
    });
  });

  describe('transitionToLabor', () => {
    it('updates care_stage to LABOR', async () => {
      const journey = await createJourney(db, {
        hospitalId, hn: '12345', personAncId: 100,
        name: 'Test', cid: null, cidHash: null,
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.HR1,
      });

      await transitionToLabor(db, journey.id);

      const updated = await getJourneyByHn(db, '12345', hospitalId);
      expect(updated!.careStage).toBe(CareStage.LABOR);
    });
  });

  describe('transitionToDelivered', () => {
    it('updates care_stage to DELIVERED', async () => {
      const journey = await createJourney(db, {
        hospitalId, hn: '12345', personAncId: 100,
        name: 'Test', cid: null, cidHash: null,
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await transitionToLabor(db, journey.id);
      await transitionToDelivered(db, journey.id);

      const updated = await getJourneyByHn(db, '12345', hospitalId);
      expect(updated!.careStage).toBe(CareStage.DELIVERED);
    });
  });

  describe('getActiveJourneys', () => {
    it('returns journeys filtered by stage', async () => {
      await createJourney(db, {
        hospitalId, hn: '001', personAncId: 1,
        name: 'P1', cid: null, cidHash: null,
        age: 25, gravida: 1, para: 0,
        lmp: '2025-06-01', edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      const j2 = await createJourney(db, {
        hospitalId, hn: '002', personAncId: 2,
        name: 'P2', cid: null, cidHash: null,
        age: 30, gravida: 2, para: 1,
        lmp: '2025-07-01', edc: '2026-04-07',
        ancRiskLevel: AncRiskLevel.HR2,
      });
      await transitionToLabor(db, j2.id);

      const pregnancies = await getActiveJourneys(db, hospitalId, { stage: CareStage.PREGNANCY });
      expect(pregnancies.length).toBe(1);
      expect(pregnancies[0].hn).toBe('001');

      const labors = await getActiveJourneys(db, hospitalId, { stage: CareStage.LABOR });
      expect(labors.length).toBe(1);
      expect(labors[0].hn).toBe('002');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/journey.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the journey service**

Create `src/services/journey.ts`:

```typescript
// Maternal journey lifecycle management
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { CareStage, AncRiskLevel } from '@/types/domain';
import type { MaternalJourney } from '@/types/domain';

export interface CreateJourneyInput {
  hospitalId: string;
  hn: string;
  personAncId: number | null;
  name: string;
  cid: string | null;
  cidHash: string | null;
  age: number;
  gravida: number;
  para: number;
  lmp: string | null;
  edc: string | null;
  ancRiskLevel: AncRiskLevel;
}

export async function createJourney(
  db: DatabaseAdapter,
  input: CreateJourneyInput,
): Promise<MaternalJourney> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO maternal_journeys (id, hospital_id, current_hospital_id, hn, person_anc_id, name, cid, cid_hash, age, gravida, para, lmp, edc, care_stage, anc_risk_level, anc_visit_count, registered_at, stage_changed_at, synced_at, created_at, updated_at)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, $15, $15, $15, $15, $15)`,
    [id, input.hospitalId, input.hn, input.personAncId, input.name, input.cid, input.cidHash, input.age, input.gravida, input.para, input.lmp, input.edc, CareStage.PREGNANCY, input.ancRiskLevel, now],
  );

  return {
    id,
    hospitalId: input.hospitalId,
    currentHospitalId: input.hospitalId,
    hn: input.hn,
    personAncId: input.personAncId,
    name: input.name,
    cid: input.cid,
    cidHash: input.cidHash,
    age: input.age,
    gravida: input.gravida,
    para: input.para,
    lmp: input.lmp,
    edc: input.edc,
    careStage: CareStage.PREGNANCY,
    ancRiskLevel: input.ancRiskLevel,
    ancVisitCount: 0,
    lastAncDate: null,
    gaWeeks: null,
    registeredAt: new Date(now),
    stageChangedAt: new Date(now),
    syncedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

export async function getJourneyByHn(
  db: DatabaseAdapter,
  hn: string,
  hospitalId: string,
): Promise<MaternalJourney | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM maternal_journeys WHERE hn = $1 AND hospital_id = $2 AND care_stage IN ('PREGNANCY', 'LABOR') ORDER BY created_at DESC LIMIT 1`,
    [hn, hospitalId],
  );
  if (rows.length === 0) return null;
  return mapRowToJourney(rows[0]);
}

export async function transitionToLabor(db: DatabaseAdapter, journeyId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE maternal_journeys SET care_stage = $1, stage_changed_at = $2, updated_at = $2 WHERE id = $3`,
    [CareStage.LABOR, now, journeyId],
  );
}

export async function transitionToDelivered(db: DatabaseAdapter, journeyId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE maternal_journeys SET care_stage = $1, stage_changed_at = $2, updated_at = $2 WHERE id = $3`,
    [CareStage.DELIVERED, now, journeyId],
  );
}

export interface JourneyFilter {
  stage?: CareStage;
  riskLevel?: AncRiskLevel;
}

export async function getActiveJourneys(
  db: DatabaseAdapter,
  hospitalId: string,
  filter: JourneyFilter = {},
): Promise<MaternalJourney[]> {
  let sql = `SELECT * FROM maternal_journeys WHERE current_hospital_id = $1`;
  const params: unknown[] = [hospitalId];
  let paramIdx = 2;

  if (filter.stage) {
    sql += ` AND care_stage = $${paramIdx}`;
    params.push(filter.stage);
    paramIdx++;
  }
  if (filter.riskLevel) {
    sql += ` AND anc_risk_level = $${paramIdx}`;
    params.push(filter.riskLevel);
    paramIdx++;
  }

  sql += ` ORDER BY created_at DESC`;

  const rows = await db.query<Record<string, unknown>>(sql, params);
  return rows.map(mapRowToJourney);
}

function mapRowToJourney(row: Record<string, unknown>): MaternalJourney {
  return {
    id: row.id as string,
    hospitalId: row.hospital_id as string,
    currentHospitalId: row.current_hospital_id as string,
    hn: row.hn as string,
    personAncId: row.person_anc_id as number | null,
    name: row.name as string,
    cid: row.cid as string | null,
    cidHash: row.cid_hash as string | null,
    age: row.age as number,
    gravida: row.gravida as number,
    para: row.para as number,
    lmp: row.lmp as string | null,
    edc: row.edc as string | null,
    careStage: row.care_stage as CareStage,
    ancRiskLevel: row.anc_risk_level as AncRiskLevel,
    ancVisitCount: row.anc_visit_count as number,
    lastAncDate: row.last_anc_date as string | null,
    gaWeeks: row.ga_weeks as number | null,
    registeredAt: new Date(row.registered_at as string),
    stageChangedAt: new Date(row.stage_changed_at as string),
    syncedAt: new Date(row.synced_at as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/journey.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/journey.ts tests/unit/services/journey.test.ts
git commit -m "feat: add journey lifecycle service — create, transition, query by HN"
```

---

### Task 7: Referral Workflow Service

**Files:**
- Create: `src/services/referral.ts`
- Test: `tests/unit/services/referral.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/referral.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import type { DatabaseAdapter } from '@/db/adapter';
import {
  initiateReferral,
  acceptReferral,
  rejectReferral,
  markInTransit,
  confirmArrival,
  getPendingReferrals,
} from '@/services/referral';
import { ReferralStatus, UrgencyLevel, AncRiskLevel } from '@/types/domain';
import { createJourney } from '@/services/journey';

describe('Referral Workflow Service', () => {
  let db: DatabaseAdapter;
  const fromHospId = 'hosp-from';
  const toHospId = 'hosp-to';
  let journeyId: string;

  beforeEach(async () => {
    db = createSqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at) VALUES
       ('${fromHospId}', '10679', 'รพ.พล', 'M2', 1, 'ONLINE', datetime('now'), datetime('now')),
       ('${toHospId}', '10670', 'รพ.ขอนแก่น', 'A_S', 1, 'ONLINE', datetime('now'), datetime('now'))`
    );
    const journey = await createJourney(db, {
      hospitalId: fromHospId, hn: '12345', personAncId: 1,
      name: 'Test', cid: null, cidHash: null,
      age: 30, gravida: 1, para: 0,
      lmp: '2025-06-01', edc: '2026-03-08',
      ancRiskLevel: AncRiskLevel.HR3,
    });
    journeyId = journey.id;
  });

  it('initiateReferral creates a referral with INITIATED status', async () => {
    const ref = await initiateReferral(db, {
      journeyId, fromHospitalId: fromHospId, toHospitalId: toHospId,
      reason: 'HR3 exceeds capability', urgencyLevel: UrgencyLevel.URGENT,
    });
    expect(ref.status).toBe(ReferralStatus.INITIATED);
    expect(ref.fromHospitalId).toBe(fromHospId);
    expect(ref.toHospitalId).toBe(toHospId);
  });

  it('acceptReferral transitions to ACCEPTED', async () => {
    const ref = await initiateReferral(db, {
      journeyId, fromHospitalId: fromHospId, toHospitalId: toHospId,
      reason: 'HR3', urgencyLevel: UrgencyLevel.URGENT,
    });
    const updated = await acceptReferral(db, ref.id, 'user-001');
    expect(updated.status).toBe(ReferralStatus.ACCEPTED);
    expect(updated.acceptedAt).not.toBeNull();
  });

  it('rejectReferral transitions to REJECTED', async () => {
    const ref = await initiateReferral(db, {
      journeyId, fromHospitalId: fromHospId, toHospitalId: toHospId,
      reason: 'HR3', urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const updated = await rejectReferral(db, ref.id, 'No bed available');
    expect(updated.status).toBe(ReferralStatus.REJECTED);
    expect(updated.rejectionReason).toBe('No bed available');
  });

  it('full lifecycle: INITIATED → ACCEPTED → IN_TRANSIT → ARRIVED', async () => {
    const ref = await initiateReferral(db, {
      journeyId, fromHospitalId: fromHospId, toHospitalId: toHospId,
      reason: 'Test', urgencyLevel: UrgencyLevel.EMERGENCY,
    });
    await acceptReferral(db, ref.id, 'user-001');
    await markInTransit(db, ref.id, 'ambulance');
    const arrived = await confirmArrival(db, ref.id, 'AN-9999');
    expect(arrived.status).toBe(ReferralStatus.ARRIVED);
    expect(arrived.arrivedAt).not.toBeNull();
  });

  it('getPendingReferrals returns outbound referrals', async () => {
    await initiateReferral(db, {
      journeyId, fromHospitalId: fromHospId, toHospitalId: toHospId,
      reason: 'Test', urgencyLevel: UrgencyLevel.ROUTINE,
    });
    const pending = await getPendingReferrals(db, fromHospId, 'out');
    expect(pending.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/referral.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the referral service**

Create `src/services/referral.ts`:

```typescript
// Referral workflow service — state machine for patient referrals
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import { ReferralStatus, UrgencyLevel } from '@/types/domain';
import type { CachedReferral } from '@/types/domain';

export interface InitiateReferralInput {
  journeyId: string;
  fromHospitalId: string;
  toHospitalId: string;
  reason: string;
  diagnosisCode?: string;
  urgencyLevel: UrgencyLevel;
  initiatedBy?: string;
}

export async function initiateReferral(
  db: DatabaseAdapter,
  input: InitiateReferralInput,
): Promise<CachedReferral> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO cached_referrals (id, journey_id, from_hospital_id, to_hospital_id, status, reason, diagnosis_code, urgency_level, initiated_at, initiated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $9)`,
    [id, input.journeyId, input.fromHospitalId, input.toHospitalId, ReferralStatus.INITIATED, input.reason, input.diagnosisCode ?? null, input.urgencyLevel, now, input.initiatedBy ?? null],
  );

  return getReferralById(db, id);
}

export async function acceptReferral(
  db: DatabaseAdapter,
  referralId: string,
  acceptedBy: string,
): Promise<CachedReferral> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = $1, accepted_at = $2, accepted_by = $3, updated_at = $2 WHERE id = $4`,
    [ReferralStatus.ACCEPTED, now, acceptedBy, referralId],
  );
  return getReferralById(db, referralId);
}

export async function rejectReferral(
  db: DatabaseAdapter,
  referralId: string,
  reason: string,
  suggestedAlternativeId?: string,
): Promise<CachedReferral> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = $1, rejected_at = $2, rejection_reason = $3, suggested_alternative_id = $4, updated_at = $2 WHERE id = $5`,
    [ReferralStatus.REJECTED, now, reason, suggestedAlternativeId ?? null, referralId],
  );
  return getReferralById(db, referralId);
}

export async function markInTransit(
  db: DatabaseAdapter,
  referralId: string,
  transportMode: string,
): Promise<CachedReferral> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = $1, departed_at = $2, transport_mode = $3, updated_at = $2 WHERE id = $4`,
    [ReferralStatus.IN_TRANSIT, now, transportMode, referralId],
  );
  return getReferralById(db, referralId);
}

export async function confirmArrival(
  db: DatabaseAdapter,
  referralId: string,
  receivingAn: string,
): Promise<CachedReferral> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE cached_referrals SET status = $1, arrived_at = $2, updated_at = $2 WHERE id = $3`,
    [ReferralStatus.ARRIVED, now, referralId],
  );

  // Update journey's current_hospital_id to receiving hospital
  const referral = await getReferralById(db, referralId);
  await db.execute(
    `UPDATE maternal_journeys SET current_hospital_id = $1, updated_at = $2 WHERE id = $3`,
    [referral.toHospitalId, now, referral.journeyId],
  );

  return referral;
}

export async function getPendingReferrals(
  db: DatabaseAdapter,
  hospitalId: string,
  direction: 'in' | 'out',
): Promise<CachedReferral[]> {
  const column = direction === 'out' ? 'from_hospital_id' : 'to_hospital_id';
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_referrals WHERE ${column} = $1 AND status NOT IN ('ARRIVED', 'REJECTED') ORDER BY initiated_at DESC`,
    [hospitalId],
  );
  return rows.map(mapRowToReferral);
}

async function getReferralById(db: DatabaseAdapter, id: string): Promise<CachedReferral> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_referrals WHERE id = $1`,
    [id],
  );
  return mapRowToReferral(rows[0]);
}

function mapRowToReferral(row: Record<string, unknown>): CachedReferral {
  return {
    id: row.id as string,
    journeyId: row.journey_id as string,
    referNumber: row.refer_number as string | null,
    fromHospitalId: row.from_hospital_id as string,
    toHospitalId: row.to_hospital_id as string,
    status: row.status as ReferralStatus,
    reason: row.reason as string,
    diagnosisCode: row.diagnosis_code as string | null,
    urgencyLevel: row.urgency_level as UrgencyLevel,
    rejectionReason: row.rejection_reason as string | null,
    suggestedAlternativeId: row.suggested_alternative_id as string | null,
    transportMode: row.transport_mode as string | null,
    initiatedAt: new Date(row.initiated_at as string),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at as string) : null,
    departedAt: row.departed_at ? new Date(row.departed_at as string) : null,
    arrivedAt: row.arrived_at ? new Date(row.arrived_at as string) : null,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at as string) : null,
    initiatedBy: row.initiated_by as string | null,
    acceptedBy: row.accepted_by as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/referral.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/referral.ts tests/unit/services/referral.test.ts
git commit -m "feat: add referral workflow service — full state machine lifecycle"
```

---

### Task 8: Newborn Service

**Files:**
- Create: `src/services/newborn.ts`
- Test: `tests/unit/services/newborn.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/services/newborn.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables';
import type { DatabaseAdapter } from '@/db/adapter';
import { upsertNewborn, getNewbornKPIs } from '@/services/newborn';
import { createJourney } from '@/services/journey';
import { AncRiskLevel } from '@/types/domain';

describe('Newborn Service', () => {
  let db: DatabaseAdapter;
  const hospitalId = 'hosp-001';
  let journeyId: string;

  beforeEach(async () => {
    db = createSqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES ('${hospitalId}', '10670', 'รพ.ขอนแก่น', 'A_S', 1, 'ONLINE', datetime('now'), datetime('now'))`
    );
    const journey = await createJourney(db, {
      hospitalId, hn: '12345', personAncId: 1,
      name: 'Test', cid: null, cidHash: null,
      age: 28, gravida: 1, para: 0,
      lmp: '2025-06-01', edc: '2026-03-08',
      ancRiskLevel: AncRiskLevel.LOW,
    });
    journeyId = journey.id;
  });

  describe('upsertNewborn', () => {
    it('creates newborn record linked to journey', async () => {
      const nb = await upsertNewborn(db, {
        journeyId,
        infantNumber: 1,
        sex: 'M',
        birthWeightG: 3200,
        bodyLengthCm: 50,
        headCircumCm: 34,
        apgar1min: 8,
        apgar5min: 9,
        apgar10min: 10,
        resuscitation: { ppv: false, et_tube: false, chest_pump: false, oxygen_box: false, narcan: false },
        vaccinations: { bcg: true, hepb: true, vitk: true, eye_paste: true, azt: false },
        bornAt: '2026-03-08T10:30:00Z',
      });
      expect(nb.id).toBeTruthy();
      expect(nb.birthWeightG).toBe(3200);
      expect(nb.apgar1min).toBe(8);
    });
  });

  describe('getNewbornKPIs', () => {
    it('calculates LBW rate and Apgar stats', async () => {
      await upsertNewborn(db, {
        journeyId, infantNumber: 1, sex: 'F',
        birthWeightG: 2400, apgar1min: 6, apgar5min: 7,
        resuscitation: {}, vaccinations: {},
        bornAt: '2026-03-08T10:30:00Z',
      });
      // Need a second journey for another newborn
      const j2 = await createJourney(db, {
        hospitalId, hn: '12346', personAncId: 2,
        name: 'Test2', cid: null, cidHash: null,
        age: 30, gravida: 2, para: 1,
        lmp: '2025-06-15', edc: '2026-03-22',
        ancRiskLevel: AncRiskLevel.LOW,
      });
      await upsertNewborn(db, {
        journeyId: j2.id, infantNumber: 1, sex: 'M',
        birthWeightG: 3500, apgar1min: 9, apgar5min: 10,
        resuscitation: {}, vaccinations: {},
        bornAt: '2026-03-09T14:00:00Z',
      });

      const kpis = await getNewbornKPIs(db);
      expect(kpis.totalBirths).toBe(2);
      expect(kpis.lbwCount).toBe(1); // 2400g < 2500g
      expect(kpis.avgBirthWeightG).toBe(2950);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/newborn.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the newborn service**

Create `src/services/newborn.ts`:

```typescript
// Newborn birth outcome tracking and KPIs
import { randomUUID } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import type { CachedNewborn } from '@/types/domain';

export interface UpsertNewbornInput {
  journeyId: string;
  infantNumber: number;
  sex?: string;
  birthWeightG?: number;
  bodyLengthCm?: number;
  headCircumCm?: number;
  temperature?: number;
  heartRate?: number;
  respiratoryRate?: number;
  apgar1min?: number;
  apgar5min?: number;
  apgar10min?: number;
  resuscitation: Record<string, boolean>;
  vaccinations: Record<string, boolean>;
  infantIcd10?: string;
  infantHn?: string;
  infantAn?: string;
  dischargeStatus?: string;
  bornAt: string;
}

export async function upsertNewborn(
  db: DatabaseAdapter,
  input: UpsertNewbornInput,
): Promise<CachedNewborn> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const resuscJson = JSON.stringify(input.resuscitation);
  const vaccJson = JSON.stringify(input.vaccinations);

  await db.execute(
    `INSERT INTO cached_newborns (id, journey_id, infant_number, sex, birth_weight_g, body_length_cm, head_circum_cm, temperature, heart_rate, respiratory_rate, apgar_1min, apgar_5min, apgar_10min, resuscitation, vaccinations, infant_icd10, infant_hn, infant_an, discharge_status, born_at, synced_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21)
     ON CONFLICT (journey_id, infant_number) DO UPDATE SET
       sex = $4, birth_weight_g = $5, body_length_cm = $6, head_circum_cm = $7,
       apgar_1min = $11, apgar_5min = $12, apgar_10min = $13,
       resuscitation = $14, vaccinations = $15, synced_at = $21`,
    [id, input.journeyId, input.infantNumber, input.sex ?? null, input.birthWeightG ?? null, input.bodyLengthCm ?? null, input.headCircumCm ?? null, input.temperature ?? null, input.heartRate ?? null, input.respiratoryRate ?? null, input.apgar1min ?? null, input.apgar5min ?? null, input.apgar10min ?? null, resuscJson, vaccJson, input.infantIcd10 ?? null, input.infantHn ?? null, input.infantAn ?? null, input.dischargeStatus ?? null, input.bornAt, now],
  );

  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM cached_newborns WHERE journey_id = $1 AND infant_number = $2`,
    [input.journeyId, input.infantNumber],
  );
  return mapRowToNewborn(rows[0]);
}

export interface NewbornKPIs {
  totalBirths: number;
  lbwCount: number;
  lbwRate: number;
  lowApgarCount: number;
  avgBirthWeightG: number;
}

export async function getNewbornKPIs(
  db: DatabaseAdapter,
  hospitalId?: string,
): Promise<NewbornKPIs> {
  let sql = `SELECT
    COUNT(*) as total,
    SUM(CASE WHEN birth_weight_g < 2500 THEN 1 ELSE 0 END) as lbw,
    SUM(CASE WHEN apgar_1min < 7 THEN 1 ELSE 0 END) as low_apgar,
    AVG(birth_weight_g) as avg_weight
    FROM cached_newborns cn`;

  const params: unknown[] = [];
  if (hospitalId) {
    sql += ` JOIN maternal_journeys mj ON mj.id = cn.journey_id WHERE mj.current_hospital_id = $1`;
    params.push(hospitalId);
  }

  const rows = await db.query<Record<string, unknown>>(sql, params);
  const row = rows[0];
  const total = Number(row.total) || 0;
  const lbw = Number(row.lbw) || 0;

  return {
    totalBirths: total,
    lbwCount: lbw,
    lbwRate: total > 0 ? lbw / total : 0,
    lowApgarCount: Number(row.low_apgar) || 0,
    avgBirthWeightG: Math.round(Number(row.avg_weight) || 0),
  };
}

function mapRowToNewborn(row: Record<string, unknown>): CachedNewborn {
  const parseJson = (val: unknown): Record<string, boolean> => {
    if (typeof val === 'string') return JSON.parse(val);
    if (typeof val === 'object' && val !== null) return val as Record<string, boolean>;
    return {};
  };

  return {
    id: row.id as string,
    journeyId: row.journey_id as string,
    infantNumber: row.infant_number as number,
    sex: row.sex as string | null,
    birthWeightG: row.birth_weight_g as number | null,
    bodyLengthCm: row.body_length_cm as number | null,
    headCircumCm: row.head_circum_cm as number | null,
    temperature: row.temperature as number | null,
    heartRate: row.heart_rate as number | null,
    respiratoryRate: row.respiratory_rate as number | null,
    apgar1min: row.apgar_1min as number | null,
    apgar5min: row.apgar_5min as number | null,
    apgar10min: row.apgar_10min as number | null,
    resuscitation: parseJson(row.resuscitation),
    vaccinations: parseJson(row.vaccinations),
    infantIcd10: row.infant_icd10 as string | null,
    infantHn: row.infant_hn as string | null,
    infantAn: row.infant_an as string | null,
    dischargeStatus: row.discharge_status as string | null,
    bornAt: new Date(row.born_at as string),
    syncedAt: new Date(row.synced_at as string),
    createdAt: new Date(row.created_at as string),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/newborn.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/newborn.ts tests/unit/services/newborn.test.ts
git commit -m "feat: add newborn service — birth outcome tracking and neonatal KPIs"
```

---

## Phase 3: API Routes (Tasks 9-12)

### Task 9: Journey API Routes

**Files:**
- Create: `src/app/api/journeys/route.ts`
- Create: `src/app/api/journeys/[journeyId]/route.ts`
- Create: `src/app/api/journeys/[journeyId]/anc-visits/route.ts`
- Create: `src/app/api/hospitals/[hcode]/journeys/route.ts`
- Modify: `src/types/api.ts` (add journey API types)
- Test: `tests/unit/api/journeys.test.ts`

The implementation pattern follows the existing API routes (see `src/app/api/dashboard/route.ts`):
1. `ensureInit()`, `getDatabase()`
2. Audit log
3. Call service function
4. Return `NextResponse.json()`
5. Error handling with Thai messages

This task creates the 4 journey API routes and the corresponding API types. Tests should verify the route handlers call services correctly and return proper response shapes.

- [ ] **Step 1: Add journey API types to api.ts**

Add to end of `src/types/api.ts`:

```typescript
// --- Maternal Journey API Types ---

import type { CareStage, AncRiskLevel, ReferralStatus, UrgencyLevel } from './domain';

export interface JourneyListItem {
  id: string;
  hn: string;
  name: string;
  age: number;
  gravida: number;
  para: number;
  gaWeeks: number | null;
  lmp: string | null;
  edc: string | null;
  careStage: CareStage;
  ancRiskLevel: AncRiskLevel;
  ancVisitCount: number;
  lastAncDate: string | null;
  hospitalName: string;
  hcode: string;
  registeredAt: string;
}

export interface JourneyListResponse {
  journeys: JourneyListItem[];
  pagination: Pagination;
}

export interface JourneyDetailResponse {
  journey: JourneyListItem & {
    currentHospitalName: string;
    currentHcode: string;
  };
  ancVisits: AncVisitEntry[];
  latestRisk: AncRiskEntry | null;
  referrals: ReferralListItem[];
  newborns: NewbornEntry[];
}

export interface AncVisitEntry {
  visitDate: string;
  visitNumber: number;
  gaWeeks: number | null;
  fundalHeightCm: number | null;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  fetalHr: number | null;
}

export interface AncRiskEntry {
  riskLevel: AncRiskLevel;
  triggeredRules: string[];
  screenedAt: string;
  recommendedFacility: string | null;
}

export interface ReferralListItem {
  id: string;
  fromHospital: string;
  toHospital: string;
  status: ReferralStatus;
  reason: string;
  urgencyLevel: UrgencyLevel;
  initiatedAt: string;
  arrivedAt: string | null;
}

export interface NewbornEntry {
  infantNumber: number;
  sex: string | null;
  birthWeightG: number | null;
  apgar1min: number | null;
  apgar5min: number | null;
  bornAt: string;
}

export interface NewbornKPIsResponse {
  totalBirths: number;
  lbwCount: number;
  lbwRate: number;
  lowApgarCount: number;
  avgBirthWeightG: number;
}

export interface DashboardStageKPIs {
  pregnancy: { total: number; low: number; hr1: number; hr2: number; hr3: number };
  labor: { total: number; low: number; medium: number; high: number };
  delivered: { total: number; normal: number; lowApgar: number; lbw: number };
}

export interface DashboardAlerts {
  referralAlerts: number;
  overdueAnc: number;
  inTransitReferrals: number;
}
```

- [ ] **Step 2: Create the journey list route**

Create `src/app/api/journeys/route.ts` following the existing route pattern — calls `getActiveJourneys` with query params for filtering (stage, risk, hospital, page).

- [ ] **Step 3: Create journey detail route**

Create `src/app/api/journeys/[journeyId]/route.ts` — returns full journey with related ANC visits, risks, referrals, and newborns.

- [ ] **Step 4: Create ANC visits route**

Create `src/app/api/journeys/[journeyId]/anc-visits/route.ts` — returns ANC visit history for a journey.

- [ ] **Step 5: Create hospital journeys route**

Create `src/app/api/hospitals/[hcode]/journeys/route.ts` — returns journeys for a specific hospital.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/types/api.ts src/app/api/journeys/ src/app/api/hospitals/
git commit -m "feat: add journey API routes — list, detail, ANC visits, hospital filter"
```

---

### Task 10: Referral API Routes

**Files:**
- Create: `src/app/api/referrals/route.ts`
- Create: `src/app/api/referrals/[id]/accept/route.ts`
- Create: `src/app/api/referrals/[id]/reject/route.ts`
- Create: `src/app/api/referrals/[id]/transit/route.ts`
- Create: `src/app/api/referrals/[id]/arrive/route.ts`
- Create: `src/app/api/dashboard/referrals/route.ts`

Each route follows the standard pattern. POST/PATCH routes validate input, call the corresponding service function, and return the updated referral. The dashboard/referrals route returns aggregate counts.

- [ ] **Step 1: Create referral routes** — POST `/api/referrals` and GET `/api/referrals`
- [ ] **Step 2: Create status transition routes** — PATCH accept, reject, transit, arrive
- [ ] **Step 3: Create dashboard referrals route** — GET `/api/dashboard/referrals`
- [ ] **Step 4: Run all tests**
- [ ] **Step 5: Commit**

```bash
git add src/app/api/referrals/ src/app/api/dashboard/referrals/
git commit -m "feat: add referral API routes — initiate, accept, reject, transit, arrive"
```

---

### Task 11: Outcomes API Route

**Files:**
- Create: `src/app/api/journeys/[journeyId]/newborns/route.ts`
- Create: `src/app/api/dashboard/outcomes/route.ts`

- [ ] **Step 1: Create newborns route** — GET returns birth outcomes for a journey
- [ ] **Step 2: Create outcomes dashboard route** — GET returns neonatal KPIs
- [ ] **Step 3: Run all tests**
- [ ] **Step 4: Commit**

```bash
git add src/app/api/journeys/ src/app/api/dashboard/outcomes/
git commit -m "feat: add newborn outcomes API routes — birth outcomes and neonatal KPIs"
```

---

### Task 12: HOSxP Types and Query Templates

**Files:**
- Modify: `src/types/hosxp.ts` (add ANC and infant source types)
- Modify: `src/config/hosxp-queries.ts` (add ANC sync queries)

- [ ] **Step 1: Add HOSxP source types**

Add to `src/types/hosxp.ts`:

```typescript
export interface HosxpPersonAncRow {
  person_anc_id: number;
  person_id: number;
  hn: string;
  pname: string;
  fname: string;
  lname: string;
  cid: string;
  birthday: string;
  preg_no: number;
  lmp: string | null;
  edc: string | null;
  anc_register_date: string;
}

export interface HosxpAncServiceRow {
  person_anc_service_id: number;
  person_anc_id: number;
  service_date: string;
  anc_service_number: number;
  pa_week: number | null;
  pa_day: number | null;
  fundal_height: number | null;
  bw: number | null;
  bps: number | null;
  bpd: number | null;
  fetal_heart_rate: number | null;
  baby_position: string | null;
  baby_lead: string | null;
  pass_quality: string | null;
  doctor_code: string | null;
}

export interface HosxpAncRiskRow {
  person_anc_risk_id: number;
  person_anc_id: number;
  anc_risk_id: number;
}

export interface HosxpAncClassifyingRow {
  person_anc_classifying_id: number;
  person_anc_id: number;
  person_anc_classifying_item_id: number;
  check_value: string;
}

export interface HosxpLabourInfantRow {
  ipt_labour_infant_id: number;
  ipt_labour_id: number;
  an: string;
  infant_number: number;
  sex: string | null;
  birth_weight: number | null;
  body_length: number | null;
  head_length: number | null;
  temperature: number | null;
  rr: number | null;
  hr: number | null;
  apgar_score_min1: number | null;
  apgar_score_min5: number | null;
  apgar_score_min10: number | null;
  infant_check_ppv: string | null;
  infant_check_et_tube: string | null;
  infant_check_chest_pump: string | null;
  infant_check_oxygen_box: string | null;
  infant_check_narcan: string | null;
  infant_check_feed_milk: string | null;
  infant_check_vitk: string | null;
  infant_check_eyepaste: string | null;
  infant_check_bcg: string | null;
  infant_check_hepb: string | null;
  infant_check_azt: string | null;
  infant_icd10: string | null;
  infant_hn: string | null;
  infant_an: string | null;
  infant_dchstts: string | null;
  birth_date: string | null;
  birth_time: string | null;
}

export interface HosxpReferoutRow {
  refer_number: string;
  refer_date: string;
  hn: string;
  refer_hospcode: string;
  icd10: string | null;
  referout_emergency_type_id: number | null;
}
```

- [ ] **Step 2: Add ANC and infant SQL query templates to hosxp-queries.ts**

Add new query templates for `ANC_PATIENTS`, `ANC_SERVICES`, `ANC_RISKS`, `LABOUR_INFANTS`, and `REFEROUT_PREGNANCY` using the dual-dialect pattern (PostgreSQL + MySQL).

- [ ] **Step 3: Run all tests**
- [ ] **Step 4: Commit**

```bash
git add src/types/hosxp.ts src/config/hosxp-queries.ts
git commit -m "feat: add HOSxP ANC/infant source types and SQL query templates"
```

---

## Phase 4: Sync & Dashboard (Tasks 13-15)

### Task 13: ANC Sync Extension

**Files:**
- Modify: `src/services/sync.ts` (add ANC sync, journey matching, newborn sync)
- Test: `tests/unit/services/sync-journey.test.ts`

Extend the existing sync service with:
1. `syncAncData()` — pulls `person_anc` + service + risk data, creates/updates journeys
2. Journey-labor matching in existing `syncPatientData()` — after upsert, link by HN
3. `syncInfantData()` — pulls `ipt_labour_infant`, upserts newborns

- [ ] **Step 1: Write failing tests for ANC sync and journey matching**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement sync extensions**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Run all existing sync tests to verify no regression**
- [ ] **Step 6: Commit**

```bash
git add src/services/sync.ts tests/unit/services/sync-journey.test.ts
git commit -m "feat: extend sync service — ANC data pull, journey matching, newborn sync"
```

---

### Task 14: Dashboard Service Extension

**Files:**
- Modify: `src/services/dashboard.ts` (add stage KPIs, alerts)
- Test: `tests/unit/services/dashboard-journey.test.ts`

Extend `getProvinceDashboard()` to include:
- `stageKPIs`: pregnancy/labor/delivered counts with risk breakdowns
- `alerts`: referral alert count, overdue ANC count, in-transit count
- Expanded hospital table with ANC columns

- [ ] **Step 1: Write failing tests for new dashboard data**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement dashboard extensions**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add src/services/dashboard.ts tests/unit/services/dashboard-journey.test.ts
git commit -m "feat: extend dashboard service — stage KPIs, alerts, ANC aggregation"
```

---

### Task 15: Modified Dashboard API Route

**Files:**
- Modify: `src/app/api/dashboard/route.ts`
- Modify: `src/app/api/patients/[an]/route.ts` (add journey context)

- [ ] **Step 1: Update dashboard route to include new stage KPIs and alerts**
- [ ] **Step 2: Update patient detail route to include journey context**
- [ ] **Step 3: Run all API tests**
- [ ] **Step 4: Commit**

```bash
git add src/app/api/dashboard/route.ts src/app/api/patients/
git commit -m "feat: extend dashboard and patient detail APIs with journey data"
```

---

## Phase 5: Frontend (Tasks 16-20)

### Task 16: Navigation and Layout Update

Update the sidebar/nav to add Pregnancies, Outcomes, Referrals sections.

### Task 17: Dashboard Redesign

Redesign the main dashboard page with 3 stage KPI cards, alert bar, and expanded hospital table.

### Task 18: Pregnancies Page (ANC Registry)

Create `/pregnancies` page — list with risk badges, filters, and `/pregnancies/[journeyId]` detail with ANC timeline.

### Task 19: Referrals Page

Create `/referrals` page — pending/in-transit/completed tabs with initiate/accept/reject actions.

### Task 20: Outcomes Page

Create `/outcomes` page — neonatal KPI dashboard with birth weight distribution chart.

---

*Phase 5 tasks are intentionally less detailed — the UI implementation should follow the mockups from the brainstorming visual companion and the established shadcn/ui + Tailwind patterns in the existing codebase. Each task follows the same pattern: write SWR hook → create page component → test rendering.*

---

## Verification Checklist

After all tasks complete:

- [ ] `npx vitest run` — all unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run build` — no build errors
- [ ] Verify all 5 new tables created on fresh DB init
- [ ] Verify `journey_id` column added to `cached_patients`
- [ ] Verify all 13 new API routes respond correctly
- [ ] Verify existing labor functionality is unchanged (no regression)
