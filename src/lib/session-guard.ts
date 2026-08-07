// Handler-level session guards, mirroring the requireAdmin() shape:
// return the Session on success or a ready-to-return NextResponse.
// Node-side (imports @/lib/auth) — NEVER import from src/middleware.ts.
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';

const UNAUTHENTICATED_BODY = {
  error: 'Unauthorized',
  code: 'UNAUTHENTICATED',
  message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
  suggestedAction: 'เข้าสู่ระบบผ่านหน้า /login แล้วลองใหม่อีกครั้ง',
};

const READONLY_BODY = {
  error: 'Forbidden',
  code: 'READONLY_SESSION',
  message: 'บัญชีของคุณเป็นแบบอ่านอย่างเดียว ไม่สามารถแก้ไขข้อมูลได้',
  suggestedAction: 'เข้าสู่ระบบด้วย BMS Session เพื่อรับสิทธิ์แก้ไขข้อมูล',
};

export async function requireSession(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(UNAUTHENTICATED_BODY, { status: 401 });
  }
  return session;
}

export async function requireReadWriteSession(): Promise<Session | NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  if (session.user.accessMode === 'readonly') {
    return NextResponse.json(READONLY_BODY, { status: 403 });
  }
  return session;
}
