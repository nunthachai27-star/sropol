// Gates onboarding on the per-hospital HOSxP API version.
//
// After the BMS session has been validated via PasteJSON we hit the user's
// own tunnel at /api/function?name=get_server_api_version. The Pascal handler
// (BMSMormotAPIServerUnit.pas, ~line 2543) returns the constant
// `BMSSessionIDAPIVersion`. Older builds emit the version as a bare string
// body, newer builds wrap it in a JSON envelope — both are accepted.
//
// Comparison packs each portion into 3 zero-padded digits and joins:
//   4.69.5.1 → 004_069_005_001 → 4_069_005_001.

export const MIN_BMS_API_VERSION = '4.69.5.1';

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;

export function encodeApiVersion(version: string): number | null {
  const parts = version.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 999) return null;
    n = n * 1000 + v;
  }
  return n;
}

export const MIN_BMS_API_VERSION_NUMBER = (() => {
  const n = encodeApiVersion(MIN_BMS_API_VERSION);
  if (n === null) {
    throw new Error(`Invalid MIN_BMS_API_VERSION literal: ${MIN_BMS_API_VERSION}`);
  }
  return n;
})();

function pickVersionFromUnknown(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const t = payload.trim().replace(/^"|"$/g, '');
    return VERSION_RE.test(t) ? t : null;
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const candidates = [obj.result, obj.Value, obj.version, obj.api_version];
    for (const c of candidates) {
      if (typeof c === 'string' && VERSION_RE.test(c.trim())) return c.trim();
    }
  }
  return null;
}

export type BmsVersionFailure = 'unreachable' | 'invalid_response' | 'too_old';

export interface BmsVersionCheckResult {
  ok: boolean;
  version: string | null;
  versionNumber: number | null;
  reason?: BmsVersionFailure;
  httpStatus?: number;
}

export async function checkBmsApiVersion(
  apiUrl: string,
  bearerToken: string,
  options?: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<BmsVersionCheckResult> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (options?.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    const url = `${apiUrl.replace(/\/+$/, '')}/api/function?name=get_server_api_version`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        version: null,
        versionNumber: null,
        reason: 'unreachable',
        httpStatus: res.status,
      };
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Older HOSxP builds emit the bare version string (no JSON envelope).
    }
    const version = pickVersionFromUnknown(parsed);
    if (!version) {
      return {
        ok: false,
        version: null,
        versionNumber: null,
        reason: 'invalid_response',
        httpStatus: res.status,
      };
    }
    const n = encodeApiVersion(version);
    if (n === null) {
      return {
        ok: false,
        version,
        versionNumber: null,
        reason: 'invalid_response',
        httpStatus: res.status,
      };
    }
    // Pass when the reported version is equal to OR newer than the minimum.
    if (n >= MIN_BMS_API_VERSION_NUMBER) {
      return { ok: true, version, versionNumber: n, httpStatus: res.status };
    }
    return {
      ok: false,
      version,
      versionNumber: n,
      reason: 'too_old',
      httpStatus: res.status,
    };
  } catch {
    return { ok: false, version: null, versionNumber: null, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export function buildVersionRejectionMessage(result: BmsVersionCheckResult): string {
  const min = MIN_BMS_API_VERSION;
  if (result.reason === 'too_old') {
    return `HOSxP API ของโรงพยาบาลเป็นเวอร์ชัน ${result.version ?? '-'} ซึ่งเก่ากว่าที่ระบบ KK-LRMS ต้องการ (${min} ขึ้นไป) — กรุณาอัปเดต HOSxP เป็นเวอร์ชันใหม่ก่อนเข้าใช้งาน`;
  }
  if (result.reason === 'invalid_response') {
    return `ไม่สามารถอ่านเวอร์ชัน HOSxP API ได้ (รูปแบบไม่ถูกต้อง) — กรุณาอัปเดต HOSxP เป็นเวอร์ชัน ${min} ขึ้นไปก่อนเข้าใช้งาน`;
  }
  return `ไม่สามารถเชื่อมต่อ HOSxP API เพื่อตรวจสอบเวอร์ชันได้ — กรุณาตรวจสอบสถานะ BMS Tunnel และอัปเดต HOSxP เป็นเวอร์ชัน ${min} ขึ้นไป`;
}
