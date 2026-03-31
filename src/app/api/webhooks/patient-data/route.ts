// POST /api/webhooks/patient-data — inbound webhook for non-HOSxP hospitals
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import {
  validateApiKey,
  validatePayload,
  processWebhookPayload,
  processAncWebhook,
  processReferralWebhook,
} from '@/services/webhook';
import type { WebhookAncPayload, WebhookReferralPayload } from '@/services/webhook';
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

    if (payloadType === 'referral_update') {
      const referralPayload = body as WebhookReferralPayload;
      if (!referralPayload.referralId || typeof referralPayload.referralId !== 'string') {
        return NextResponse.json(
          { error: '"referralId" is required (string)' },
          { status: 400 },
        );
      }
      if (!referralPayload.status || typeof referralPayload.status !== 'string') {
        return NextResponse.json(
          { error: '"status" is required (string)' },
          { status: 400 },
        );
      }
      const result = await processReferralWebhook(
        db,
        keyInfo.hospitalId,
        referralPayload,
        sseManager,
      );
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
