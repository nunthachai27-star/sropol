// Regression: the active-labor query decides "still in ward" solely from
// ipt.confirm_discharge='N'. At hospitals that do NOT run the "ยืนยันการจำหน่าย"
// (discharge-confirm) workflow — e.g. รพ.ท่าตูม on HOSxP V.3 — confirm_discharge
// stays 'N' forever, so the labor ward bloats with every past admission
// (discharged patients keep confirm_discharge='N' but have a clinical dchdate).
// The query must ALSO require dchdate IS NULL so it reflects who is truly still
// admitted, on both discharge-confirming and non-confirming sites.
//
// Runs the EXACT exported SQL against PGlite (real Postgres) — the query is
// MySQL-flavour but portable enough that it executes on Postgres (verified live
// against a HOSxP PostgreSQL instance).
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SQL_ACTIVE_LABOUR, SQL_PARTOGRAPH } from '@/lib/browser-poll';

async function seedHosxp() {
  const db = await PGlite.create();
  // Minimal HOSxP schema covering every table the queries touch. The LEFT
  // JOINs and the pre-pregnancy-weight subquery tolerate empty tables.
  await db.exec(`
    CREATE TABLE ward (ward text, name text, is_maternity_ward text);
    CREATE TABLE patient (hn text, pname text, fname text, lname text, cid text, birthday date, height numeric);
    CREATE TABLE ipt (an text, hn text, regdate date, regtime text, dchdate date, ward text, confirm_discharge text, ipt_admit_type_id int);
    CREATE TABLE ipt_labour (an text, g int, p int, a int, l int, preg_no int, ga numeric, ga_day int, anc_count int);
    CREATE TABLE ipt_pregnancy (an text, ga numeric);
    CREATE TABLE ipt_pregnancy_vital_sign (an text, bw numeric, hct numeric, bps numeric, bpd numeric, hr numeric, rr numeric, temperature numeric, cervical_open_size numeric, eff numeric, station text);
    CREATE TABLE person_anc_screen (bw numeric, person_anc_service_id int);
    CREATE TABLE person_anc_service (person_anc_service_id int, person_anc_id int);
    CREATE TABLE person_anc (person_anc_id int, person_id int);
    CREATE TABLE person (person_id int, cid text);
    CREATE TABLE ipt_labour_partograph (ipt_labour_partograph_id int, an text, observe_datetime timestamptz, hour_no int,
      fetal_heart_rate int, amniotic_fluid text, labour_amniotic_type_id int, moulding text, cervical_dilation_cm numeric,
      descent_of_head text, contraction_per_10min int, contraction_duration_sec int, contraction_strength text,
      oxytocin_uml numeric, oxytocin_drops_min numeric, drugs_iv_fluids text, pulse int, bp_systolic int, bp_diastolic int,
      temperature numeric, urine_volume_ml int, urine_protein text, urine_glucose text, urine_acetone text, note text,
      entry_staff text, entry_datetime timestamptz);

    INSERT INTO ward VALUES ('11','สูติกรรม','Y');
    INSERT INTO patient VALUES ('HN1','นาง','ก','ข','1234567890123','1995-01-01',158);
    INSERT INTO patient VALUES ('HN2','นาง','ค','ง','1234567890124','1994-01-01',160);
    -- still in ward: dchdate NULL, confirm 'N'
    INSERT INTO ipt VALUES ('AN-ACTIVE','HN1','2026-06-30','08:00',NULL,'11','N',3);
    -- discharged long ago but never confirm-discharged (ท่าตูม case):
    -- dchdate SET, confirm still 'N'
    INSERT INTO ipt VALUES ('AN-DISCH','HN2','2026-01-01','08:00','2026-01-03','11','N',3);
    -- a partograph row for each so the partograph query has candidates
    INSERT INTO ipt_labour_partograph (ipt_labour_partograph_id, an, observe_datetime) VALUES (1,'AN-ACTIVE','2026-06-30T09:00:00Z');
    INSERT INTO ipt_labour_partograph (ipt_labour_partograph_id, an, observe_datetime) VALUES (2,'AN-DISCH','2026-01-02T09:00:00Z');
  `);
  return db;
}

describe('active-labor queries exclude discharged (dchdate) patients', () => {
  it('SQL_ACTIVE_LABOUR returns only the still-admitted patient', async () => {
    const db = await seedHosxp();
    const rows = (await db.query<{ an: string }>(SQL_ACTIVE_LABOUR)).rows;
    const ans = rows.map((r) => r.an);
    expect(ans).toContain('AN-ACTIVE');
    expect(ans).not.toContain('AN-DISCH');
  });

  it('SQL_PARTOGRAPH returns only observations for still-admitted patients', async () => {
    const db = await seedHosxp();
    const rows = (await db.query<{ an: string }>(SQL_PARTOGRAPH)).rows;
    const ans = rows.map((r) => r.an);
    expect(ans).toContain('AN-ACTIVE');
    expect(ans).not.toContain('AN-DISCH');
  });
});
