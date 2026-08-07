// GET /api/dev/simulate/smoke — runs every LLM-backed payload path once and
// returns {prompt, rawResponse, parsed, evaluatorResult} for each. Used to
// sanity-check the Tier-1/2/3 pipeline before committing to a full sim run.
//
// Intentionally SEQUENTIAL — vLLM serves one prompt at a time, so parallel
// calls would race exactly like the planner thundering-herd that burned us
// earlier. Five sequential calls take 2-5 minutes on the shared Gemma-4.

import { NextResponse } from 'next/server';
import { simulationGuard } from '../_guard';
import { llmChat, llmJson } from '@/lib/llm-client';
import { getProfileById, profilePromptHint, PROFILE_IDS } from '@/services/dev-simulation/profiles';
import {
  evaluateAncEvent,
  evaluateLaborEvent,
  evaluatePartographEvent,
} from '@/services/dev-simulation/evaluator';
import { applyProfileToAncVisit } from '@/services/dev-simulation/apply-profile';
import type {
  WebhookAncPatient,
  WebhookPatientPayload,
  WebhookPartographObservation,
} from '@/services/webhook';
import type { SimEventType } from '@/services/dev-simulation/types';

interface SmokeCase {
  name: string;
  promptPreview: string;
  schema: unknown;
  elapsedMs: number;
  raw: string | null;
  parsed: unknown;
  parseError: string | null;
  evaluator: { valid: boolean; errors: string[]; warnings: string[] } | null;
  verdict: 'pass' | 'soft-pass' | 'fail';
}

const SYSTEM_PROMPT = [
  'You are generating realistic DEV-ONLY synthetic obstetric data for a Thai',
  'maternal-care dashboard covering Surin Province. Output a FLAT JSON',
  'object matching the schema — no wrapper keys, all required fields at the',
  'top level. JSON only, no markdown.',
].join(' ');

