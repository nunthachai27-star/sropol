// POST /api/calls/[id]/leave — a joined participant hangs up. When the last
// joined participant leaves, the call ends and pending rings are revoked.
// Replaces the 1:1-era /cancel and /end routes.
import { leaveCall } from '@/services/video-call';
import { callTransitionRoute } from '@/lib/video-call-http';

export const POST = callTransitionRoute(leaveCall, 'video_call_leave_failed');
