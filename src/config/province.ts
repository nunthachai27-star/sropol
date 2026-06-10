// Default MOPH 2-digit province code the deployment is scoped to when the DB
// has no `active_province_code` set. SR-LRMS serves Surin (32); the original
// kk-lrms served Khon Kaen (40). Override per-deployment with
// NEXT_PUBLIC_DEFAULT_PROVINCE_CODE (build-time, like NEXT_PUBLIC_BASE_PATH).
//
// Admins can still switch the live province at runtime via
// /admin · จังหวัดหลัก (persisted to system_config.active_province_code); this
// constant only supplies the initial/fallback value before that row exists.
export const DEFAULT_PROVINCE_CODE = process.env.NEXT_PUBLIC_DEFAULT_PROVINCE_CODE ?? '32';

// MOPH province code -> Thai name. Imports ONLY provinces.json (~5 KB), not the
// thai-geo index (which pulls in the ~1.8 MB districts/tambons/hospitals JSON),
// so this is safe to use in client components.
import provincesJson from '@/data/thai-geo/provinces.json';

const PROVINCE_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  (provincesJson as Array<{ province_code: string; province_name: string }>).map((p) => [
    p.province_code,
    p.province_name,
  ]),
);

/** Thai province name for a MOPH 2-digit code, or '' when unknown. */
export function provinceName(code: string | null | undefined): string {
  return (code && PROVINCE_NAME_BY_CODE[code]) || '';
}

/** Thai name of the deployment's default province (e.g. "สุรินทร์"). */
export const DEFAULT_PROVINCE_NAME = provinceName(DEFAULT_PROVINCE_CODE);
