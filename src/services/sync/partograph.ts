// T17: Partograph upsert + per-patient severity roll-up
//
// Single entry point for the polling and webhook ingestion paths. Inserts /
// updates rows in cached_partograph_observations using a SELECT-then-
// INSERT/UPDATE pattern (avoids dialect-specific ON CONFLICT syntax so the
// same code path runs on SQLite, Postgres and pglite). After all rows are
// applied, recomputes CDSS severity for each touched patient via the shared
// analyzePartograph() service and writes the roll-up onto cached_patients.
//
// DRY note: callers (polling.ts, webhook.ts) MUST call this function instead
// of poking cached_partograph_observations directly so the severity roll-up
// stays correct.
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseAdapter } from '@/db/adapter';
import type {
  CdssSeverity,
  PartographObservationDto,
} from '@/types/api';
import {
  analyzePartograph,
  highestSeverity,
} from '@/services/partogram';

export interface PartographRow {
  hospitalId: string;
  patientId: string;
  sourceSystem: string;
  sourcePk: string;
  observeDatetime: string;
  hourNo: number | null;
  fetalHeartRate: number | null;
  amnioticFluid: string | null;
  amnioticTypeId: number | null;
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
  entryDatetime: string | null;
  action?: 'upsert' | 'delete';
}

export interface SeverityChange {
  patientId: string;
  an: string;
  from: CdssSeverity | null;
  to: CdssSeverity | null;
  alertCount: number;
}

export interface UpsertPartographResult {
  upserted: number;
  deleted: number;
  severityChanges: SeverityChange[];
}

