// POST /api/calls/[id]/decline — a ringing invitee rejects the invite.
import { declineInvite } from '@/services/video-call';
import { callTransitionRoute } from '@/lib/video-call-http';

export const POST = callTransitionRoute(declineInvite, 'video_call_decline_failed');
