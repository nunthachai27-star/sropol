// The active-labor query gated "is this a maternity patient?" solely on
// ward.is_maternity_ward='Y'. Hospitals that never configure that flag on their
// CURRENT labor ward (e.g. รพ.ท่าตูม — its flagged ward W40 was abandoned in
// 2015; live deliveries go to an unflagged ward; likewise hcode 99999) show an
// empty labor board even though patients are actively delivering.
//
// Detect a maternity patient by the OBSTETRIC DATA SIGNAL, not just the ward
// config: still-admitted AND (maternity ward OR has an ipt_pregnancy admission
// record OR has an ipt_labour delivery record). Works without per-hospital ward
// setup while staying additive — every patient the old ward-flag path captured
// is still captured.
//
// Runs the exact exported SQL against PGlite (Postgres); verified live that the
// query executes on a HOSxP Postgres instance.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SQL_ACTIVE_LABOUR } from '@/lib/browser-poll';

async function seed() {
  const db = await PGlite.create();
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

    -- ward 11 is flagged maternity; ward 10 is NOT (ท่าตูม's real-but-unflagged case)
    INSERT INTO ward VALUES ('11','สูติกรรม','Y');
    INSERT INTO ward VALUES ('10','อายุรกรรม',NULL);
    INSERT INTO patient VALUES ('H1','นาง','a','a','1234567890123','1995-01-01',158);
    INSERT INTO patient VALUES ('H2','นาง','b','b','1234567890124','1995-01-01',158);
    INSERT INTO patient VALUES ('H3','นาง','c','c','1234567890125','1995-01-01',158);
    INSERT INTO patient VALUES ('H4','นาง','d','d','1234567890126','1995-01-01',158);
    INSERT INTO patient VALUES ('H5','นาง','e','e','1234567890127','1995-01-01',158);

    -- captured via the maternity-ward FLAG (no obstetric record yet)
    INSERT INTO ipt VALUES ('AN-WARD','H1','2026-06-30','08:00',NULL,'11','N',3);
    -- captured via ipt_LABOUR record in an UNFLAGGED ward (the ท่าตูม/99999 case)
    INSERT INTO ipt VALUES ('AN-LABOR','H2','2026-06-30','08:00',NULL,'10','N',3);
    INSERT INTO ipt_labour (an) VALUES ('AN-LABOR');
    -- captured via ipt_PREGNANCY record in an UNFLAGGED ward
    INSERT INTO ipt VALUES ('AN-PREG','H3','2026-06-30','08:00',NULL,'10','N',3);
    INSERT INTO ipt_pregnancy (an) VALUES ('AN-PREG');
    -- NOT maternity at all (unflagged ward, no obstetric record) -> excluded
    INSERT INTO ipt VALUES ('AN-OTHER','H4','2026-06-30','08:00',NULL,'10','N',3);
    -- maternity + labor record but DISCHARGED (dchdate > regdate) -> excluded
    INSERT INTO ipt VALUES ('AN-DISCH','H5','2026-06-01','08:00','2026-06-02','11','N',3);
    INSERT INTO ipt_labour (an) VALUES ('AN-DISCH');
  `);
  return db;
}

describe('SQL_ACTIVE_LABOUR detects maternity patients by obstetric record, not just ward flag', () => {
  it('captures ward-flagged, ipt_labour, and ipt_pregnancy patients; excludes non-obstetric and discharged', async () => {
    const db = await seed();
    const ans = (await db.query<{ an: string }>(SQL_ACTIVE_LABOUR)).rows.map((r) => r.an);
    expect(ans).toContain('AN-WARD'); // maternity ward flag
    expect(ans).toContain('AN-LABOR'); // ipt_labour in an unflagged ward
    expect(ans).toContain('AN-PREG'); // ipt_pregnancy in an unflagged ward
    expect(ans).not.toContain('AN-OTHER'); // no obstetric signal
    expect(ans).not.toContain('AN-DISCH'); // discharged
  });
});
