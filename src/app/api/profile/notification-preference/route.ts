// Session-gated per-user MOPH LINE opt-in (spec 2026-08-05-notification-optin).
// Identity comes from the session (userCid + hospitalCode) — the body can only
// set the boolean, never the CID, so no cross-account tampering.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { isValidCid13 } from '@/lib/cid';
import {
  getNotificationPreference,
  upsertNotificationPreference,
} from '@/services/notification-preference';

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userCid = String(session.user.userCid ?? '');
  const hospitalCode = String(session.user.hospitalCode ?? '');
  await ensureInit();
  const db = await getDatabase();
  const pref = await getNotificationPreference(db, userCid, hospitalCode);
  return NextResponse.json({
    userCid,
    hospitalCode,
    mophLineEnabled: pref?.mophLineEnabled ?? false,
  });
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userCid = String(session.user.userCid ?? '');
  const hospitalCode = String(session.user.hospitalCode ?? '');
  // P1-B (codex): BMS auth can map a missing user_cid to ''. A preference row
  // keyed '' is silently dropped by isValidCid at enqueue time, so the user
  // would falsely believe they opted in. Reject before any write.
  if (!isValidCid13(userCid)) {
    return NextResponse.json({ error: 'CID ของผู้ใช้ไม่ครบ 13 หลัก' }, { status: 400 });
  }
  let body: { mophLineEnabled?: unknown };
  try {
    body = (await request.json()) as { mophLineEnabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (typeof body.mophLineEnabled !== 'boolean') {
    return NextResponse.json({ error: 'mophLineEnabled boolean required' }, { status: 400 });
  }
  await ensureInit();
  const db = await getDatabase();
  const saved = await upsertNotificationPreference(db, userCid, hospitalCode, body.mophLineEnabled);
  return NextResponse.json({
    userCid: saved.userCid,
    hospitalCode: saved.hospitalCode,
    mophLineEnabled: saved.mophLineEnabled,
  });
}
