// GET /api/calls/[id] — participant-guarded call detail. The room page uses
// this to resolve the Jitsi room id and peer identity; non-participants get
// 403 so room names (the only Jitsi access control) never leak.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { getCall } from '@/services/video-call';
import { videoCallErrorResponse } from '@/lib/video-call-http';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { id } = await params;
    const db = await getDatabase();
    const call = await getCall(db, id, session.user.id);
    return NextResponse.json(call);
  } catch (error) {
    return videoCallErrorResponse(error, 'video_call_get_failed');
  }
}
