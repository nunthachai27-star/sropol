// T24: getHospitalPatientList must surface partograph_severity +
// partograph_alert_count from cached_patients so dashboards can render a
// severity dot without an extra fetch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { SchemaSync } from '@/db/schema-sync';
import { ALL_TABLES } from '@/db/tables/index';
import { SeedOrchestrator } from '@/db/seeds/index';
import { getHospitalPatientList } from '@/services/dashboard';

interface PartographPatientShape {
  partographSeverity: 'INFO' | 'WARN' | 'ALERT' | 'CRITICAL' | null;
  partographAlertCount: number | null;
}

describe('getHospitalPatientList — partograph severity surface', () => {
  let db: SqliteAdapter;
  let hospitalId: string;
  const hcode = '10670';

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await SchemaSync.sync(db, ALL_TABLES, 'sqlite');
    await new SeedOrchestrator().run(db);

    const hospitals = await db.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE hcode = ? LIMIT 1', [hcode],
    );
    hospitalId = hospitals[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  async function insertPatient(opts: {
    hn: string;
    an: string;
    severity?: string | null;
    alertCount?: number | null;
  }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO cached_patients
        (id, hospital_id, hn, an, name, age, admit_date, labor_status,
         partograph_severity, partograph_alert_count,
         synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, hospitalId, opts.hn, opts.an, 'enc-name', 28,
        now, 'ACTIVE',
        opts.severity ?? null,
        opts.alertCount ?? null,
        now, now, now,
      ],
    );
    return id;
  }

  it('exposes partographSeverity + partographAlertCount on each patient row', async () => {
    await insertPatient({
      hn: 'HN-CRIT', an: 'AN-CRIT',
      severity: 'CRITICAL', alertCount: 3,
    });

    const result = await getHospitalPatientList(db, hcode, { status: 'active' });
    expect(result.patients).toHaveLength(1);
    const row = result.patients[0] as unknown as PartographPatientShape;
    expect(row.partographSeverity).toBe('CRITICAL');
    expect(row.partographAlertCount).toBe(3);
  });

  it('returns nulls for patients without partograph data', async () => {
    await insertPatient({ hn: 'HN-NONE', an: 'AN-NONE' });

    const result = await getHospitalPatientList(db, hcode, { status: 'active' });
    expect(result.patients).toHaveLength(1);
    const row = result.patients[0] as unknown as PartographPatientShape;
    expect(row.partographSeverity).toBeNull();
    expect(row.partographAlertCount).toBeNull();
  });
});
