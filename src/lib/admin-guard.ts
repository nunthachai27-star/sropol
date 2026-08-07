// W6: handler-level admin guard — defense in depth for /api/admin/* routes.
//
// Every admin route relied SOLELY on the Edge middleware for authorization. If
// a route ever slips out of the middleware matcher, or the matcher regresses,
// the handler would run unauthenticated. requireAdmin() re-checks auth at the
// handler, sharing the exact same rule (isAdminAuthorized) the middleware uses
// so the two layers can never disagree.
//
// This file imports the full Node-side `@/lib/auth` (Credentials + DB), so it
// MUST NOT be imported by the Edge middleware — the middleware imports the pure
// `@/lib/admin-access` predicate instead.
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import { isAdminAuthorized } from '@/lib/admin-access';
import { logger } from '@/lib/logger';

// Actionable Thai error bodies (Constitution V): say what went wrong AND what
// to do. Shape matches the ad-hoc `{ error }` bodies the admin UI already reads.
const UNAUTHENTICATED_BODY = {
  error: 'Unauthorized',
  code: 'UNAUTHENTICATED',
  message: 'ต้องเข้าสู่ระบบก่อนใช้งานส่วนผู้ดูแลระบบ',
  suggestedAction: 'กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง',
} as const;

const FORBIDDEN_BODY = {
  error: 'Admin role required',
  code: 'FORBIDDEN',
  message: 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ (ADMIN)',
  suggestedAction:
    'ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ หรือเข้าสู่ระบบด้วยบัญชีที่อยู่ในรายชื่อที่อนุญาต',
} as const;

/**
 * Guard for admin route handlers. Returns the authenticated ADMIN `Session` on
 * success, or a ready-to-return `NextResponse` (401 when unauthenticated, 403
 * when authenticated but not an authorized admin) on failure. Usage:
 *
 * ```ts
 * const guard = await requireAdmin();
 * if (guard instanceof NextResponse) return guard;
 * // guard is a Session narrowed to an authorized ADMIN
 * ```
 */
export async function requireAdmin(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }
  if (
    !isAdminAuthorized({
      role: session.user.role,
      userCid: session.user.userCid,
      accessMode: session.user.accessMode,
    })
  ) {
    logger.warn('admin_access_denied', {
      role: session.user.role,
      accessMode: session.user.accessMode,
      userIdLast4: session.user.userCid?.slice(-4) ?? '',
      hospitalCode: session.user.hospitalCode,
    });
    return NextResponse.json(FORBIDDEN_BODY, { status: 403 });
  }
  return session;
}
