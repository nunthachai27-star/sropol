// /calls/[id] — the video-call room. Server shell only; the client component
// resolves the call through the participant-guarded API.
import { CallRoomClient } from '@/components/calls/CallRoomClient';

export default async function CallRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CallRoomClient callId={id} />;
}
