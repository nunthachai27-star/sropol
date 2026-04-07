// POST /api/webhooks/patient-data — inbound webhook for non-HOSxP hospitals
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import {
  validateApiKey,
  validatePayload,
  processWebhookPayload,
  processAncWebhook,
  processReferralCreate,
  processReferralUpdate,
} from '@/services/webhook';
import type {
  WebhookAncPayload,
  WebhookReferralCreatePayload,
  WebhookReferralUpdatePayload,
} from '@/services/webhook';
import { SseManager } from '@/lib/sse';

export async function POST(request: NextRequest) {
  try {
    await ensureInit();
    const db = await getDatabase();

    // Extract API key from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header. Use: Bearer <api-key>' },
        { status: 401 },
      );
    }

    const rawKey = authHeader.slice(7);

    // Validate API key
    const keyInfo = await validateApiKey(db, rawKey);
    if (!keyInfo) {
      return NextResponse.json(
        { error: 'Invalid or revoked API key' },
        { status: 401 },
      );
    }

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 },
      );
    }

    const sseManager = SseManager.getInstance();
    const payloadType = (body as Record<string, unknown>).type;
    const payloadHospCode = (body as Record<string, unknown>).hospitalCode;

    // Validate hospitalCode matches API key's hospital (if provided)
    if (payloadHospCode && typeof payloadHospCode === 'string') {
      const hospRows = await db.query<{ hcode: string }>(
        'SELECT hcode FROM hospitals WHERE id = ?',
        [keyInfo.hospitalId],
      );
      if (hospRows.length > 0 && hospRows[0].hcode !== payloadHospCode) {
        return NextResponse.json(
          { error: `hospitalCode "${payloadHospCode}" ไม่ตรงกับ API key ของโรงพยาบาล "${hospRows[0].hcode}"` },
          { status: 403 },
        );
      }
    }

    // Route to the appropriate handler based on payload type
    if (payloadType === 'anc_data') {
      const ancPayload = body as WebhookAncPayload;
      if (!Array.isArray(ancPayload.patients) || ancPayload.patients.length === 0) {
        return NextResponse.json(
          { error: '"patients" array is required and must not be empty' },
          { status: 400 },
        );
      }
      const result = await processAncWebhook(db, keyInfo.hospitalId, ancPayload, sseManager);
      return NextResponse.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }

    // CREATE referral — sent by sending hospital (รพ.ต้นทาง)
    if (payloadType === 'referral') {
      const referralPayload = body as WebhookReferralCreatePayload;
      if (!referralPayload.referralId || typeof referralPayload.referralId !== 'string') {
        return NextResponse.json(
          { error: '"referralId" is required (string)' },
          { status: 400 },
        );
      }
      if (!referralPayload.hn || typeof referralPayload.hn !== 'string') {
        return NextResponse.json(
          { error: '"hn" is required (string) — patient HN at sending hospital' },
          { status: 400 },
        );
      }
      if (!referralPayload.cid || typeof referralPayload.cid !== 'string') {
        return NextResponse.json(
          { error: '"cid" is required (string) — เลขบัตรประชาชน 13 หลัก' },
          { status: 400 },
        );
      }
      if (!referralPayload.name || typeof referralPayload.name !== 'string') {
        return NextResponse.json(
          { error: '"name" is required (string) — ชื่อ-นามสกุลผู้ป่วย' },
          { status: 400 },
        );
      }
      if (!referralPayload.toHospitalCode || typeof referralPayload.toHospitalCode !== 'string') {
        return NextResponse.json(
          { error: '"toHospitalCode" is required (string) — HCODE รพ.ปลายทาง' },
          { status: 400 },
        );
      }
      if (referralPayload.action !== 'delete' && (!referralPayload.reason || typeof referralPayload.reason !== 'string')) {
        return NextResponse.json(
          { error: '"reason" is required (string) — เหตุผลการส่งต่อ' },
          { status: 400 },
        );
      }
      const result = await processReferralCreate(db, keyInfo.hospitalId, referralPayload, sseManager);
      return NextResponse.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }

    // UPDATE referral status — sent by receiving hospital (รพ.ปลายทาง)
    if (payloadType === 'referral_update') {
      const referralPayload = body as WebhookReferralUpdatePayload;
      if (!referralPayload.referralId || typeof referralPayload.referralId !== 'string') {
        return NextResponse.json(
          { error: '"referralId" is required (string)' },
          { status: 400 },
        );
      }
      if (!referralPayload.fromHospitalCode || typeof referralPayload.fromHospitalCode !== 'string') {
        return NextResponse.json(
          { error: '"fromHospitalCode" is required (string) — HCODE รพ.ต้นทาง' },
          { status: 400 },
        );
      }
      if (referralPayload.action !== 'delete' && (!referralPayload.status || typeof referralPayload.status !== 'string')) {
        return NextResponse.json(
          { error: '"status" is required (string) — ACCEPTED | IN_TRANSIT | ARRIVED | REJECTED' },
          { status: 400 },
        );
      }
      const result = await processReferralUpdate(db, keyInfo.hospitalId, referralPayload, sseManager);
      return NextResponse.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }

    // Default: labor patient payload (unchanged)
    const validation = validatePayload(body);
    if (!validation.valid || !validation.payload) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    const result = await processWebhookPayload(
      db,
      keyInfo.hospitalId,
      validation.payload,
      sseManager,
    );

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