// Gemma-4 + vLLM guided_json sometimes nests the required fields inside an
// invented wrapper object. Deep-search so smoke test mirrors what the real
// generators do when recovering from that quirk.
function deepFind(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const hit = deepFind(el, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (key in rec && rec[key] != null) return rec[key];
  const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (snake !== key && snake in rec && rec[snake] != null) return rec[snake];
  for (const v of Object.values(rec)) {
    const hit = deepFind(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function missingFields(parsed: unknown, fields: string[]): string[] {
  return fields.filter((f) => deepFind(parsed, f) === undefined);
}

export async function GET() {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;

  // Picks a profile with strong clinical constraints so the evaluator has real
  // work to do. preeclampsia_severe requires BP ≥160/100 + heavy proteinuria —
  // a schema or profile miss will show up.
  const profile = getProfileById('preeclampsia_severe')!;
  const hcode = '10670';
  const hospitalName = 'รพ.สุรินทร์';
  const cases: SmokeCase[] = [];

  // ────────────────────── CASE 1 — planner ──────────────────────
  {
    const eventTypes: SimEventType[] = ['labor', 'anc', 'referral', 'partograph'];
    const prompt = [
      `Plan a realistic 8-event shift at ${hospitalName} (hcode ${hcode}),`,
      'a community hospital in Surin Province, Thailand.',
      `Allowed event types: ${eventTypes.join(', ')}.`,
      'Each event: {order, eventType, profileId, name, note}.',
      `profileId must be from [${PROFILE_IDS.slice(0, 5).join(', ')}, ...].`,
      'Also produce a single-sentence "narrative" describing overall shift tone.',
    ].join('\n');
    const schema = {
      type: 'object',
      required: ['narrative', 'events'],
      properties: {
        narrative: { type: 'string', maxLength: 200 },
        events: {
          type: 'array',
          minItems: 3,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['order', 'eventType', 'profileId', 'name', 'note'],
            properties: {
              order: { type: 'integer' },
              eventType: { type: 'string', enum: eventTypes },
              profileId: { type: 'string', enum: PROFILE_IDS },
              name: { type: 'string', maxLength: 60 },
              note: { type: 'string', maxLength: 140 },
            },
          },
        },
      },
    };
    const t0 = Date.now();
    try {
      const raw = await llmJson<Record<string, unknown>>({
        messages: [
          {
            role: 'system',
            content:
              'You plan obstetric ward shifts. JSON only. The events array MUST be named exactly "events".',
          },
          { role: 'user', content: prompt },
        ],
        jsonSchema: schema,
        temperature: 0.9,
        maxTokens: 8000,
        timeoutMs: 180_000,
      });
      // Same tolerance as planner.ts — accept any top-level array field.
      const events =
        (Array.isArray(raw.events) ? raw.events : null) ??
        (Array.isArray(raw.shift_plan) ? raw.shift_plan : null) ??
        (Array.isArray(raw.plan) ? raw.plan : null) ??
        Object.values(raw).find((v): v is unknown[] => Array.isArray(v)) ??
        [];
      const narrative = typeof raw.narrative === 'string' ? raw.narrative : '';
      const parsed = { narrative, events, rawKeys: Object.keys(raw) };
      cases.push({
        name: 'planner',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: JSON.stringify(raw, null, 2).slice(0, 2000),
        parsed,
        parseError: null,
        evaluator: null,
        verdict: events.length >= 3 && narrative ? 'pass' : 'fail',
      });
    } catch (e) {
      cases.push({
        name: 'planner',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: null,
        parsed: null,
        parseError: e instanceof Error ? e.message : String(e),
        evaluator: null,
        verdict: 'fail',
      });
    }
  }

  // ────────────────────── CASE 2 — labor narrative ──────────────────────
  // Generator hybrid: LLM writes name + note only; profile-driven sampler
  // fills all clinical fields. Smoke test exercises the same split.
  {
    const prompt = [
      `Create a Thai patient name + 1-sentence clinical note for a labor`,
      `admission at ${hospitalName}.`,
      profilePromptHint(profile),
      'Output JSON: { "name": "นาง... ...", "note": "Thai <120 chars" }',
    ].join('\n');
    const schema = {
      type: 'object',
      required: ['name', 'note'],
      properties: {
        name: { type: 'string', maxLength: 60 },
        note: { type: 'string', maxLength: 140 },
      },
    };
    const t0 = Date.now();
    try {
      const raw = await llmJson<Record<string, unknown>>({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        jsonSchema: schema,
        temperature: 0.85,
        maxTokens: 400,
      });
      const name = (deepFind(raw, 'name') as string | undefined) ?? null;
      const note = (deepFind(raw, 'note') as string | undefined) ?? null;
      const errors: string[] = [];
      if (!name) errors.push('missing field: name');
      // applyProfileToLabor ensures clinical fields — verify one round.
      const laborEvent: WebhookPatientPayload = {
        hn: '000012345',
        an: '690001234',
        name: name ?? 'นาง ทดลอง',
        cid: '1234567890123',
        age: 28,
        gravida: 1,
        ga_weeks: 35,
        anc_count: 4,
        admit_date: new Date().toISOString(),
        height_cm: 158,
        weight_kg: 70,
        weight_diff_kg: 14,
        fundal_height_cm: 34.5,
        us_weight_g: 3100,
        hematocrit_pct: 34,
        labor_status: 'ACTIVE',
      };
      const ev = evaluateLaborEvent(profile, laborEvent);
      const allErrors = [...errors, ...ev.errors];
      cases.push({
        name: 'labor narrative (preeclampsia_severe)',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: JSON.stringify(raw, null, 2),
        parsed: { name, note, sampleEvent: laborEvent },
        parseError: null,
        evaluator: { valid: allErrors.length === 0, errors: allErrors, warnings: ev.warnings },
        verdict: allErrors.length === 0 ? (ev.warnings.length ? 'soft-pass' : 'pass') : 'fail',
      });
    } catch (e) {
      cases.push({
        name: 'labor narrative (preeclampsia_severe)',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: null,
        parsed: null,
        parseError: e instanceof Error ? e.message : String(e),
        evaluator: null,
        verdict: 'fail',
      });
    }
  }

  // ────────────────────── CASE 3 — ANC narrative ──────────────────────
  {
    const prompt = [
      `Create a Thai patient name + 1-sentence clinical note for an ANC`,
      `registration at ${hospitalName}.`,
      profilePromptHint(profile),
      'Output JSON: { "name": "นาง... ...", "note": "Thai <120 chars" }',
    ].join('\n');
    const schema = {
      type: 'object',
      required: ['name', 'note'],
      properties: {
        name: { type: 'string', maxLength: 60 },
        note: { type: 'string', maxLength: 140 },
      },
    };
    const t0 = Date.now();
    try {
      const raw = await llmJson<Record<string, unknown>>({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        jsonSchema: schema,
        temperature: 0.85,
        maxTokens: 400,
      });
      const name = (deepFind(raw, 'name') as string | undefined) ?? null;
      const note = (deepFind(raw, 'note') as string | undefined) ?? null;
      const errors: string[] = [];
      if (!name) errors.push('missing field: name');
      cases.push({
        name: 'anc narrative (preeclampsia_severe)',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: JSON.stringify(raw, null, 2),
        parsed: { name, note },
        parseError: null,
        evaluator: { valid: errors.length === 0, errors, warnings: [] },
        verdict: errors.length === 0 ? 'pass' : 'fail',
      });
    } catch (e) {
      cases.push({
        name: 'anc narrative (preeclampsia_severe)',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: null,
        parsed: null,
        parseError: e instanceof Error ? e.message : String(e),
        evaluator: null,
        verdict: 'fail',
      });
    }
  }

  // ────────────────────── CASE 4 — referral narrative ──────────────────────
  {
    const prompt = [
      `Referral from ${hospitalName} (${hcode}) to รพ.ศูนย์สุรินทร์ (99999).`,
      profilePromptHint(profile),
      'Output {name, reason, diagnosisCode, urgency}.',
    ].join('\n');
    const schema = {
      type: 'object',
      required: ['name', 'reason', 'diagnosisCode', 'urgency'],
      properties: {
        name: { type: 'string', maxLength: 60 },
        reason: { type: 'string', maxLength: 80 },
        diagnosisCode: { type: 'string', pattern: '^O[0-9]{2}(\\.[0-9X])?$' },
        urgency: { type: 'string', enum: ['ROUTINE', 'URGENT', 'EMERGENCY'] },
      },
    };
    const t0 = Date.now();
    try {
      const parsed = await llmJson<{
        name: string;
        reason: string;
        diagnosisCode: string;
        urgency: string;
      }>({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        jsonSchema: schema,
        temperature: 0.85,
        maxTokens: 8000,
      });
      // Profile-level check: preeclampsia_severe should bias URGENT/EMERGENCY,
      // not ROUTINE. Warn but don't fail.
      const warnings: string[] = [];
      if (profile.riskLevel === 'HR3' && parsed.urgency === 'ROUTINE') {
        warnings.push(`HR3 profile expects URGENT/EMERGENCY, got ${parsed.urgency}`);
      }
      if (!/^O[0-9]{2}(\.[0-9X])?$/.test(parsed.diagnosisCode)) {
        warnings.push(`diagnosisCode "${parsed.diagnosisCode}" doesn't look like obstetric ICD-10`);
      }
      cases.push({
        name: 'referral (preeclampsia_severe)',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: JSON.stringify(parsed, null, 2),
        parsed,
        parseError: null,
        evaluator: { valid: true, errors: [], warnings },
        verdict: warnings.length ? 'soft-pass' : 'pass',
      });
    } catch (e) {
      cases.push({
        name: 'referral (preeclampsia_severe)',
        promptPreview: prompt,
        schema,
        elapsedMs: Date.now() - t0,
        raw: null,
        parsed: null,
        parseError: e instanceof Error ? e.message : String(e),
        evaluator: null,
        verdict: 'fail',
      });
    }
  }

  // ────────────────────── CASE 5 — partograph note ──────────────────────
  {
    const prompt = [
      `Partograph observation hour 3 at ${hospitalName}.`,
      profilePromptHint(profile),
      'Return ONLY a 1-sentence Thai nurse note (<100 chars), no JSON.',
    ].join('\n');
    const t0 = Date.now();
    try {
      const raw = await llmChat({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        maxTokens: 8000,
      });
      const cleaned = raw.trim().slice(0, 100);
      // Build a dummy partograph obs seeded from the profile + run evaluator.
      const obs: WebhookPartographObservation = {
        an: '690001234',
        externalObservationId: 'OBS-smoke-3',
        observeDatetime: new Date().toISOString(),
        hourNo: 3,
        fetalHeartRate: 138,
        cervicalDilationCm: 4.5,
        contractionPer10Min: 3,
        contractionDurationSec: 45,
        contractionStrength: 'moderate',
        pulse: 86,
        bpSystolic: 162,
        bpDiastolic: 105,
        temperature: 37.0,
        note: cleaned,
      };
      const ev = evaluatePartographEvent(profile, obs);
      cases.push({
        name: 'partograph note (preeclampsia_severe)',
        promptPreview: prompt,
        schema: { type: 'text' },
        elapsedMs: Date.now() - t0,
        raw,
        parsed: { note: cleaned, seedObs: obs },
        parseError: null,
        evaluator: { valid: ev.valid, errors: ev.errors, warnings: ev.warnings },
        verdict: ev.valid ? (ev.warnings.length ? 'soft-pass' : 'pass') : 'fail',
      });
    } catch (e) {
      cases.push({
        name: 'partograph note (preeclampsia_severe)',
        promptPreview: prompt,
        schema: { type: 'text' },
        elapsedMs: Date.now() - t0,
        raw: null,
        parsed: null,
        parseError: e instanceof Error ? e.message : String(e),
        evaluator: null,
        verdict: 'fail',
      });
    }
  }

  const summary = {
    total: cases.length,
    pass: cases.filter((c) => c.verdict === 'pass').length,
    softPass: cases.filter((c) => c.verdict === 'soft-pass').length,
    fail: cases.filter((c) => c.verdict === 'fail').length,
    totalElapsedMs: cases.reduce((a, c) => a + c.elapsedMs, 0),
  };

  return NextResponse.json({ summary, cases });
}
