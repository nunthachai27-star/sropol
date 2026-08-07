// POST /api/chat — single-turn clinical-chatbot answer (Phase 0, non-stream).
//
// Cost-gated: when CLINICAL_CHAT_ENABLED is not "true" the route short-circuits
// 503 with a Thai message and NEVER calls the LLM — so a misconfigured deploy
// cannot silently burn GLM-5.2 compute. See
// docs/superpowers/plans/2026-08-03-clinical-chatbot-glm.md.
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import { clinicalChatEnabled } from '@/config/clinical-chat-config';
import { askClinicalQuestion } from '@/services/chat/chat-service';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!clinicalChatEnabled()) {
    return NextResponse.json({ error: 'ปิดใช้งานผู้ช่วยแชททางคลินิก' }, { status: 503 });
  }
  let body: { message?: unknown; mode?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; mode?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }
  // Mode: default 'clinical' (maternity ward). 'statistics' (dashboard) uses
  // aggregate context. Anything else is rejected — no silent misspelling.
  if (body.mode !== undefined && body.mode !== 'clinical' && body.mode !== 'statistics') {
    return NextResponse.json({ error: 'mode must be "clinical" or "statistics"' }, { status: 400 });
  }
  try {
    await ensureInit();
    const db = await getDatabase();
    const hospitalCode =
      typeof session.user.hospitalCode === 'string' ? session.user.hospitalCode : undefined;
    const userId =
      typeof session.user.id === 'string'
        ? session.user.id
        : typeof session.user.userCid === 'string'
          ? session.user.userCid
          : undefined;
    const { answer } = await askClinicalQuestion(message, {
      db,
      hospitalCode,
      userId,
      mode: body.mode === 'statistics' ? 'statistics' : 'clinical',
    });
    return NextResponse.json({ answer });
  } catch (error) {
    logger.error('clinical_chat_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'ผู้ช่วยแชทไม่พร้อมใช้งาน' }, { status: 502 });
  }
}