interface StoredObservationRow {
  id: string;
  observe_datetime: string;
  hour_no: number | null;
  fetal_heart_rate: number | null;
  amniotic_fluid: string | null;
  amniotic_type_name: string | null;
  moulding: string | null;
  cervical_dilation_cm: number | string | null;
  descent_of_head: string | null;
  contraction_per_10min: number | null;
  contraction_duration_sec: number | null;
  contraction_strength: string | null;
  oxytocin_uml: number | string | null;
  oxytocin_drops_min: number | null;
  drugs_iv_fluids: string | null;
  pulse: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  temperature: number | string | null;
  urine_volume_ml: number | null;
  urine_protein: string | null;
  urine_glucose: string | null;
  urine_acetone: string | null;
  note: string | null;
  entry_staff: string | null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDto(row: StoredObservationRow): PartographObservationDto {
  return {
    id: row.id,
    observeDatetime: row.observe_datetime,
    hourNo: row.hour_no,
    fetalHeartRate: row.fetal_heart_rate,
    amnioticFluid: row.amniotic_fluid,
    amnioticTypeName: row.amniotic_type_name,
    moulding: row.moulding,
    cervicalDilationCm: toNum(row.cervical_dilation_cm),
    descentOfHead: row.descent_of_head,
    contractionPer10Min: row.contraction_per_10min,
    contractionDurationSec: row.contraction_duration_sec,
    contractionStrength: row.contraction_strength,
    oxytocinUml: toNum(row.oxytocin_uml),
    oxytocinDropsMin: row.oxytocin_drops_min,
    drugsIvFluids: row.drugs_iv_fluids,
    pulse: row.pulse,
    bpSystolic: row.bp_systolic,
    bpDiastolic: row.bp_diastolic,
    temperature: toNum(row.temperature),
    urineVolumeMl: row.urine_volume_ml,
    urineProtein: row.urine_protein,
    urineGlucose: row.urine_glucose,
    urineAcetone: row.urine_acetone,
    note: row.note,
    entryStaff: row.entry_staff,
  };
}

export async function upsertPartographObservations(
  db: DatabaseAdapter,
  hospitalId: string,
  rows: PartographRow[],
): Promise<UpsertPartographResult> {
  let upserted = 0;
  let deleted = 0;
  const touchedPatients = new Map<string, true>();
  const now = new Date().toISOString();

  for (const row of rows) {
    if (row.action === 'delete') {
      // Look up first so we can detect whether anything was actually removed.
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM cached_partograph_observations
         WHERE hospital_id = ? AND source_system = ? AND source_pk = ?`,
        [hospitalId, row.sourceSystem, row.sourcePk],
      );
      if (existing.length > 0) {
        await db.execute(
          `DELETE FROM cached_partograph_observations WHERE id = ?`,
          [existing[0].id],
        );
        deleted += 1;
        touchedPatients.set(row.patientId, true);
      }
      continue;
    }

    // Two-phase UPSERT: SELECT by unique key, then UPDATE-or-INSERT.
    // Mirrors the pattern in src/services/sync/patient.ts so the same
    // code runs across SQLite/Postgres/pglite without ON CONFLICT.
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM cached_partograph_observations
       WHERE hospital_id = ? AND source_system = ? AND source_pk = ?`,
      [hospitalId, row.sourceSystem, row.sourcePk],
    );

    if (existing.length > 0) {
      await db.execute(
        `UPDATE cached_partograph_observations SET
          patient_id = ?, observe_datetime = ?, hour_no = ?,
          fetal_heart_rate = ?, amniotic_fluid = ?, amniotic_type_id = ?,
          amniotic_type_name = ?, moulding = ?, cervical_dilation_cm = ?,
          descent_of_head = ?, contraction_per_10min = ?,
          contraction_duration_sec = ?, contraction_strength = ?,
          oxytocin_uml = ?, oxytocin_drops_min = ?, drugs_iv_fluids = ?,
          pulse = ?, bp_systolic = ?, bp_diastolic = ?, temperature = ?,
          urine_volume_ml = ?, urine_protein = ?, urine_glucose = ?,
          urine_acetone = ?, note = ?, entry_staff = ?, entry_datetime = ?,
          synced_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          row.patientId, row.observeDatetime, row.hourNo,
          row.fetalHeartRate, row.amnioticFluid, row.amnioticTypeId,
          row.amnioticTypeName, row.moulding, row.cervicalDilationCm,
          row.descentOfHead, row.contractionPer10Min,
          row.contractionDurationSec, row.contractionStrength,
          row.oxytocinUml, row.oxytocinDropsMin, row.drugsIvFluids,
          row.pulse, row.bpSystolic, row.bpDiastolic, row.temperature,
          row.urineVolumeMl, row.urineProtein, row.urineGlucose,
          row.urineAcetone, row.note, row.entryStaff, row.entryDatetime,
          now, now,
          existing[0].id,
        ],
      );
    } else {
      await db.execute(
        `INSERT INTO cached_partograph_observations (
          id, patient_id, hospital_id, source_system, source_pk,
          observe_datetime, hour_no,
          fetal_heart_rate, amniotic_fluid, amniotic_type_id,
          amniotic_type_name, moulding, cervical_dilation_cm,
          descent_of_head, contraction_per_10min,
          contraction_duration_sec, contraction_strength,
          oxytocin_uml, oxytocin_drops_min, drugs_iv_fluids,
          pulse, bp_systolic, bp_diastolic, temperature,
          urine_volume_ml, urine_protein, urine_glucose,
          urine_acetone, note, entry_staff, entry_datetime,
          synced_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )`,
        [
          uuidv4(), row.patientId, hospitalId, row.sourceSystem, row.sourcePk,
          row.observeDatetime, row.hourNo,
          row.fetalHeartRate, row.amnioticFluid, row.amnioticTypeId,
          row.amnioticTypeName, row.moulding, row.cervicalDilationCm,
          row.descentOfHead, row.contractionPer10Min,
          row.contractionDurationSec, row.contractionStrength,
          row.oxytocinUml, row.oxytocinDropsMin, row.drugsIvFluids,
          row.pulse, row.bpSystolic, row.bpDiastolic, row.temperature,
          row.urineVolumeMl, row.urineProtein, row.urineGlucose,
          row.urineAcetone, row.note, row.entryStaff, row.entryDatetime,
          now, now, now,
        ],
      );
    }

    upserted += 1;
    touchedPatients.set(row.patientId, true);
  }

  // Recompute severity per touched patient (one CDSS pass each, not per row).
  const severityChanges: SeverityChange[] = [];
  for (const patientId of touchedPatients.keys()) {
    const patientRows = await db.query<{
      id: string;
      an: string;
      partograph_severity: string | null;
    }>(
      `SELECT id, an, partograph_severity
         FROM cached_patients WHERE id = ?`,
      [patientId],
    );
    if (patientRows.length === 0) continue;
    const an = patientRows[0].an;
    const prevSeverity =
      (patientRows[0].partograph_severity as CdssSeverity | null) ?? null;

    const obsRows = await db.query<StoredObservationRow>(
      `SELECT id, observe_datetime, hour_no,
              fetal_heart_rate, amniotic_fluid, amniotic_type_name,
              moulding, cervical_dilation_cm, descent_of_head,
              contraction_per_10min, contraction_duration_sec,
              contraction_strength, oxytocin_uml, oxytocin_drops_min,
              drugs_iv_fluids, pulse, bp_systolic, bp_diastolic,
              temperature, urine_volume_ml, urine_protein, urine_glucose,
              urine_acetone, note, entry_staff
         FROM cached_partograph_observations
        WHERE patient_id = ?
        ORDER BY observe_datetime ASC`,
      [patientId],
    );

    const dtos = obsRows.map(toDto);
    const alerts = analyzePartograph({ an }, dtos);
    const newSeverity = highestSeverity(alerts);
    const newCount = alerts.length;

    await db.execute(
      `UPDATE cached_patients
          SET partograph_severity = ?, partograph_alert_count = ?,
              updated_at = ?
        WHERE id = ?`,
      [newSeverity, newCount, now, patientId],
    );

    if (prevSeverity !== newSeverity) {
      severityChanges.push({
        patientId,
        an,
        from: prevSeverity,
        to: newSeverity,
        alertCount: newCount,
      });
    }
  }

  return { upserted, deleted, severityChanges };
}
