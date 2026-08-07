// T015: Hospital level definitions and KK province hospital data
//
// SAP framework reclassification (อ.ก.พ. มติ 3/2568, 20 พ.ค. 2568) is
// applied here for the 26 Khon Kaen province hospitals + 2 system codes.
// Source: MoPH สธ ๐๒๐๗.๑๑/ว ๒๐๖๘๙ forwarded by PHO Khon Kaen as
// ขก ๐๐๓๓.๐๐๒/ว.๖๕๐๐ on 13 ส.ค. 2568.

import { HospitalLevel } from '@/types/domain';

export interface HospitalLevelConfig {
  level: HospitalLevel;
  nameTh: string;
  nameEn: string;
  description: string;
  sortOrder: number;
}

export const HOSPITAL_LEVELS: Record<HospitalLevel, HospitalLevelConfig> = {
  // ─── SAP framework (อ.ก.พ. 3/2568) ─────────────────────────────────
  [HospitalLevel.P_PLUS]: {
    level: HospitalLevel.P_PLUS,
    nameTh: 'ระดับ P+ (ศูนย์เชี่ยวชาญสูง)',
    nameEn: 'P+ — Provincial Centre of Excellence',
    description: 'โรงพยาบาลศูนย์ระดับจังหวัด ศูนย์เชี่ยวชาญสูง (SAP)',
    sortOrder: 1,
  },
  [HospitalLevel.P]: {
    level: HospitalLevel.P,
    nameTh: 'ระดับ P',
    nameEn: 'P — Provincial',
    description: 'โรงพยาบาลศูนย์ระดับจังหวัด (SAP)',
    sortOrder: 2,
  },
  [HospitalLevel.A_PLUS]: {
    level: HospitalLevel.A_PLUS,
    nameTh: 'ระดับ A+',
    nameEn: 'A+',
    description: 'หน่วยบริการระดับ A+ (SAP)',
    sortOrder: 3,
  },
  [HospitalLevel.A]: {
    level: HospitalLevel.A,
    nameTh: 'ระดับ A',
    nameEn: 'A',
    description: 'หน่วยบริการระดับ A (SAP)',
    sortOrder: 4,
  },
  [HospitalLevel.S_PLUS]: {
    level: HospitalLevel.S_PLUS,
    nameTh: 'ระดับ S+',
    nameEn: 'S+',
    description: 'หน่วยบริการระดับ S+ (SAP)',
    sortOrder: 5,
  },
  [HospitalLevel.S]: {
    level: HospitalLevel.S,
    nameTh: 'ระดับ S',
    nameEn: 'S',
    description: 'หน่วยบริการระดับ S (SAP)',
    sortOrder: 6,
  },
  [HospitalLevel.S_C]: {
    level: HospitalLevel.S_C,
    nameTh: 'ระดับ S (เงื่อนไข)',
    nameEn: 'S — conditional',
    description: 'หน่วยบริการระดับ S พร้อมเงื่อนไขการพัฒนา (SAP) — ดูคอลัมน์ development_condition',
    sortOrder: 7,
  },
  [HospitalLevel.M]: {
    level: HospitalLevel.M,
    nameTh: 'ระดับ M',
    nameEn: 'M',
    description: 'หน่วยบริการระดับ M (SAP)',
    sortOrder: 8,
  },
  [HospitalLevel.F]: {
    level: HospitalLevel.F,
    nameTh: 'ระดับ F',
    nameEn: 'F',
    description: 'หน่วยบริการระดับ F (SAP)',
    sortOrder: 9,
  },
  // ─── Legacy MoPH levels (kept for back-compat) ─────────────────────
  [HospitalLevel.A_S]: {
    level: HospitalLevel.A_S,
    nameTh: 'รพช. ขนาดใหญ่',
    nameEn: 'Large Community Hospital',
    description: 'โรงพยาบาลชุมชนขนาดใหญ่ (A/S) — legacy',
    sortOrder: 50,
  },
  [HospitalLevel.M1]: {
    level: HospitalLevel.M1,
    nameTh: 'รพช. ขนาดกลาง M1',
    nameEn: 'Medium Community Hospital M1',
    description: 'โรงพยาบาลชุมชนขนาดกลาง ระดับ M1 — legacy',
    sortOrder: 51,
  },
  [HospitalLevel.M2]: {
    level: HospitalLevel.M2,
    nameTh: 'รพช. ขนาดกลาง M2',
    nameEn: 'Medium Community Hospital M2',
    description: 'โรงพยาบาลชุมชนขนาดกลาง-เล็ก ระดับ M2 — legacy',
    sortOrder: 52,
  },
  [HospitalLevel.F1]: {
    level: HospitalLevel.F1,
    nameTh: 'รพช. ขนาดเล็ก F1',
    nameEn: 'Small Community Hospital F1',
    description: 'โรงพยาบาลชุมชนขนาดเล็ก ระดับ F1 — legacy',
    sortOrder: 53,
  },
  [HospitalLevel.F2]: {
    level: HospitalLevel.F2,
    nameTh: 'รพช. ขนาดเล็ก F2',
    nameEn: 'Small Community Hospital F2',
    description: 'โรงพยาบาลชุมชนขนาดเล็ก ระดับ F2 — legacy',
    sortOrder: 54,
  },
  [HospitalLevel.F3]: {
    level: HospitalLevel.F3,
    nameTh: 'รพ.สต./F3',
    nameEn: 'Health Promoting Hospital / F3',
    description: 'โรงพยาบาลส่งเสริมสุขภาพตำบล / ระดับ F3 — legacy',
    sortOrder: 55,
  },
};

