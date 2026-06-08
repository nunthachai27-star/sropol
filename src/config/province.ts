// Default MOPH 2-digit province code the deployment is scoped to when the DB
// has no `active_province_code` set. SR-LRMS serves Surin (32); the original
// kk-lrms served Khon Kaen (40). Override per-deployment with
// NEXT_PUBLIC_DEFAULT_PROVINCE_CODE (build-time, like NEXT_PUBLIC_BASE_PATH).
//
// Admins can still switch the live province at runtime via
// /admin · จังหวัดหลัก (persisted to system_config.active_province_code); this
// constant only supplies the initial/fallback value before that row exists.
export const DEFAULT_PROVINCE_CODE = process.env.NEXT_PUBLIC_DEFAULT_PROVINCE_CODE ?? '32';
