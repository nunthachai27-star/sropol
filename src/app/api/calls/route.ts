// POST /api/calls — start a (group) video call: ring one or more online
// users. Auth: any signed-in session. The service enforces presence, busy,
// self, duplicate and size rules per invitee; media is carried by Jitsi.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { createCall } from '@/services/video-call';
import {
  actorFromSession,
  parseCalleeUserIds,
  videoCallErrorResponse,
} from '@/lib/video-call-http';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const calleeUserIds = await parseCalleeUserIds(request);
  if (calleeUserIds.length === 0) {
    return NextResponse.json(
      {
        error: 'calleeUserIds is required',
        code: 'CALLEES_REQUIRED',
        message: 'กรุณาเลือกผู้รับสายอย่างน้อย 1 คนจากรายชื่อผู้ใช้ที่ออนไลน์',
      },
      { status: 400 },
    );
  }

  try {
    const db = await getDatabase();
    const call = await createCall(db, actorFromSession(session), calleeUserIds);
    return NextResponse.json(call, { status: 201 });
  } catch (error) {
    return videoCallErrorResponse(error, 'video_call_create_failed');
  }
}
