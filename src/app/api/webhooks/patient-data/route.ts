// POST /api/webhooks/patient-data — inbound webhook for non-HOSxP hospitals
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';
import {
  validateApiKey,
  validatePayload,
  validateAncPayload,
  validateReferralCid,
  validatePartographPayload,
  processWebhookPayload,
  processAncWebhook,
  processReferralCreate,
  processReferralUpdate,
  processPartographWebhook,
  WebhookReferralError,
  REFERRAL_UPDATE_STATUSES,
} from '@/services/webhook';
import type {
  WebhookReferralCreatePayload,
  WebhookReferralUpdatePayload,
} from '@/services/webhook';
import { SseManager } from '@/lib/sse';
import { logger } from '@/lib/logger';
import { apiError } from '@/lib/api-errors';
import { drainMophAlerts } from '@/services/moph-alert-drain';

export async function POST(request: NextRequest) {
  // Captured for the catch-all error log — without sender identity the
  // 2026-07-14 "value too long" incident was undiagnosable from app logs.
  const logCtx: { hospitalId?: string; payloadType?: string } = {};
  try {
    await ensureInit();
    const db = await getDatabase();

    // Extract API key from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(apiError('MISSING_AUTH'), { status: 401 });
    }

    const rawKey = authHeader.slice(7);

    // Validate API key
    const keyInfo = await validateApiKey(db, rawKey);
    if (!keyInfo) {
      return NextResponse.json(apiError('INVALID_API_KEY'), { status: 401 });
    }

    // Parse body
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(apiError('INVALID_JSON'), { status: 400 });
    }

    const sseManager = SseManager.getInstance();
    const payloadType = (body as Record<string, unknown>).type;
    const payloadHospCode = (body as Record<string, unknown>).hospitalCode;
    logCtx.hospitalId = keyInfo.hospitalId;
    logCtx.payloadType = typeof payloadType === 'string' ? payloadType : undefined;

    // Validate hospitalCode matches API key's hospital (if provided)
    if (payloadHospCode && typeof payloadHospCode === 'string') {
      const hospRows = await db.query<{ hcode: string }>(
        'SELECT hcode FROM hospitals WHERE id = ?',
        [keyInfo.hospitalId],
      );
      if (hospRows.length > 0 && hospRows[0].hcode !== payloadHospCode) {
        return NextResponse.json(
          apiError('HOSPITAL_CODE_MISMATCH', {
            expected: hospRows[0].hcode,
            received: payloadHospCode,
          }),
          { status: 403 },
        );
      }
    }

    // Route to the appropriate handler based on payload type
    if (payloadType === 'anc_data') {
      const ancValidation = validateAncPayload(body);
      if (!ancValidation.valid || !ancValidation.payload) {
        return NextResponse.json(
          apiError('VALIDATION_FAILED', ancValidation.error ?? 'unknown validation error'),
          { status: 400 },
        );
      }
      const result = await processAncWebhook(
        db,
        keyInfo.hospitalId,
        ancValidation.payload,
        sseManager,
      );
      return NextResponse.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }

    // CREATE referral — sent by sending hospital (รพ.ต้นทาง)
    if (payloadType === 'referral') {
      const referralPayload = body as WebhookReferralCreatePayload;
      const missing: string[] = [];
      if (!referralPayload.referralId || typeof referralPayload.referralId !== 'string')
        missing.push('referralId');
      if (!referralPayload.hn || typeof referralPayload.hn !== 'string') missing.push('hn');
      if (!referralPayload.cid || typeof referralPayload.cid !== 'string') missing.push('cid');
      if (!referralPayload.name || typeof referralPayload.name !== 'string') missing.push('name');
      if (!referralPayload.toHospitalCode || typeof referralPayload.toHospitalCode !== 'string')
        missing.push('toHospitalCode');
      if (
        referralPayload.action !== 'delete' &&
        (!referralPayload.reason || typeof referralPayload.reason !== 'string')
      )
        missing.push('reason');
      if (missing.length > 0) {
        return NextResponse.json(apiError('REFERRAL_FIELD_REQUIRED', { missing }), { status: 400 });
      }
      // Format check is separate from missing-check so an old client gets a
      // precise "wrong_length" / "non_digits" hint rather than a generic
      // "missing field" error.
      const cidCheck = validateReferralCid(referralPayload.cid);
      if (!cidCheck.ok) {
        return NextResponse.json(apiError('VALIDATION_FAILED', cidCheck.message), { status: 400 });
      }
      const result = await processReferralCreate(
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

    // UPDATE referral status — sent by receiving hospital (รพ.ปลายทาง)
    if (payloadType === 'referral_update') {
      const referralPayload = body as WebhookReferralUpdatePayload;
      const missing: string[] = [];
      if (!referralPayload.referralId || typeof referralPayload.referralId !== 'string')
        missing.push('referralId');
      if (!referralPayload.fromHospitalCode || typeof referralPayload.fromHospitalCode !== 'string')
        missing.push('fromHospitalCode');
      if (
        referralPayload.action !== 'delete' &&
        (!referralPayload.status || typeof referralPayload.status !== 'string')
      )
        missing.push('status (ACCEPTED|IN_TRANSIT|ARRIVED|REJECTED)');
      if (missing.length > 0) {
        return NextResponse.json(apiError('REFERRAL_FIELD_REQUIRED', { missing }), { status: 400 });
      }
      if (
        referralPayload.action !== undefined &&
        referralPayload.action !== 'update' &&
        referralPayload.action !== 'delete'
      ) {
        return NextResponse.json(
          apiError('INVALID_REFERRAL_ACTION', { received: referralPayload.action }),
          { status: 400 },
        );
      }
      if (
        referralPayload.action !== 'delete' &&
        !REFERRAL_UPDATE_STATUSES.has(referralPayload.status)
      ) {
        return NextResponse.json(
          apiError('INVALID_REFERRAL_STATUS', { received: referralPayload.status }),
          { status: 400 },
        );
      }
      const result = await processReferralUpdate(
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

    // Partograph observations from non-HOSxP senders (T21)
    if (payloadType === 'partograph') {
      const validation = validatePartographPayload(body);
      if (!validation.valid || !validation.payload) {
        return NextResponse.json(
          apiError('VALIDATION_FAILED', validation.error ?? 'unknown validation error'),
          { status: 400 },
        );
      }
      const result = await processPartographWebhook(
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
    }

    // Default: labor patient payload (unchanged)
    const validation = validatePayload(body);
    if (!validation.valid || !validation.payload) {
      return NextResponse.json(
        apiError('VALIDATION_FAILED', validation.error ?? 'unknown validation error'),
        { status: 400 },
      );
    }

    const result = await processWebhookPayload(
      db,
      keyInfo.hospitalId,
      validation.payload,
      sseManager,
    );

    // Bounded MOPH alert drain (codex #1 first-week risk: webhook EMERGENCY
    // alerts would otherwise sit pending until a browser-push drain runs — the
    // webhook path has no drain of its own). Best-effort: a failure never
    // breaks the webhook response; pending rows retry on the next drain.
    try {
      await drainMophAlerts(db, keyInfo.hospitalId);
    } catch (e) {
      logger.warn('webhook_moph_alert_drain_failed', {
        hospitalId: keyInfo.hospitalId,
        error: e,
      });
    }

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof WebhookReferralError) {
      const status = error.code === 'REFERRAL_NOT_FOUND' ? 404 : 400;
      return NextResponse.json(apiError(error.code), { status });
    }
    logger.error('webhook_processing_failed', {
      error,
      hospitalId: logCtx.hospitalId ?? null,
      payloadType: logCtx.payloadType ?? null,
    });
    return NextResponse.json(apiError('INTERNAL_ERROR'), { status: 500 });
  }
}
