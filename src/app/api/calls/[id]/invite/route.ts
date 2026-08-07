// POST /api/calls/[id]/invite — a joined participant rings more people into
// the active call (เพิ่มผู้เข้าร่วม). Body: { calleeUserIds: string[] }.
// Returns { invited, skipped } — per-user skip reasons, no all-or-nothing.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { inviteToCall } from '@/services/video-call';
import {
  actorFromSession,
  parseCalleeUserIds,
  videoCallErrorResponse,
} from '@/lib/video-call-http';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
        message: 'กรุณาเลือกผู้ที่จะเชิญอย่างน้อย 1 คน',
      },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const db = await getDatabase();
    const result = await inviteToCall(db, id, actorFromSession(session), calleeUserIds);
    return NextResponse.json(result);
  } catch (error) {
    return videoCallErrorResponse(error, 'video_call_invite_failed');
  }
}
