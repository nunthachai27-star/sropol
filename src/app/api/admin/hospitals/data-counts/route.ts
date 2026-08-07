// GET /api/admin/hospitals/data-counts — per-hospital row counts across the
// cached clinical/operational tables. Powers the "DATA" column on the admin
// Hospitals tab so an operator can see at-a-glance which hospitals are
// holding data before opening the Danger Zone.
//
// One GROUP BY query per table (9 round-trips total), then aggregated in
// memory by hcode. This is ~25× cheaper than calling the per-hospital count
// endpoint once per row when the registered-hospital list grows.
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { requireAdmin } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';

interface PerHospitalCount {
  hospital_id: string;
  cnt: number | string;
}

const PER_HOSPITAL_TABLES = [
  // tables with their own hospital_id column
  {
    key: 'cached_patients',
    sql: 'SELECT hospital_id, COUNT(*) AS cnt FROM cached_patients GROUP BY hospital_id',
  },
  {
    key: 'cached_partograph_observations',
    sql: 'SELECT hospital_id, COUNT(*) AS cnt FROM cached_partograph_observations GROUP BY hospital_id',
  },
  {
    key: 'cached_anc_visits',
    sql: 'SELECT hospital_id, COUNT(*) AS cnt FROM cached_anc_visits WHERE hospital_id IS NOT NULL GROUP BY hospital_id',
  },
];

const JOURNEY_HOSPITAL_TABLES = [
  // tables that hang off maternal_journeys; the count attributes to the
  // journey's home hospital_id (current_hospital_id is also resolved below)
  { key: 'maternal_journeys', countCol: 'id' },
  { key: 'cached_anc_risks', joinCol: 'journey_id' },
  { key: 'cached_newborns', joinCol: 'journey_id' },
];

const PATIENT_CHILD_TABLES = [
  // cpd_scores + cached_vital_signs hang off cached_patients
  { key: 'cpd_scores' },
  { key: 'cached_vital_signs' },
];

export async function GET() {
  try {
    const guard = await requireAdmin();
    if (guard instanceof NextResponse) return guard;

    await ensureInit();
    const db = await getDatabase();

    const hospitals = await db.query<{ id: string; hcode: string }>(
      'SELECT id, hcode FROM hospitals WHERE is_active = true',
    );
    const idToHcode = new Map<string, string>();
    for (const h of hospitals) idToHcode.set(h.id, h.hcode);

    // Per-hcode running totals — initialised to zero for all known hospitals
    // so the response always carries a row even when the hospital has no data.
    type Counts = Record<string, number>;
    const perHcode = new Map<string, Counts>();
    for (const h of hospitals) perHcode.set(h.hcode, {});

    const addCount = (hospitalId: string, key: string, raw: number | string) => {
      const hcode = idToHcode.get(hospitalId);
      if (!hcode) return; // ignore rows for hospitals not in the active list
      const bucket = perHcode.get(hcode)!;
      const n = typeof raw === 'string' ? Number(raw) : raw;
      bucket[key] = (bucket[key] ?? 0) + (Number.isFinite(n) ? n : 0);
    };

    // 1. Tables that carry their own hospital_id
    for (const t of PER_HOSPITAL_TABLES) {
      const rows = await db.query<PerHospitalCount>(t.sql);
      for (const r of rows) addCount(r.hospital_id, t.key, r.cnt);
    }

    // 2. cached_referrals counts both sides
    {
      const rows = await db.query<{ hospital_id: string; cnt: number | string }>(
        `SELECT from_hospital_id AS hospital_id, COUNT(*) AS cnt FROM cached_referrals GROUP BY from_hospital_id
         UNION ALL
         SELECT to_hospital_id AS hospital_id, COUNT(*) AS cnt FROM cached_referrals GROUP BY to_hospital_id`,
      );
      for (const r of rows) addCount(r.hospital_id, 'cached_referrals', r.cnt);
    }

    // 3. maternal_journeys + journey-children — attribute to the journey's
    //    hospital_id (home hospital). current_hospital_id is added separately
    //    so referred-out journeys show up at their CURRENT hospital too.
    {
      const rows = await db.query<{ hospital_id: string; cnt: number | string }>(
        'SELECT hospital_id, COUNT(*) AS cnt FROM maternal_journeys GROUP BY hospital_id',
      );
      for (const r of rows) addCount(r.hospital_id, 'maternal_journeys', r.cnt);
    }
    {
      // Journeys whose current_hospital_id != hospital_id — the "currently
      // sitting at" location. Using DISTINCT so we don't double-count when
      // current = home.
      const rows = await db.query<{ hospital_id: string; cnt: number | string }>(
        `SELECT current_hospital_id AS hospital_id, COUNT(*) AS cnt
           FROM maternal_journeys
          WHERE current_hospital_id IS NOT NULL
            AND current_hospital_id <> hospital_id
          GROUP BY current_hospital_id`,
      );
      for (const r of rows) addCount(r.hospital_id, 'maternal_journeys', r.cnt);
    }
    for (const t of JOURNEY_HOSPITAL_TABLES) {
      if (t.key === 'maternal_journeys') continue; // handled above

      const rows = await db.query<{ hospital_id: string; cnt: number | string }>(
        `SELECT mj.hospital_id, COUNT(*) AS cnt
           FROM ${t.key} child
           JOIN maternal_journeys mj ON mj.id = child.journey_id
          GROUP BY mj.hospital_id`,
      );
      for (const r of rows) addCount(r.hospital_id, t.key, r.cnt);
    }

    // 4. cached_patients children — attribute to the patient's hospital_id
    for (const t of PATIENT_CHILD_TABLES) {
      const rows = await db.query<{ hospital_id: string; cnt: number | string }>(
        `SELECT cp.hospital_id, COUNT(*) AS cnt
           FROM ${t.key} child
           JOIN cached_patients cp ON cp.id = child.patient_id
          GROUP BY cp.hospital_id`,
      );
      for (const r of rows) addCount(r.hospital_id, t.key, r.cnt);
    }

    // Flatten to response shape
    const counts: Record<string, { totalRows: number; perTable: Counts }> = {};
    for (const [hcode, perTable] of perHcode) {
      const totalRows = Object.values(perTable).reduce((a, b) => a + b, 0);
      counts[hcode] = { totalRows, perTable };
    }

    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    logger.error('admin_hospital_data_counts_failed', { error });
    return NextResponse.json(
      {
        error: 'failed_to_compute_data_counts',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