export interface KkHospitalSeed {
  hcode: string;
  name: string;
  level: HospitalLevel;
  /** Free-text Thai notes for SAP S(เงื่อนไข) hospitals — the
   *  development requirements (โครงสร้างพื้นฐาน / ประสิทธิภาพบริการ /
   *  บุคลากร) listed in the อ.ก.พ. minute. Null for non-conditional
   *  classifications. */
  developmentCondition?: string | null;
}

// Source of truth: SAP framework (อ.ก.พ. 3/2568, 20 พ.ค. 2568) — every
// active KK hospital is mapped to its new SAP tier here. Earlier
// hospital_type_id-based classification (5/6/7) is no longer authoritative
// for KK; admins managing other provinces should keep using the legacy
// levels until their province's SAP table is published.
export const KK_HOSPITALS: KkHospitalSeed[] = [
  { hcode: '10670', name: 'รพ.ขอนแก่น', level: HospitalLevel.P_PLUS },
  { hcode: '10995', name: 'รพ.บ้านฝาง', level: HospitalLevel.S },
  { hcode: '10996', name: 'รพ.พระยืน', level: HospitalLevel.S },
  { hcode: '10997', name: 'รพ.หนองเรือ', level: HospitalLevel.S_PLUS },
  { hcode: '10998', name: 'รพ.ชุมแพ', level: HospitalLevel.A_PLUS },
  { hcode: '10999', name: 'รพ.สีชมพู', level: HospitalLevel.S },
  { hcode: '11000', name: 'รพ.น้ำพอง', level: HospitalLevel.S_PLUS },
  { hcode: '11001', name: 'รพ.อุบลรัตน์', level: HospitalLevel.S },
  { hcode: '11002', name: 'รพ.บ้านไผ่', level: HospitalLevel.A },
  { hcode: '11003', name: 'รพ.เปือยน้อย', level: HospitalLevel.S },
  { hcode: '11004', name: 'รพ.พล', level: HospitalLevel.A },
  { hcode: '11005', name: 'รพ.แวงใหญ่', level: HospitalLevel.S },
  { hcode: '11006', name: 'รพ.แวงน้อย', level: HospitalLevel.S },
  { hcode: '11007', name: 'รพ.หนองสองห้อง', level: HospitalLevel.S },
  { hcode: '11008', name: 'รพ.ภูเวียง', level: HospitalLevel.S },
  { hcode: '11009', name: 'รพ.มัญจาคีรี', level: HospitalLevel.S_PLUS },
  { hcode: '11010', name: 'รพ.ชนบท', level: HospitalLevel.S },
  { hcode: '11011', name: 'รพ.เขาสวนกวาง', level: HospitalLevel.S },
  { hcode: '11012', name: 'รพ.ภูผาม่าน', level: HospitalLevel.S },
  { hcode: '11445', name: 'รพ.สมเด็จพระยุพราชกระนวน', level: HospitalLevel.A },
  { hcode: '12275', name: 'รพ.สิรินธร จังหวัดขอนแก่น', level: HospitalLevel.A },
  { hcode: '14132', name: 'รพ.ซำสูง', level: HospitalLevel.S },
  {
    hcode: '77649',
    name: 'รพ.หนองนาคำ',
    level: HospitalLevel.S_C,
    developmentCondition: 'โครงสร้างพื้นฐาน · ประสิทธิภาพบริการ',
  },
  {
    hcode: '77650',
    name: 'รพ.เวียงเก่า',
    level: HospitalLevel.S_C,
    developmentCondition: 'โครงสร้างพื้นฐาน · บุคลากร · ประสิทธิภาพบริการ',
  },
  {
    hcode: '77651',
    name: 'รพ.โคกโพธิ์ไชย',
    level: HospitalLevel.S_C,
    developmentCondition: 'ประสิทธิภาพบริการ',
  },
  { hcode: '77652', name: 'รพ.โนนศิลา', level: HospitalLevel.S },
];

export function getHospitalLevelConfig(level: HospitalLevel): HospitalLevelConfig {
  return HOSPITAL_LEVELS[level];
}

// MOPH hospital_type_id → sensible default HospitalLevel guess (admin can
// override per hospital afterwards). Single source of truth shared by the
// admin HospitalsTab (single add) and BulkAddHospitalsDialog (bulk add) so the
// mapping can never drift between the two entry points.
export function guessHospitalLevel(typeId: number | null): HospitalLevel {
  if (typeId === 5) return HospitalLevel.A_S;
  if (typeId === 6) return HospitalLevel.M1;
  if (typeId === 7) return HospitalLevel.F2;
  return HospitalLevel.F3;
}
