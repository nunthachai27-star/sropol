// Patient sync — HOSxP rows ↔ cached_patients, change/transfer detection
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import type { DatabaseAdapter } from '@/db/adapter';
import type { HosxpIptRow, HosxpPregnancyRow, HosxpPatientRow } from '@/types/hosxp';
import { encrypt } from '@/lib/encryption';
import { calculateAge } from '@/lib/utils';
import { CooperativeYielder } from '@/lib/event-loop';

export interface SyncPatientData {
  hn: string;
  an: string;
  name: string;
  cid: string | null;
  cidHash: string | null;
  age: number;
  gravida: number | null;
  para?: number | null;
  abortion?: number | null;
  livingChildren?: number | null;
  pregNo?: number | null;
  gaWeeks: number | null;
  gaDay?: number | null;
  ancCount: number | null;
  admitDate: string;
  heightCm?: number | null;
  weightKg?: number | null;
  weightDiffKg?: number | null;
  prePregnancyWeightKg?: number | null;
  fundalHeightCm?: number | null;
  usWeightG?: number | null;
  hematocritPct?: number | null;
  bpSystolicAdmit?: number | null;
  bpDiastolicAdmit?: number | null;
  pulseAdmit?: number | null;
  rrAdmit?: number | null;
  temperatureAdmit?: number | null;
  cervicalOpenCmAdmit?: number | null;
  effacementPctAdmit?: number | null;
  stationAdmit?: string | null;
  laborStatus: string;
  syncedAt: string;
}

export function transformHosxpPatient(
  ipt: HosxpIptRow,
  pregnancy: HosxpPregnancyRow,
  patient: HosxpPatientRow,
  encryptionKey: string,
): SyncPatientData {
  const fullName = `${patient.pname} ${patient.fname} ${patient.lname}`.trim();
  const encryptedName = encrypt(fullName, encryptionKey);
  const encryptedCid = patient.cid ? encrypt(patient.cid, encryptionKey) : null;
  const cidHash = patient.cid
    ? createHash('sha256').update(patient.cid).digest('hex')
    : null;
  const age = calculateAge(patient.birthday);
  const admitDate = `${ipt.regdate}T${ipt.regtime || '00:00:00'}`;
  const laborStatus = ipt.dchdate ? 'DELIVERED' : 'ACTIVE';

  return {
    hn: ipt.hn,
    an: ipt.an,
    name: encryptedName,
    cid: encryptedCid,
    cidHash,
    age,
    gravida: pregnancy.preg_number,
    gaWeeks: pregnancy.ga,
    ancCount: null, // Filled from ANC data separately
    admitDate,
    laborStatus,
    syncedAt: new Date().toISOString(),
  };
}

