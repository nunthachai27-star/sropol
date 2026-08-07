// Bilingual API error responses with actionable Thai context.
// CLAUDE.md: error messages MUST be actionable — what went wrong AND what to do (in Thai).

export interface ApiError {
  error: string; // English summary for logs/devs
  code: string; // Stable machine-readable code
  message: string; // Thai message for end users
  suggestedAction: string; // What the user should do (Thai)
}

// Pre-defined error codes used across webhook and public API routes.
// Add new entries here rather than inlining ad-hoc Thai strings.
export const ApiErrors = {
  MISSING_AUTH: {
    error: 'Missing or invalid Authorization header',
    code: 'MISSING_AUTH',
    message: 'ไม่พบ Authorization header หรือรูปแบบไม่ถูกต้อง',
    suggestedAction: 'กรุณาส่งคำขอด้วย header: Authorization: Bearer <api-key>',
  },
  INVALID_API_KEY: {
    error: 'Invalid or revoked API key',
    code: 'INVALID_API_KEY',
    message: 'API key ไม่ถูกต้องหรือถูกยกเลิกแล้ว',
    suggestedAction: 'กรุณาตรวจสอบ API key หรือสร้างใหม่จากหน้าการจัดการ',
  },
  INVALID_JSON: {
    error: 'Request body must be a JSON object',
    code: 'INVALID_JSON',
    message: 'รูปแบบข้อมูลไม่ถูกต้อง — ต้องเป็น JSON object',
    suggestedAction: 'ตรวจสอบ Content-Type: application/json และ payload เป็น JSON ที่ valid',
  },
  HOSPITAL_CODE_MISMATCH: {
    error: 'hospitalCode does not match API key',
    code: 'HOSPITAL_CODE_MISMATCH',
    message: 'รหัสโรงพยาบาลไม่ตรงกับ API key',
    suggestedAction:
      'ใช้ hospitalCode ที่ตรงกับโรงพยาบาลของ API key หรือใช้ key ของโรงพยาบาลที่ถูกต้อง',
  },
  CID_REQUIRED: {
    error: '"cid" is required (string, 13 digits)',
    code: 'CID_REQUIRED',
    message: 'ต้องระบุเลขบัตรประชาชน 13 หลัก (cid)',
    suggestedAction: 'ส่ง field "cid" เป็น string ความยาว 13 ตัวอักษร เป็นตัวเลขทั้งหมด',
  },
  PATIENTS_REQUIRED: {
    error: '"patients" array is required and must not be empty',
    code: 'PATIENTS_REQUIRED',
    message: 'ต้องมี field "patients" เป็น array ที่ไม่ว่าง',
    suggestedAction:
      'ส่ง patients เป็น array ที่มีอย่างน้อย 1 รายการ และไม่เกิน 100 รายการต่อ request',
  },
  PATIENTS_TOO_MANY: {
    error: '"patients" array must not exceed 100 items per request',
    code: 'PATIENTS_TOO_MANY',
    message: 'จำนวนผู้ป่วยใน 1 request เกิน 100 ราย',
    suggestedAction: 'แบ่งส่งเป็นหลาย request โดย batch ละไม่เกิน 100 ราย',
  },
  VALIDATION_FAILED: {
    error: 'Payload validation failed',
    code: 'VALIDATION_FAILED',
    message: 'ข้อมูลที่ส่งมาไม่ผ่านการตรวจสอบ',
    suggestedAction: 'ตรวจสอบรายละเอียดใน details และแก้ไข payload ตามคำแนะนำ',
  },
  REFERRAL_FIELD_REQUIRED: {
    error: 'Required referral field missing',
    code: 'REFERRAL_FIELD_REQUIRED',
    message: 'ข้อมูลใบส่งต่อไม่ครบถ้วน',
    suggestedAction: 'ตรวจสอบ referralId, hn, cid, name, toHospitalCode, reason ให้ครบถ้วน',
  },
  REFERRAL_NOT_FOUND: {
    error: 'Referral not found',
    code: 'REFERRAL_NOT_FOUND',
    message: 'ไม่พบใบส่งต่อที่ระบุ หรือโรงพยาบาลของคุณไม่มีสิทธิ์ดำเนินการกับใบส่งต่อนี้',
    suggestedAction: 'ตรวจสอบ referralId และ fromHospitalCode แล้วลองใหม่อีกครั้ง',
  },
  INVALID_REFERRAL_STATUS: {
    error: 'Invalid referral status',
    code: 'INVALID_REFERRAL_STATUS',
    message: 'สถานะใบส่งต่อไม่ถูกต้อง ต้องเป็น ACCEPTED, IN_TRANSIT, ARRIVED หรือ REJECTED',
    suggestedAction: 'แก้ไขค่า status ให้ตรงตามที่กำหนดแล้วส่งใหม่',
  },
  INVALID_REFERRAL_ACTION: {
    error: 'Invalid referral action',
    code: 'INVALID_REFERRAL_ACTION',
    message: 'action ไม่ถูกต้อง ต้องเป็น update หรือ delete',
    suggestedAction: 'แก้ไขค่า action ให้ตรงตามที่กำหนดแล้วส่งใหม่',
  },
  INTERNAL_ERROR: {
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    message: 'เกิดข้อผิดพลาดภายในระบบ',
    suggestedAction: 'กรุณาลองใหม่อีกครั้ง หากปัญหายังคงอยู่ติดต่อผู้ดูแลระบบ',
  },
  CSRF_ORIGIN_REJECTED: {
    error: 'Cross-site request rejected',
    code: 'CSRF_ORIGIN_REJECTED',
    message: 'คำขอถูกปฏิเสธ: ต้นทางของคำขอ (Origin) ไม่ได้รับอนุญาต',
    suggestedAction: 'โปรดใช้งานผ่านหน้าเว็บ KK-LRMS โดยตรง',
  },
  RATE_LIMITED: {
    error: 'Too many requests',
    code: 'RATE_LIMITED',
    message: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    suggestedAction: 'ลดความถี่ของการเรียก API แล้วลองใหม่ภายหลัง',
  },
} as const;

export type ApiErrorKey = keyof typeof ApiErrors;

/**
 * Build an API error response, optionally appending custom details.
 * Use `details` to surface validation specifics (field names, mismatched values).
 */
export function apiError(
  key: ApiErrorKey,
  details?: string | Record<string, unknown>,
): ApiError & { details?: string | Record<string, unknown> } {
  const base = ApiErrors[key];
  return details !== undefined ? { ...base, details } : { ...base };
}
