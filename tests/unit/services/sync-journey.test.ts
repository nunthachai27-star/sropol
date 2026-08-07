// T013: ANC sync, journey-labor linking, and newborn sync tests (TDD — write FIRST)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';
import { syncAncData, linkJourneyToLabor, syncNewbornData } from '@/services/sync';
import type { SanitizedInfantRow } from '@/services/sync/newborn';
import type {
  HosxpPersonAncRow,
  HosxpAncServiceRow,
  HosxpAncRiskRow,
  HosxpAncClassifyingRow,
} from '@/types/hosxp';
import { CareStage, AncRiskLevel } from '@/types/domain';
import { createJourney } from '@/services/journey';
import { toIsoDate } from '@/lib/dates';

const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Sync Journey Extension', () => {
  let db: DatabaseAdapter;
  let hospitalId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);

    // Get seeded hospital ID
    const hospitals = await db.query<{ id: string }>(
      "SELECT id FROM hospitals WHERE hcode = '10670'",
    );
    hospitalId = hospitals[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  // --- syncAncData Tests ---

  describe('syncAncData', () => {
    it('should create journey + visits from HOSxP ANC data and evaluate risk', async () => {
      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 1001,
          person_id: 500,
          hn: 'HN-ANC-001',
          pname: 'นาง',
          fname: 'สมหญิง',
          lname: 'ทดสอบ',
          cid: '1234567890121',
          birthday: '1995-06-15',
          preg_no: 2,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          anc_register_date: '2025-08-01',
        },
      ];

      const ancServices: HosxpAncServiceRow[] = [
        {
          person_anc_service_id: 2001,
          person_anc_id: 1001,
          service_date: '2025-09-01',
          anc_service_number: 1,
          pa_week: 12,
          pa_day: 3,
          fundal_height: 10,
          bw: 55.5,
          bps: 120,
          bpd: 80,
          height: 158,
          fetal_heart_rate: 140,
          baby_position: 'cephalic',
          baby_lead: 'engaged',
          pass_quality: 'Y',
          doctor_code: 'DR001',
        },
        {
          person_anc_service_id: 2002,
          person_anc_id: 1001,
          service_date: '2025-10-01',
          anc_service_number: 2,
          pa_week: 16,
          pa_day: 3,
          fundal_height: 14,
          bw: 57.0,
          bps: 118,
          bpd: 78,
          height: 158,
          fetal_heart_rate: 142,
          baby_position: 'cephalic',
          baby_lead: 'engaged',
          pass_quality: 'Y',
          doctor_code: 'DR001',
        },
      ];

      const ancRisks: HosxpAncRiskRow[] = [];
      const ancClassifying: HosxpAncClassifyingRow[] = [];

      const count = await syncAncData(
        db,
        hospitalId,
        ancPatients,
        ancServices,
        ancRisks,
        ancClassifying,
        ENCRYPTION_KEY,
      );

      expect(count).toBe(1);

      // Verify journey was created
      const journeys = await db.query<{
        id: string;
        hn: string;
        care_stage: string;
        anc_visit_count: number;
        gravida: number;
      }>(
        'SELECT id, hn, care_stage, anc_visit_count, gravida FROM maternal_journeys WHERE hospital_id = ?',
        [hospitalId],
      );
      expect(journeys).toHaveLength(1);
      expect(journeys[0].hn).toBe('HN-ANC-001');
      expect(journeys[0].care_stage).toBe(CareStage.PREGNANCY);
      expect(journeys[0].anc_visit_count).toBe(2);
      expect(journeys[0].gravida).toBe(2);

      // Verify ANC visits were created
      const visits = await db.query<{ visit_number: number; ga_weeks: number | null }>(
        'SELECT visit_number, ga_weeks FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journeys[0].id],
      );
      expect(visits).toHaveLength(2);
      expect(visits[0].visit_number).toBe(1);
      expect(visits[0].ga_weeks).toBe(12);
      expect(visits[1].visit_number).toBe(2);

      // Verify ANC risk was evaluated and stored
      const risks = await db.query<{ risk_level: string }>(
        'SELECT risk_level FROM cached_anc_risks WHERE journey_id = ?',
        [journeys[0].id],
      );
      expect(risks.length).toBeGreaterThanOrEqual(1);
    });

    it('should update existing journey on re-sync', async () => {
      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 1001,
          person_id: 500,
          hn: 'HN-ANC-002',
          pname: 'นาง',
          fname: 'ทดสอบ',
          lname: 'ซ้ำ',
          cid: '9876543210121',
          birthday: '1990-01-01',
          preg_no: 1,
          lmp: '2025-05-01',
          edc: '2026-02-05',
          anc_register_date: '2025-07-01',
        },
      ];

      const ancServices: HosxpAncServiceRow[] = [
        {
          person_anc_service_id: 3001,
          person_anc_id: 1001,
          service_date: '2025-08-01',
          anc_service_number: 1,
          pa_week: 12,
          pa_day: 0,
          fundal_height: 10,
          bw: 60,
          bps: 120,
          bpd: 80,
          height: 155,
          fetal_heart_rate: 140,
          baby_position: null,
          baby_lead: null,
          pass_quality: null,
          doctor_code: null,
        },
      ];

      // First sync — creates journey
      await syncAncData(db, hospitalId, ancPatients, ancServices, [], [], ENCRYPTION_KEY);

      // Second sync with updated data (new visit added)
      const updatedServices: HosxpAncServiceRow[] = [
        ...ancServices,
        {
          person_anc_service_id: 3002,
          person_anc_id: 1001,
          service_date: '2025-09-01',
          anc_service_number: 2,
          pa_week: 16,
          pa_day: 0,
          fundal_height: 14,
          bw: 62,
          bps: 122,
          bpd: 82,
          height: 155,
          fetal_heart_rate: 145,
          baby_position: null,
          baby_lead: null,
          pass_quality: null,
          doctor_code: null,
        },
      ];

      const count = await syncAncData(
        db,
        hospitalId,
        ancPatients,
        updatedServices,
        [],
        [],
        ENCRYPTION_KEY,
      );
      expect(count).toBe(1);

      // Verify only 1 journey exists (updated, not duplicated)
      const journeys = await db.query<{ anc_visit_count: number }>(
        'SELECT anc_visit_count FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [hospitalId, 'HN-ANC-002'],
      );
      expect(journeys).toHaveLength(1);
      expect(journeys[0].anc_visit_count).toBe(2);

      // Verify visits
      const visits = await db.query<{ id: string }>(
        `SELECT v.id FROM cached_anc_visits v
         JOIN maternal_journeys j ON j.id = v.journey_id
         WHERE j.hospital_id = ? AND j.hn = ?`,
        [hospitalId, 'HN-ANC-002'],
      );
      expect(visits).toHaveLength(2);
    });

    it('does not modify or reassign a visit owned by another hospital; roll-up counts all rows (WHO T5)', async () => {
      const hospB = await db.query<{ id: string }>(
        "SELECT id FROM hospitals WHERE hcode = '10995'",
      );
      const hospitalB = hospB[0].id;

      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 7001,
          person_id: 700,
          hn: 'HN-XH',
          pname: 'นาง',
          fname: 'ข้าม',
          lname: 'รพ',
          cid: '1234567890121',
          birthday: '1994-01-01',
          preg_no: 1,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          anc_register_date: '2025-08-01',
        },
      ];

      const svc1: HosxpAncServiceRow[] = [
        {
          person_anc_service_id: 8001,
          person_anc_id: 7001,
          service_date: '2025-09-01',
          anc_service_number: 1,
          pa_week: 12,
          pa_day: 0,
          fundal_height: 10,
          bw: 55,
          bps: 120,
          bpd: 80,
          height: 158,
          fetal_heart_rate: 140,
          baby_position: null,
          baby_lead: null,
          pass_quality: null,
          doctor_code: null,
        },
      ];
      // First sync (hospital A) creates journey + one visit on 2025-09-01.
      await syncAncData(db, hospitalId, ancPatients, svc1, [], [], ENCRYPTION_KEY);

      const journey = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [hospitalId, 'HN-XH'],
      );
      // Simulate the 2025-09-01 visit being owned by another hospital B.
      await db.execute(
        'UPDATE cached_anc_visits SET hospital_id = ?, ga_weeks = 50 WHERE journey_id = ?',
        [hospitalB, journey[0].id],
      );

      // Second sync (hospital A): same date (B's row, must NOT change) + a new date.
      const svc2: HosxpAncServiceRow[] = [
        { ...svc1[0], pa_week: 99 },
        {
          person_anc_service_id: 8002,
          person_anc_id: 7001,
          service_date: '2025-10-01',
          anc_service_number: 2,
          pa_week: 16,
          pa_day: 0,
          fundal_height: 14,
          bw: 57,
          bps: 118,
          bpd: 78,
          height: 158,
          fetal_heart_rate: 142,
          baby_position: null,
          baby_lead: null,
          pass_quality: null,
          doctor_code: null,
        },
      ];
      await syncAncData(db, hospitalId, ancPatients, svc2, [], [], ENCRYPTION_KEY);

      const rows = await db.query<{
        visit_date: string | Date;
        hospital_id: string;
        ga_weeks: number;
      }>(
        'SELECT visit_date, hospital_id, ga_weeks FROM cached_anc_visits WHERE journey_id = ? ORDER BY visit_date',
        [journey[0].id],
      );
      expect(rows).toHaveLength(2);
      const d1 = rows.find((r) => toIsoDate(r.visit_date) === '2025-09-01')!;
      expect(d1.hospital_id).toBe(hospitalB); // NOT reassigned to A
      expect(d1.ga_weeks).toBe(50); // NOT overwritten with pa_week 99
      const d2 = rows.find((r) => toIsoDate(r.visit_date) === '2025-10-01')!;
      expect(d2.hospital_id).toBe(hospitalId); // new visit owned by A

      const j = await db.query<{ anc_visit_count: number }>(
        'SELECT anc_visit_count FROM maternal_journeys WHERE id = ?',
        [journey[0].id],
      );
      expect(j[0].anc_visit_count).toBe(2); // DB aggregate over ALL surviving rows
    });

    it('repeated unchanged ANC sync does not append duplicate screening rows', async () => {
      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 1001,
          person_id: 500,
          hn: 'HN-ANC-DEDUP',
          pname: 'นาง',
          fname: 'ทดสอบ',
          lname: 'ซ้ำเสี่ยง',
          cid: '1234567890121',
          birthday: '1992-01-01',
          preg_no: 1,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          anc_register_date: '2025-08-01',
        },
      ];
      const ancServices: HosxpAncServiceRow[] = [];
      const ancRisks: HosxpAncRiskRow[] = [];
      const ancClassifying: HosxpAncClassifyingRow[] = [];

      await syncAncData(
        db,
        hospitalId,
        ancPatients,
        ancServices,
        ancRisks,
        ancClassifying,
        ENCRYPTION_KEY,
      );
      await syncAncData(
        db,
        hospitalId,
        ancPatients,
        ancServices,
        ancRisks,
        ancClassifying,
        ENCRYPTION_KEY,
      );

      const journeys = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [hospitalId, 'HN-ANC-DEDUP'],
      );
      expect(journeys).toHaveLength(1);

      const rows = await db.query('SELECT id FROM cached_anc_risks WHERE journey_id = ?', [
        journeys[0].id,
      ]);
      expect(rows.length).toBe(1);
    });

    // ─── T3: completeness-aware, no-downgrade risk engine (WHO containment) ────

    it('payload lacking vitals records missingRequired and fabricates no values', async () => {
      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 1001,
          person_id: 500,
          hn: 'HN-ANC-INCOMPLETE',
          pname: 'นาง',
          fname: 'ไร้',
          lname: 'สัญญาณชีพ',
          cid: '1234567890121',
          birthday: '1994-01-01',
          preg_no: 1,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          anc_register_date: '2025-08-01',
        },
      ];

      // No service rows → no height/weight/BP; and this path never provides
      // o2Sat/hct/hb → all seven mandatory inputs are missing.
      await syncAncData(db, hospitalId, ancPatients, [], [], [], ENCRYPTION_KEY);

      const journeys = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [hospitalId, 'HN-ANC-INCOMPLETE'],
      );
      expect(journeys).toHaveLength(1);

      const rows = await db.query<{ risk_factors: unknown }>(
        'SELECT risk_factors FROM cached_anc_risks WHERE journey_id = ?',
        [journeys[0].id],
      );
      expect(rows).toHaveLength(1);
      const rf = rows[0].risk_factors;
      const parsed = (typeof rf === 'string' ? JSON.parse(rf) : rf) as {
        missingRequired: string[];
        assessmentIncomplete: boolean;
      };
      expect(parsed.assessmentIncomplete).toBe(true);
      expect(parsed.missingRequired).toEqual(
        expect.arrayContaining([
          'heightCm',
          'prePregnancyBmi',
          'bpSystolic',
          'bpDiastolic',
          'o2Sat',
          'hct',
          'hb',
        ]),
      );
      // risk_factors carries ONLY completeness metadata — no fabricated vitals.
      expect(new Set(Object.keys(parsed))).toEqual(
        new Set(['missingRequired', 'assessmentIncomplete']),
      );
      // No visit rows were fabricated either.
      const visits = await db.query('SELECT id FROM cached_anc_visits WHERE journey_id = ?', [
        journeys[0].id,
      ]);
      expect(visits).toHaveLength(0);
    });

    it('incomplete finding-free re-sync does not downgrade an HR3 journey', async () => {
      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 1001,
          person_id: 500,
          hn: 'HN-ANC-NODOWN',
          pname: 'นาง',
          fname: 'ไม่ลด',
          lname: 'ความเสี่ยง',
          cid: '1234567890121',
          birthday: '1994-01-01',
          preg_no: 1,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          anc_register_date: '2025-08-01',
        },
      ];

      // First sync carries an HR3 finding (placenta accreta = anc_risk_id 16).
      const hr3Risks: HosxpAncRiskRow[] = [
        { person_anc_risk_id: 7001, person_anc_id: 1001, anc_risk_id: 16 },
      ];
      await syncAncData(db, hospitalId, ancPatients, [], hr3Risks, [], ENCRYPTION_KEY);

      const journeys = await db.query<{ id: string }>(
        'SELECT id FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [hospitalId, 'HN-ANC-NODOWN'],
      );
      const journeyId = journeys[0].id;

      const afterFirst = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(afterFirst[0].anc_risk_level).toBe(AncRiskLevel.HR3);

      // Second sync: HR3 finding gone AND no vitals → derived LOW, but the
      // assessment is incomplete → the engine must NOT downgrade.
      await syncAncData(db, hospitalId, ancPatients, [], [], [], ENCRYPTION_KEY);

      const afterSecond = await db.query<{ anc_risk_level: string }>(
        'SELECT anc_risk_level FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(afterSecond[0].anc_risk_level).toBe(AncRiskLevel.HR3);

      // The rejected LOW assessment was NOT appended — every row is still HR3.
      const rows = await db.query<{ risk_level: string }>(
        'SELECT risk_level FROM cached_anc_risks WHERE journey_id = ? ORDER BY screened_at, created_at',
        [journeyId],
      );
      expect(rows.every((r) => r.risk_level === AncRiskLevel.HR3)).toBe(true);
      expect(rows.some((r) => r.risk_level === AncRiskLevel.LOW)).toBe(false);
    });

    it('a real abnormal vital still escalates an incomplete assessment', async () => {
      const ancPatients: HosxpPersonAncRow[] = [
        {
          person_anc_id: 1001,
          person_id: 500,
          hn: 'HN-ANC-ESCALATE',
          pname: 'นาง',
          fname: 'ความดัน',
          lname: 'สูง',
          cid: '1234567890121',
          birthday: '1994-01-01',
          preg_no: 1,
          lmp: '2025-06-01',
          edc: '2026-03-08',
          anc_register_date: '2025-08-01',
        },
      ];
      // Real, elevated BP (150/100) → hr2_bp fires even though o2Sat/hct/hb are
      // never available in this path (assessment stays incomplete).
      const ancServices: HosxpAncServiceRow[] = [
        {
          person_anc_service_id: 2001,
          person_anc_id: 1001,
          service_date: '2025-09-01',
          anc_service_number: 1,
          pa_week: 12,
          pa_day: 0,
          fundal_height: 10,
          bw: 55,
          bps: 150,
          bpd: 100,
          height: 160,
          fetal_heart_rate: 140,
          baby_position: null,
          baby_lead: null,
          pass_quality: null,
          doctor_code: null,
        },
      ];

      await syncAncData(db, hospitalId, ancPatients, ancServices, [], [], ENCRYPTION_KEY);

      const journeys = await db.query<{ id: string; anc_risk_level: string }>(
        'SELECT id, anc_risk_level FROM maternal_journeys WHERE hospital_id = ? AND hn = ?',
        [hospitalId, 'HN-ANC-ESCALATE'],
      );
      expect(journeys[0].anc_risk_level).toBe(AncRiskLevel.HR2);

      const rows = await db.query<{ risk_level: string; triggered_rules: unknown }>(
        'SELECT risk_level, triggered_rules FROM cached_anc_risks WHERE journey_id = ?',
        [journeys[0].id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].risk_level).toBe(AncRiskLevel.HR2);
      const tr = rows[0].triggered_rules;
      const triggered = (typeof tr === 'string' ? JSON.parse(tr) : tr) as string[];
      expect(triggered).toContain('hr2_bp');
    });
  });

  // --- linkJourneyToLabor Tests ---

  describe('linkJourneyToLabor', () => {
    it('should link existing pregnancy journey to labor admission', async () => {
      // Pre-create a pregnancy journey
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-LINK-001',
        personAncId: 5001,
        name: 'test-encrypted',
        cid: 'enc_test_207',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000108',
        age: 28,
        gravida: 2,
        para: 1,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      expect(journey.careStage).toBe(CareStage.PREGNANCY);

      // Simulate a cached_patient that was just upserted from labor data
      const now = new Date().toISOString();
      const { v4: uuidv4 } = await import('uuid');
      const cachedPatientId = uuidv4();
      await db.execute(
        `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [
          cachedPatientId,
          hospitalId,
          'HN-LINK-001',
          'AN-LINK-001',
          'test',
          28,
          '2026-03-08',
          now,
          now,
          now,
        ],
      );

      // Link the labor admission to the pregnancy journey
      const linkedJourneyId = await linkJourneyToLabor(
        db,
        hospitalId,
        'HN-LINK-001',
        cachedPatientId,
      );

      expect(linkedJourneyId).toBe(journey.id);

      // Verify journey was transitioned to LABOR
      const updatedJourney = await db.query<{ care_stage: string }>(
        'SELECT care_stage FROM maternal_journeys WHERE id = ?',
        [journey.id],
      );
      expect(updatedJourney[0].care_stage).toBe(CareStage.LABOR);

      // Verify cached_patient is linked
      const patient = await db.query<{ journey_id: string | null }>(
        'SELECT journey_id FROM cached_patients WHERE id = ?',
        [cachedPatientId],
      );
      expect(patient[0].journey_id).toBe(journey.id);
    });

    it('should auto-create journey for walk-in labor (no prior ANC)', async () => {
      const now = new Date().toISOString();
      const { v4: uuidv4 } = await import('uuid');
      const cachedPatientId = uuidv4();

      // Insert a cached_patient with no prior journey
      await db.execute(
        `INSERT INTO cached_patients (id, hospital_id, hn, an, name, age, admit_date, labor_status, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        [
          cachedPatientId,
          hospitalId,
          'HN-WALKIN-001',
          'AN-WALKIN-001',
          'test',
          22,
          '2026-03-08',
          now,
          now,
          now,
        ],
      );

      // Link should auto-create a journey
      const journeyId = await linkJourneyToLabor(db, hospitalId, 'HN-WALKIN-001', cachedPatientId);

      expect(journeyId).toBeDefined();
      expect(typeof journeyId).toBe('string');

      // Verify the auto-created journey is in LABOR stage
      const journey = await db.query<{ care_stage: string; hn: string }>(
        'SELECT care_stage, hn FROM maternal_journeys WHERE id = ?',
        [journeyId],
      );
      expect(journey).toHaveLength(1);
      expect(journey[0].care_stage).toBe(CareStage.LABOR);
      expect(journey[0].hn).toBe('HN-WALKIN-001');

      // Verify cached_patient is linked
      const patient = await db.query<{ journey_id: string | null }>(
        'SELECT journey_id FROM cached_patients WHERE id = ?',
        [cachedPatientId],
      );
      expect(patient[0].journey_id).toBe(journeyId);
    });
  });

  // --- syncNewbornData Tests ---

  describe('syncNewbornData', () => {
    it('should create newborn records and transition journey to DELIVERED', async () => {
      // Create a LABOR journey first
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-NB-001',
        personAncId: null,
        name: 'test-encrypted',
        cid: 'enc_test_208',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000109',
        age: 30,
        gravida: 1,
        para: 0,
        lmp: '2025-06-01',
        edc: '2026-03-08',
        ancRiskLevel: AncRiskLevel.LOW,
      });

      // Transition to LABOR first (simulating normal flow)
      await db.execute(`UPDATE maternal_journeys SET care_stage = 'LABOR' WHERE id = ?`, [
        journey.id,
      ]);

      // syncNewbornData receives rows AFTER infant_number hygiene — the
      // sanitized type guarantees the NOT NULL upsert key is present.
      const infantRows: SanitizedInfantRow[] = [
        {
          ipt_labour_infant_id: 9001,
          ipt_labour_id: 8001,
          an: 'AN-NB-001',
          infant_number: 1,
          sex: 'M',
          birth_weight: 3200,
          body_length: 50,
          head_length: 34,
          temperature: 36.8,
          rr: 40,
          hr: 140,
          apgar_score_min1: 8,
          apgar_score_min5: 9,
          apgar_score_min10: 10,
          infant_check_ppv: 'N',
          infant_check_et_tube: 'N',
          infant_check_chest_pump: 'N',
          infant_check_oxygen_box: 'N',
          infant_check_narcan: 'N',
          infant_check_feed_milk: 'Y',
          infant_check_vitk: 'Y',
          infant_check_eyepaste: 'Y',
          infant_check_bcg: 'Y',
          infant_check_hepb: 'Y',
          infant_check_azt: 'N',
          infant_icd10: 'Z38.0',
          infant_hn: 'HN-BABY-001',
          infant_an: 'AN-BABY-001',
          infant_dchstts: 'normal',
          birth_date: '2026-03-08',
          birth_time: '14:30:00',
        },
      ];

      const count = await syncNewbornData(db, journey.id, infantRows);
      expect(count).toBe(1);

      // Verify newborn was created
      const newborns = await db.query<{
        journey_id: string;
        infant_number: number;
        sex: string;
        birth_weight_g: number;
        apgar_1min: number;
        apgar_5min: number;
      }>(
        'SELECT journey_id, infant_number, sex, birth_weight_g, apgar_1min, apgar_5min FROM cached_newborns WHERE journey_id = ?',
        [journey.id],
      );
      expect(newborns).toHaveLength(1);
      expect(newborns[0].infant_number).toBe(1);
      expect(newborns[0].sex).toBe('M');
      expect(newborns[0].birth_weight_g).toBe(3200);
      expect(newborns[0].apgar_1min).toBe(8);
      expect(newborns[0].apgar_5min).toBe(9);

      // Verify journey was transitioned to DELIVERED
      const updatedJourney = await db.query<{ care_stage: string }>(
        'SELECT care_stage FROM maternal_journeys WHERE id = ?',
        [journey.id],
      );
      expect(updatedJourney[0].care_stage).toBe(CareStage.DELIVERED);
    });

    it('should handle empty infant rows without transitioning journey', async () => {
      const journey = await createJourney(db, {
        hospitalId,
        hn: 'HN-NB-002',
        personAncId: null,
        name: 'test-encrypted',
        cid: 'enc_test_209',
        cidHash: 'testhash00000000000000000000000000000000000000000000000000000110',
        age: 25,
        gravida: 1,
        para: 0,
        lmp: null,
        edc: null,
        ancRiskLevel: AncRiskLevel.LOW,
      });

      await db.execute(`UPDATE maternal_journeys SET care_stage = 'LABOR' WHERE id = ?`, [
        journey.id,
      ]);

      const count = await syncNewbornData(db, journey.id, []);
      expect(count).toBe(0);

      // Journey should still be in LABOR (not transitioned)
      const updatedJourney = await db.query<{ care_stage: string }>(
        'SELECT care_stage FROM maternal_journeys WHERE id = ?',
        [journey.id],
      );
      expect(updatedJourney[0].care_stage).toBe(CareStage.LABOR);
    });
  });
});