export async function upsertCachedPatients(
  db: DatabaseAdapter,
  hospitalId: string,
  patients: SyncPatientData[],
): Promise<number> {
  let count = 0;
  const now = new Date().toISOString();
  // Bounded cooperative yielding (page-stall fix part 2): reached from the
  // browser-push cycle on the ONE serving event loop; every caller passes the
  // top-level adapter (never a transaction handle), so ticking per patient is
  // safe under the never-yield-inside-a-tx rule.
  const yielder = new CooperativeYielder();

  for (const p of patients) {
    await yielder.tick();
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM cached_patients WHERE hospital_id = ? AND an = ?',
      [hospitalId, p.an],
    );

    // Compute weight_diff_kg server-side when sender supplied both anchors but
    // not the diff itself. Sender-supplied diff still wins (it may include
    // trimester-specific corrections we don't replicate here).
    const weightDiffKg =
      p.weightDiffKg ??
      (p.weightKg != null && p.prePregnancyWeightKg != null
        ? Number((p.weightKg - p.prePregnancyWeightKg).toFixed(2))
        : null);

    if (existing.length > 0) {
      await db.execute(
        `UPDATE cached_patients SET
          hn = ?, name = ?, cid = ?, cid_hash = ?, age = ?,
          gravida = ?, para = ?, abortion = ?, living_children = ?, preg_no = ?,
          ga_weeks = ?, ga_day = ?,
          anc_count = ?, admit_date = ?, height_cm = ?, weight_kg = ?,
          weight_diff_kg = ?, pre_pregnancy_weight_kg = ?,
          fundal_height_cm = ?, us_weight_g = ?, hematocrit_pct = ?,
          bp_systolic_admit = ?, bp_diastolic_admit = ?, pulse_admit = ?,
          rr_admit = ?, temperature_admit = ?,
          cervical_open_cm_admit = ?, effacement_pct_admit = ?, station_admit = ?,
          labor_status = ?, synced_at = ?, updated_at = ?
        WHERE id = ?`,
        [
          p.hn, p.name, p.cid, p.cidHash ?? null, p.age,
          p.gravida, p.para ?? null, p.abortion ?? null, p.livingChildren ?? null, p.pregNo ?? null,
          p.gaWeeks, p.gaDay ?? null,
          p.ancCount, p.admitDate, p.heightCm ?? null, p.weightKg ?? null,
          weightDiffKg, p.prePregnancyWeightKg ?? null,
          p.fundalHeightCm ?? null, p.usWeightG ?? null, p.hematocritPct ?? null,
          p.bpSystolicAdmit ?? null, p.bpDiastolicAdmit ?? null, p.pulseAdmit ?? null,
          p.rrAdmit ?? null, p.temperatureAdmit ?? null,
          p.cervicalOpenCmAdmit ?? null, p.effacementPctAdmit ?? null, p.stationAdmit ?? null,
          p.laborStatus, p.syncedAt, now,
          existing[0].id,
        ],
      );
    } else {
      await db.execute(
        `INSERT INTO cached_patients (
          id, hospital_id, hn, an, name, cid, cid_hash, age,
          gravida, para, abortion, living_children, preg_no,
          ga_weeks, ga_day,
          anc_count, admit_date, height_cm, weight_kg,
          weight_diff_kg, pre_pregnancy_weight_kg,
          fundal_height_cm, us_weight_g, hematocrit_pct,
          bp_systolic_admit, bp_diastolic_admit, pulse_admit,
          rr_admit, temperature_admit,
          cervical_open_cm_admit, effacement_pct_admit, station_admit,
          labor_status, synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), hospitalId, p.hn, p.an, p.name, p.cid, p.cidHash ?? null, p.age,
          p.gravida, p.para ?? null, p.abortion ?? null, p.livingChildren ?? null, p.pregNo ?? null,
          p.gaWeeks, p.gaDay ?? null,
          p.ancCount, p.admitDate,
          p.heightCm ?? null, p.weightKg ?? null,
          weightDiffKg, p.prePregnancyWeightKg ?? null,
          p.fundalHeightCm ?? null, p.usWeightG ?? null, p.hematocritPct ?? null,
          p.bpSystolicAdmit ?? null, p.bpDiastolicAdmit ?? null, p.pulseAdmit ?? null,
          p.rrAdmit ?? null, p.temperatureAdmit ?? null,
          p.cervicalOpenCmAdmit ?? null, p.effacementPctAdmit ?? null, p.stationAdmit ?? null,
          p.laborStatus, p.syncedAt, now, now,
        ],
      );
    }
    count++;
  }

  return count;
}

export interface ChangeDetectionResult {
  newAdmissions: string[];
  discharges: string[];
}

export function detectChanges(
  newData: Pick<SyncPatientData, 'an' | 'laborStatus'>[],
  existingAns: string[],
): ChangeDetectionResult {
  const newAns = newData.map((d) => d.an);
  const newAdmissions = newAns.filter((an) => !existingAns.includes(an));
  const discharges = existingAns.filter((an) => !newAns.includes(an));

  return { newAdmissions, discharges };
}

// Mark patients as DELIVERED — used by both HOSxP polling (discharge detection) and webhook full_snapshot mode
export async function markPatientsDelivered(
  db: DatabaseAdapter,
  hospitalId: string,
  ans: string[],
): Promise<void> {
  if (ans.length === 0) return;
  const now = new Date().toISOString();
  for (const an of ans) {
    await db.execute(
      `UPDATE cached_patients SET labor_status = 'DELIVERED', delivered_at = ?, updated_at = ?
       WHERE hospital_id = ? AND an = ? AND labor_status = 'ACTIVE'`,
      [now, now, hospitalId, an],
    );
  }
}

// T104/T107: Transfer detection — cross-hospital CID matching via cid_hash
export interface TransferDetection {
  cidHash: string;
  fromHospitalId: string;
  fromAn: string;
  toHospitalId: string;
  toAn: string;
}

export async function detectTransfers(
  db: DatabaseAdapter,
  hospitalId: string,
  patients: SyncPatientData[],
): Promise<TransferDetection[]> {
  const transfers: TransferDetection[] = [];

  for (const p of patients) {
    if (!p.cidHash) continue;

    const matches = await db.query<{
      hospital_id: string;
      an: string;
    }>(
      `SELECT hospital_id, an FROM cached_patients
       WHERE cid_hash = ? AND hospital_id != ? AND labor_status = 'ACTIVE'`,
      [p.cidHash, hospitalId],
    );

    for (const match of matches) {
      transfers.push({
        cidHash: p.cidHash,
        fromHospitalId: match.hospital_id,
        fromAn: match.an,
        toHospitalId: hospitalId,
        toAn: p.an,
      });
    }
  }

  return transfers;
}
