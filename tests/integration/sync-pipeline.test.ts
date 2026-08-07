// Integration tests: sync data pipeline — HOSxP data -> cached patients -> CPD scores
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createTestDb } from '../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import {
  transformHosxpPatient,
  upsertCachedPatients,
  detectChanges,
  pollHospital,
  type SyncPatientData,
} from '@/services/sync';
import { calculateCpdScore } from '@/services/cpd-score';
import { generateKey, encrypt } from '@/lib/encryption';
import { BmsSessionClient } from '@/lib/bms-session';
import type { SseManager } from '@/lib/sse';
import type { HosxpIptRow, HosxpPregnancyRow, HosxpPatientRow } from '@/types/hosxp';
import type { BmsQueryResult } from '@/types/bms-session';
import { RiskLevel } from '@/types/domain';

const TEST_ENCRYPTION_KEY = generateKey();

describe('Sync Pipeline Integration', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);

    // Get the first hospital ID for tests
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    hospitalId = hospitals[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  // -----------------------------------------------------------------------
  // Pipeline: HOSxP data -> cached patients -> CPD scores
  // -----------------------------------------------------------------------
  it('transforms HOSxP data -> cached patients -> CPD scores', async () => {
    // Step 1: Create realistic HOSxP source data
    const ipt: HosxpIptRow = {
      an: '6700098765',
      hn: '000234567',
      regdate: '2026-03-08',
      regtime: '14:30:00',
      dchdate: null,
      dchtime: null,
      ward: 'LR',
      admdoctor: 'DR-OB01',
    };
    const pregnancy: HosxpPregnancyRow = {
      an: '6700098765',
      preg_number: 1,
      ga: 41,
      labor_date: null,
      anc_complete: null,
      child_count: null,
      deliver_type: null,
    };
    const patient: HosxpPatientRow = {
      hn: '000234567',
      pname: 'นาง',
      fname: 'ปราณี',
      lname: 'สุขใจ',
      cid: '0000000000002',
      birthday: '1997-06-20',
      sex: '2',
    };

    // Step 2: Transform via transformHosxpPatient
    const syncData = transformHosxpPatient(ipt, pregnancy, patient, TEST_ENCRYPTION_KEY);

    expect(syncData.hn).toBe('000234567');
    expect(syncData.an).toBe('6700098765');
    expect(syncData.gravida).toBe(1);
    expect(syncData.gaWeeks).toBe(41);
    expect(syncData.laborStatus).toBe('ACTIVE');
    // Name should be encrypted (not readable)
    expect(syncData.name).not.toContain('ปราณี');
    // CID hash should be SHA-256
    const expectedCidHash = createHash('sha256').update('0000000000002').digest('hex');
    expect(syncData.cidHash).toBe(expectedCidHash);

    // Add clinical data that isn't in the HOSxP transform (filled by other sources)
    const enrichedSync: SyncPatientData = {
      ...syncData,
      heightCm: 147,
      weightKg: 75,
      weightDiffKg: 22,
      fundalHeightCm: 37,
      usWeightG: 3800,
      hematocritPct: 29,
      ancCount: 3,
    };

    // Step 3: Upsert into cached_patients
    const count = await upsertCachedPatients(db, hospitalId, [enrichedSync]);
    expect(count).toBe(1);

    // Verify patient is in DB
    const dbPatients = await db.query<{
      id: string;
      hn: string;
      an: string;
      gravida: number;
      ga_weeks: number;
      height_cm: number;
      weight_diff_kg: number;
      fundal_height_cm: number;
      us_weight_g: number;
      hematocrit_pct: number;
      anc_count: number;
      labor_status: string;
    }>(
      'SELECT id, hn, an, gravida, ga_weeks, height_cm, weight_diff_kg, fundal_height_cm, us_weight_g, hematocrit_pct, anc_count, labor_status FROM cached_patients WHERE an = ?',
      ['6700098765'],
    );
    expect(dbPatients).toHaveLength(1);
    expect(dbPatients[0].labor_status).toBe('ACTIVE');

    // Step 4: Calculate CPD score from patient data
    const cpdResult = calculateCpdScore({
      gravida: dbPatients[0].gravida,
      ancCount: dbPatients[0].anc_count,
      gaWeeks: dbPatients[0].ga_weeks,
      heightCm: dbPatients[0].height_cm,
      weightDiffKg: dbPatients[0].weight_diff_kg,
      fundalHeightCm: dbPatients[0].fundal_height_cm,
      usWeightG: dbPatients[0].us_weight_g,
      hematocritPct: dbPatients[0].hematocrit_pct,
    });

    // Verify: gravida=1(2) + anc=3(1.5) + ga=41(1.5) + height=147(2) +
    // weightDiff=22(2) + fundal=37(2) + us=3800(2) + hct=29(1.5) = 14.5
    expect(cpdResult.score).toBe(14.5);
    expect(cpdResult.riskLevel).toBe(RiskLevel.HIGH);
    expect(cpdResult.missingFactors).toHaveLength(0);

    // Step 5: Store CPD score in DB
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cpd_scores
         (id, patient_id, score, risk_level, recommendation,
          factor_gravida, factor_anc_count, factor_ga_weeks, factor_height_cm,
          factor_weight_diff, factor_fundal_ht, factor_us_weight, factor_hematocrit,
          missing_factors, calculated_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuidv4(),
        dbPatients[0].id,
        cpdResult.score,
        cpdResult.riskLevel,
        cpdResult.recommendation,
        cpdResult.factorScores.gravida ?? null,
        cpdResult.factorScores.ancCount ?? null,
        cpdResult.factorScores.gaWeeks ?? null,
        cpdResult.factorScores.heightCm ?? null,
        cpdResult.factorScores.weightDiffKg ?? null,
        cpdResult.factorScores.fundalHeightCm ?? null,
        cpdResult.factorScores.usWeightG ?? null,
        cpdResult.factorScores.hematocritPct ?? null,
        JSON.stringify(cpdResult.missingFactors),
        now,
        now,
      ],
    );

    // Verify full chain: patient in DB + CPD score in DB + correct risk level
    const storedScore = await db.query<{
      score: number;
      risk_level: string;
      recommendation: string;
    }>('SELECT score, risk_level, recommendation FROM cpd_scores WHERE patient_id = ?', [
      dbPatients[0].id,
    ]);
    expect(storedScore).toHaveLength(1);
    expect(storedScore[0].score).toBe(14.5);
    expect(storedScore[0].risk_level).toBe('HIGH');
    expect(storedScore[0].recommendation).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Change detection: new admissions and discharges
  // -----------------------------------------------------------------------
  it('detects new admissions and discharges', async () => {
    const now = new Date().toISOString();

    // Step 1: Seed initial patients
    const initialPatients: SyncPatientData[] = [
      {
        hn: 'HN-A01',
        an: 'AN-A01',
        name: encrypt('นาง เดิม หนึ่ง', TEST_ENCRYPTION_KEY),
        cid: 'enc_test_001',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000001',
        age: 25,
        gravida: 2,
        gaWeeks: 38,
        ancCount: 5,
        admitDate: '2026-03-01T08:00:00',
        laborStatus: 'ACTIVE',
        syncedAt: now,
      },
      {
        hn: 'HN-A02',
        an: 'AN-A02',
        name: encrypt('นาง เดิม สอง', TEST_ENCRYPTION_KEY),
        cid: 'enc_test_002',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000002',
        age: 30,
        gravida: 3,
        gaWeeks: 39,
        ancCount: 7,
        admitDate: '2026-03-02T10:00:00',
        laborStatus: 'ACTIVE',
        syncedAt: now,
      },
      {
        hn: 'HN-A03',
        an: 'AN-A03',
        name: encrypt('นาง เดิม สาม', TEST_ENCRYPTION_KEY),
        cid: 'enc_test_003',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000003',
        age: 28,
        gravida: 1,
        gaWeeks: 40,
        ancCount: 4,
        admitDate: '2026-03-03T12:00:00',
        laborStatus: 'ACTIVE',
        syncedAt: now,
      },
    ];
    await upsertCachedPatients(db, hospitalId, initialPatients);
    const existingAns = initialPatients.map((p) => p.an);

    // Step 2: Simulate new sync — AN-A01 still there, AN-A02 discharged (missing), AN-A04 is new
    const newSyncData = [
      { an: 'AN-A01', hn: 'HN-A01', laborStatus: 'ACTIVE' },
      { an: 'AN-A03', hn: 'HN-A03', laborStatus: 'ACTIVE' },
      { an: 'AN-A04', hn: 'HN-A04', laborStatus: 'ACTIVE' },
    ];

    // Step 3: Detect changes
    const changes = detectChanges(newSyncData as SyncPatientData[], existingAns);

    // AN-A02 is missing from new data => discharged
    expect(changes.discharges).toContain('AN-A02');
    expect(changes.discharges).toHaveLength(1);

    // AN-A04 is new => new admission
    expect(changes.newAdmissions).toContain('AN-A04');
    expect(changes.newAdmissions).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Incomplete HOSxP data handling
  // -----------------------------------------------------------------------
  it('handles incomplete HOSxP data gracefully', async () => {
    // Step 1: Create HOSxP data missing some clinical fields
    const ipt: HosxpIptRow = {
      an: '6700055555',
      hn: '000555555',
      regdate: '2026-03-07',
      regtime: '09:00:00',
      dchdate: null,
      dchtime: null,
      ward: 'LR',
      admdoctor: 'DR002',
    };
    const pregnancy: HosxpPregnancyRow = {
      an: '6700055555',
      preg_number: 2,
      ga: 39,
      labor_date: null,
      anc_complete: null,
      child_count: null,
      deliver_type: null,
    };
    const patient: HosxpPatientRow = {
      hn: '000555555',
      pname: 'นาง',
      fname: 'วรรณา',
      lname: 'ไม่ครบ',
      cid: '0000000000003',
      birthday: '2000-01-10',
      sex: '2',
    };

    // Step 2: Transform — note: no ultrasound, no ANC count, no height/weight/fundal/HCT
    const syncData = transformHosxpPatient(ipt, pregnancy, patient, TEST_ENCRYPTION_KEY);

    // ancCount is always null from transformHosxpPatient (filled separately)
    expect(syncData.ancCount).toBeNull();
    expect(syncData.heightCm).toBeUndefined();
    expect(syncData.usWeightG).toBeUndefined();

    // Step 3: Upsert with partial data
    await upsertCachedPatients(db, hospitalId, [syncData]);

    const rows = await db.query<{
      id: string;
      gravida: number | null;
      ga_weeks: number | null;
      height_cm: number | null;
      us_weight_g: number | null;
      hematocrit_pct: number | null;
      anc_count: number | null;
    }>(
      'SELECT id, gravida, ga_weeks, height_cm, us_weight_g, hematocrit_pct, anc_count FROM cached_patients WHERE an = ?',
      ['6700055555'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gravida).toBe(2);
    expect(rows[0].ga_weeks).toBe(39);
    // Missing fields should be null
    expect(rows[0].height_cm).toBeNull();
    expect(rows[0].us_weight_g).toBeNull();
    expect(rows[0].hematocrit_pct).toBeNull();
    expect(rows[0].anc_count).toBeNull();

    // Step 4: Calculate CPD score — should work with partial data
    const cpdResult = calculateCpdScore({
      gravida: rows[0].gravida ?? undefined,
      gaWeeks: rows[0].ga_weeks ?? undefined,
      // These are undefined/missing
      ancCount: rows[0].anc_count ?? undefined,
      heightCm: rows[0].height_cm ?? undefined,
      weightDiffKg: undefined,
      fundalHeightCm: undefined,
      usWeightG: rows[0].us_weight_g ?? undefined,
      hematocritPct: rows[0].hematocrit_pct ?? undefined,
    } as Record<string, number | undefined>);

    // gravida=2 -> 0, gaWeeks=39 -> 0 (< 40) = 0 total
    // All missing factors should be listed
    expect(cpdResult.score).toBe(0);
    expect(cpdResult.riskLevel).toBe(RiskLevel.LOW);

    // Missing factors should list the ones not provided
    expect(cpdResult.missingFactors).toContain('ancCount');
    expect(cpdResult.missingFactors).toContain('heightCm');
    expect(cpdResult.missingFactors).toContain('weightDiffKg');
    expect(cpdResult.missingFactors).toContain('fundalHeightCm');
    expect(cpdResult.missingFactors).toContain('usWeightG');
    expect(cpdResult.missingFactors).toContain('hematocritPct');
    expect(cpdResult.missingFactors).toHaveLength(6);
  });

  // -----------------------------------------------------------------------
  // Upsert idempotency: re-syncing same data doesn't create duplicates
  // -----------------------------------------------------------------------
  it('upsert is idempotent — re-syncing same data updates in place', async () => {
    const now = new Date().toISOString();
    const patient: SyncPatientData = {
      hn: 'HN-IDEM',
      an: 'AN-IDEM',
      name: encrypt('นาง ซ้ำ ข้อมูล', TEST_ENCRYPTION_KEY),
      cid: 'enc_test_004',
      cidHash: 'testhash00000000000000000000000000000000000000000000000000000004',
      age: 27,
      gravida: 2,
      gaWeeks: 38,
      ancCount: 5,
      admitDate: '2026-03-06T08:00:00',
      laborStatus: 'ACTIVE',
      syncedAt: now,
    };

    // Insert once
    await upsertCachedPatients(db, hospitalId, [patient]);
    const countAfterFirst = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM cached_patients WHERE an = ?',
      ['AN-IDEM'],
    );
    expect(countAfterFirst[0].count).toBe(1);

    // Insert again with updated GA
    await upsertCachedPatients(db, hospitalId, [{ ...patient, gaWeeks: 39 }]);
    const countAfterSecond = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM cached_patients WHERE an = ?',
      ['AN-IDEM'],
    );
    expect(countAfterSecond[0].count).toBe(1); // Still 1 row

    const updated = await db.query<{ ga_weeks: number }>(
      'SELECT ga_weeks FROM cached_patients WHERE an = ?',
      ['AN-IDEM'],
    );
    expect(updated[0].ga_weeks).toBe(39); // Updated value
  });

  // -----------------------------------------------------------------------
  // Delivered patient marking
  // -----------------------------------------------------------------------
  it('transforms patient as DELIVERED when dchdate is set', () => {
    const ipt: HosxpIptRow = {
      an: '6700077777',
      hn: '000777777',
      regdate: '2026-03-01',
      regtime: '08:00:00',
      dchdate: '2026-03-05',
      dchtime: '14:00:00',
      ward: 'LR',
      admdoctor: 'DR003',
    };
    const pregnancy: HosxpPregnancyRow = {
      an: '6700077777',
      preg_number: 3,
      ga: 40,
      labor_date: '2026-03-05',
      anc_complete: null,
      child_count: 1,
      deliver_type: 1,
    };
    const patient: HosxpPatientRow = {
      hn: '000777777',
      pname: 'นาง',
      fname: 'คลอด',
      lname: 'แล้ว',
      cid: '0000000000004',
      birthday: '1995-08-20',
      sex: '2',
    };

    const result = transformHosxpPatient(ipt, pregnancy, patient, TEST_ENCRYPTION_KEY);
    expect(result.laborStatus).toBe('DELIVERED');
  });

  // -----------------------------------------------------------------------
  // Multiple patients across multiple hospitals
  // -----------------------------------------------------------------------
  it('handles multiple patients across multiple hospitals in single pipeline run', async () => {
    const hospitals = await db.query<{ id: string; hcode: string }>(
      "SELECT id, hcode FROM hospitals WHERE hcode IN ('10670','11000','11002') ORDER BY hcode",
    );
    const now = new Date().toISOString();

    // Seed 2 patients per hospital = 6 total
    for (const h of hospitals) {
      const patients: SyncPatientData[] = [
        {
          hn: `HN-${h.hcode}-01`,
          an: `AN-${h.hcode}-01`,
          name: encrypt(`Patient 1 at ${h.hcode}`, TEST_ENCRYPTION_KEY),
          cid: 'enc_test_005',
          cidHash: 'testhash00000000000000000000000000000000000000000000000000000005',
          age: 25,
          gravida: 2,
          gaWeeks: 38,
          ancCount: 5,
          admitDate: '2026-03-08T08:00:00',
          laborStatus: 'ACTIVE',
          syncedAt: now,
        },
        {
          hn: `HN-${h.hcode}-02`,
          an: `AN-${h.hcode}-02`,
          name: encrypt(`Patient 2 at ${h.hcode}`, TEST_ENCRYPTION_KEY),
          cid: 'enc_test_006',
          cidHash: 'testhash00000000000000000000000000000000000000000000000000000006',
          age: 30,
          gravida: 1,
          gaWeeks: 41,
          ancCount: 3,
          admitDate: '2026-03-08T10:00:00',
          laborStatus: 'ACTIVE',
          syncedAt: now,
        },
      ];
      const count = await upsertCachedPatients(db, h.id, patients);
      expect(count).toBe(2);
    }

    // Total patients across all hospitals
    const totalPatients = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM cached_patients',
    );
    expect(totalPatients[0].count).toBe(6);

    // Verify each hospital has exactly 2 patients
    for (const h of hospitals) {
      const count = await db.query<{ count: number }>(
        'SELECT COUNT(*) as count FROM cached_patients WHERE hospital_id = ?',
        [h.id],
      );
      expect(count[0].count).toBe(2);
    }
  });

  // -----------------------------------------------------------------------
  // CID hash cross-hospital matching in pipeline context
  // -----------------------------------------------------------------------
  it('cross-hospital CID matching works through full pipeline', async () => {
    const hospitals = await db.query<{ id: string; hcode: string }>(
      "SELECT id, hcode FROM hospitals WHERE hcode IN ('10670','11000') ORDER BY hcode",
    );
    const now = new Date().toISOString();

    const rawCid = '1400600012345';
    const cidHash = createHash('sha256').update(rawCid).digest('hex');

    // Same patient at two hospitals (transferred)
    const patientAtA: SyncPatientData = {
      hn: 'HN-XFER-A',
      an: 'AN-XFER-A',
      name: encrypt('นาง ย้าย รพ.', TEST_ENCRYPTION_KEY),
      cid: encrypt(rawCid, TEST_ENCRYPTION_KEY),
      cidHash,
      age: 28,
      gravida: 2,
      gaWeeks: 39,
      ancCount: 6,
      admitDate: '2026-03-06T08:00:00',
      laborStatus: 'ACTIVE',
      syncedAt: now,
    };
    await upsertCachedPatients(db, hospitals[0].id, [patientAtA]);

    const patientAtB: SyncPatientData = {
      hn: 'HN-XFER-B',
      an: 'AN-XFER-B',
      name: encrypt('นาง ย้าย รพ.', TEST_ENCRYPTION_KEY),
      cid: encrypt(rawCid, TEST_ENCRYPTION_KEY),
      cidHash,
      age: 28,
      gravida: 2,
      gaWeeks: 39,
      ancCount: 6,
      admitDate: '2026-03-07T10:00:00',
      laborStatus: 'ACTIVE',
      syncedAt: now,
    };
    await upsertCachedPatients(db, hospitals[1].id, [patientAtB]);

    // Both should be findable by cid_hash
    const matches = await db.query<{ hospital_id: string; an: string }>(
      'SELECT hospital_id, an FROM cached_patients WHERE cid_hash = ?',
      [cidHash],
    );
    expect(matches).toHaveLength(2);
    const matchedHospitalIds = matches.map((m) => m.hospital_id);
    expect(matchedHospitalIds).toContain(hospitals[0].id);
    expect(matchedHospitalIds).toContain(hospitals[1].id);
  });

  // -----------------------------------------------------------------------
  // T18: Partograph sync via pollHospital()
  // -----------------------------------------------------------------------
  describe('partograph sync via pollHospital', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('pulls partograph rows, persists them, and rolls up severity', async () => {
      // Seed an active patient with a known AN that the mock partograph
      // row will reference (so AN-resolution inside pollHospital() finds it).
      const now = new Date().toISOString();
      const patientId = uuidv4();
      await db.execute(
        `INSERT INTO cached_patients
           (id, hospital_id, hn, an, name, age, admit_date,
            labor_status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [
          patientId,
          hospitalId,
          'HN-PG1',
          'AN-PG1',
          encrypt('นาง ทดสอบ พาร์โต', TEST_ENCRYPTION_KEY),
          30,
          '2026-04-19T08:00:00Z',
          now,
          now,
          now,
        ],
      );

      // Mock BmsSessionClient.executeQuery so that:
      //   - the partograph SQL returns one moulding=+++ row (-> CRITICAL)
      //   - the active-patient SQL returns the same patient (so the
      //     existing pre-partograph flow sees the row as still admitted)
      //   - any other query returns an empty data array
      const partographRow = {
        ipt_labour_partograph_id: 9001,
        ipt_labour_id: 1,
        an: 'AN-PG1',
        observe_datetime: '2026-04-19T10:00:00Z',
        hour_no: 1,
        fetal_heart_rate: 130,
        amniotic_fluid: 'Clear',
        labour_amniotic_type_id: null,
        amniotic_type_name: null,
        moulding: '+++',
        cervical_dilation_cm: 5,
        descent_of_head: '3/5',
        contraction_per_10min: 3,
        contraction_duration_sec: 40,
        contraction_strength: 'M',
        oxytocin_uml: null,
        oxytocin_drops_min: null,
        drugs_iv_fluids: null,
        pulse: 80,
        bp_systolic: 120,
        bp_diastolic: 80,
        temperature: 36.8,
        urine_volume_ml: null,
        urine_protein: null,
        urine_glucose: null,
        urine_acetone: null,
        note: null,
        entry_staff: 'NURSE1',
        entry_datetime: '2026-04-19T10:05:00Z',
      };

      const activePatientRow = {
        an: 'AN-PG1',
        hn: 'HN-PG1',
        regdate: '2026-04-19',
        regtime: '08:00:00',
        ward: 'LR',
        pname: 'นาง',
        fname: 'ทดสอบ',
        lname: 'พาร์โต',
        cid: '1234567890121',
        birthday: '1995-01-01',
        sex: '2',
        preg_number: 2,
        ga: 39,
        anc_count: 5,
        anc_complete: 'Y',
        labor_date: null,
      };

      const wrapResult = (data: Record<string, unknown>[]): BmsQueryResult => ({
        data,
        field: [],
        field_name: [],
        record_count: data.length,
      });

      vi.spyOn(BmsSessionClient.prototype, 'executeQuery').mockImplementation(
        async (sql: string): Promise<BmsQueryResult> => {
          if (sql.includes('ipt_labour_partograph')) {
            return wrapResult([partographRow]);
          }
          // Authenticity probe: pollHospital round-trips the first row's CID
          // against `patient`. A real (authentic) hospital returns a row here,
          // so mock a non-empty result to let the sync proceed to partograph.
          if (sql.includes('WHERE cid =')) {
            return wrapResult([{ one: 1 }]);
          }
          if (sql.includes('FROM ipt')) {
            return wrapResult([activePatientRow]);
          }
          return wrapResult([]);
        },
      );

      const sseManager = { broadcast: vi.fn() } as unknown as SseManager;

      await pollHospital(
        db,
        hospitalId,
        'http://tunnel.test',
        'http://bms.test',
        'jwt-test',
        'postgresql',
        TEST_ENCRYPTION_KEY,
        sseManager,
        { marketplaceToken: 'test-marketplace-token' },
      );

      // Partograph row landed in cache.
      const obs = await db.query<{
        moulding: string | null;
        source_pk: string;
        patient_id: string;
      }>('SELECT moulding, source_pk, patient_id FROM cached_partograph_observations');
      expect(obs).toHaveLength(1);
      expect(obs[0].moulding).toBe('+++');
      expect(obs[0].source_pk).toBe('9001');

      // Severity rolled up onto cached_patients.
      const patientAfter = await db.query<{
        partograph_severity: string | null;
        partograph_alert_count: number | null;
      }>('SELECT partograph_severity, partograph_alert_count FROM cached_patients WHERE an = ?', [
        'AN-PG1',
      ]);
      expect(patientAfter[0].partograph_severity).toBe('CRITICAL');
      expect(patientAfter[0].partograph_alert_count).toBeGreaterThan(0);

      // SSE broadcast included the severity-changed event.
      const broadcastMock = sseManager.broadcast as unknown as ReturnType<typeof vi.fn>;
      const severityCalls = broadcastMock.mock.calls.filter((c: unknown[]) => {
        const data = c[1] as { type?: string } | undefined;
        return data?.type === 'partograph_severity_changed';
      });
      expect(severityCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
