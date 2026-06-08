// T032: HospitalSeeder — seeds the 26 Khon Kaen province hospitals (per MOPH).
// Only runs when the deployment defaults to Khon Kaen (DEFAULT_PROVINCE_CODE
// === '40'); other provinces (e.g. Surin/32) start with an empty hospital list
// and add sites from the MOPH registry via /admin · โรงพยาบาล.
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseAdapter } from '../adapter';
import { DataSeeder } from './seeder';
import { KK_HOSPITALS } from '@/config/hospitals';
import { DEFAULT_PROVINCE_CODE } from '@/config/province';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';

// The bundled KK_HOSPITALS list is specific to Khon Kaen (chwpart 40).
const KK_PROVINCE_CODE = '40';

// Default service-type by level. Updated for SAP framework:
//   P+ / P / A_S → provincial hub (regional centre)
//   A+ / A / M1 / M2 / S+ / S / S_C / M / F1 / F2 / F3 / F → district
//     with maternity by default; admins can flip non-maternity sites
//     to DISTRICT_NO_MATERNITY from /admin · โรงพยาบาล.
function defaultServiceType(level: HospitalLevel): HospitalServiceType {
  if (
    level === HospitalLevel.P_PLUS ||
    level === HospitalLevel.P ||
    level === HospitalLevel.A_S
  ) {
    return HospitalServiceType.PROVINCIAL_HUB;
  }
  return HospitalServiceType.DISTRICT_WITH_MATERNITY;
}

export class HospitalSeeder extends DataSeeder {
  getName(): string {
    return 'HospitalSeeder';
  }

  async shouldRun(db: DatabaseAdapter): Promise<boolean> {
    // Don't seed the Khon Kaen list into a non-KK deployment — those provinces
    // populate hospitals from the MOPH registry instead.
    if (DEFAULT_PROVINCE_CODE !== KK_PROVINCE_CODE) return false;
    const rows = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM hospitals',
    );
    return rows[0].count === 0;
  }

  async seed(db: DatabaseAdapter): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;

    for (const hospital of KK_HOSPITALS) {
      await db.execute(
        `INSERT INTO hospitals (id, hcode, name, level, service_type,
          is_active, connection_status, development_condition,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          hospital.hcode,
          hospital.name,
          hospital.level,
          defaultServiceType(hospital.level),
          true,
          'UNKNOWN',
          hospital.developmentCondition ?? null,
          now,
          now,
        ],
      );
      count++;
    }

    return count;
  }
}
