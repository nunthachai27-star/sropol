// POST /api/calls/[id]/accept — a ringing invitee joins; returns { roomId }
// so the accepting tab can enter the Jitsi room.
import { acceptInvite } from '@/services/video-call';
import { callTransitionRoute } from '@/lib/video-call-http';

export const POST = callTransitionRoute(acceptInvite, 'video_call_accept_failed');
