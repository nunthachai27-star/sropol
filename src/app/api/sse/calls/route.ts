// GET /api/sse/calls — per-user signaling stream for video calls. Unlike the
// broadcast dashboard stream, clients here are registered with their session
// user id so the service can ring exactly one person's tabs.
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { ensureInit } from '@/lib/ensure-init';
import { SseManager } from '@/lib/sse';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureInit();

  const clientId = `call-${uuidv4()}`;
  const sseManager = SseManager.getInstance();

  const stream = new ReadableStream({
    start(controller) {
      sseManager.addClient(clientId, controller, userId);
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`),
      );
    },
    cancel() {
      sseManager.removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
