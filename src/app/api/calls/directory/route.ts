// GET /api/calls/directory — online users grouped by hospital: who can be
// video-called right now. Requester is excluded. Auth: any signed-in session
// (same exposure rationale as /api/online-users).
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCallDirectory } from '@/services/video-call';
import { logger } from '@/lib/logger';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const hospitals = await getCallDirectory(session.user.id);
    return NextResponse.json({ hospitals, updatedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('video_call_directory_failed', { error });
    return NextResponse.json(
      {
        error: 'failed to load directory',
        code: 'INTERNAL',
        message: 'ไม่สามารถโหลดรายชื่อผู้ใช้ออนไลน์ได้ กรุณาลองใหม่อีกครั้ง',
      },
      { status: 500 },
    );
  }
}
