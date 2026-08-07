// TDD (Red→Green) for the MOPH Prompt sender client.
// Pins the external API contract from docs/superpowers/plans/2026-07-26-moph-prompt-alerts.md.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendMophPrompt } from '@/services/moph-prompt';
import type { MophPromptResponse } from '@/services/moph-prompt';

// ---- helpers --------------------------------------------------------------
const CID_13 = '3320500282121'; // synthetic 13-digit placeholder from the API spec

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Captures every fetch call's (url, init) so tests assert wire shape. */
function mockFetchSeq(responses: Response[]): {
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ url: _url, init: init ?? {} });
      return responses[Math.min(i++, responses.length - 1)];
    }),
  );
  return { calls };
}

// ---- tests ----------------------------------------------------------------
describe('sendMophPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.MOPH_PROMPT_API_URL = 'https://sms.test/moph/send';
    process.env.MOPH_MAX_502_RETRIES = '2';
    process.env.MOPH_RETRY_BACKOFF_MS = '10';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.MOPH_PROMPT_API_URL;
    delete process.env.MOPH_MAX_502_RETRIES;
    delete process.env.MOPH_RETRY_BACKOFF_MS;
  });

  it('sends a POST with Bearer session, cid, title, text — never hospital_code/name', async () => {
    const { calls } = mockFetchSeq([
      jsonResponse(200, {
        message_id: 'msg-1',
        hospital_code: '10682',
        hospital_name: 'รพ.ขอนแก่น',
        line: { success: true, status: 'success' },
      }),
    ]);

    const res = await sendMophPrompt({
      sessionId: 'SESS-1',
      cid: CID_13,
      title: 'แจ้งเตือนกรณีเสี่ยงสูง',
      text: 'มีกรณีเสี่ยงสูงเข้ารับการรักษา',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sms.test/moph/send');
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer SESS-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.cid).toBe(CID_13);
    expect(body.title).toBe('แจ้งเตือนกรณีเสี่ยงสูง');
    expect(body.text).toBe('มีกรณีเสี่ยงสูงเข้ารับการรักษา');
    // The API resolves hospital from the session — we must NOT send it.
    expect(body.hospital_code).toBeUndefined();
    expect(body.hospital_name).toBeUndefined();

    expect(res.line.success).toBe(true);
    expect(res.line.status).toBe('success');
    expect(res.messageId).toBe('msg-1');
  });

  it('includes optional confirm_url / service_id / flex when provided', async () => {
    const { calls } = mockFetchSeq([
      jsonResponse(200, { message_id: 'm', line: { success: true, status: 'success' } }),
    ]);
    await sendMophPrompt({
      sessionId: 'S',
      cid: CID_13,
      title: 't',
      text: 'x',
      confirmUrl: 'https://app/case/1',
      serviceId: 'svc-1',
      flex: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } },
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.confirm_url).toBe('https://app/case/1');
    expect(body.service_id).toBe('svc-1');
    expect(body.flex).toBeDefined();
  });

  it('validates cid is exactly 13 digits before calling fetch (400 contract)', async () => {
    mockFetchSeq([jsonResponse(200, { line: { success: true } })]);
    await expect(
      sendMophPrompt({ sessionId: 'S', cid: '123', title: 't', text: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_CID' });
    await expect(
      sendMophPrompt({ sessionId: 'S', cid: '1234567890123', title: 't', text: 'x' }),
    ).resolves.toBeDefined(); // 13 digits ok
  });

  it('maps 401 → AUTH error (non-retryable)', async () => {
    mockFetchSeq([jsonResponse(401, { error: 'no bearer' })]);
    await expect(
      sendMophPrompt({ sessionId: 'S', cid: CID_13, title: 't', text: 'x' }),
    ).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('maps 422 → VALIDATION error (non-retryable)', async () => {
    mockFetchSeq([jsonResponse(422, { error: 'missing title' })]);
    await expect(
      sendMophPrompt({ sessionId: 'S', cid: CID_13, title: '', text: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('retries only on 502 with backoff, then gives up as RETRYABLE_EXHAUSTED', async () => {
    // MAX_502_RETRIES=2 → initial + 2 retries = 3 calls, all 502.
    const { calls } = mockFetchSeq([
      jsonResponse(502, { error: 'jwt' }),
      jsonResponse(502, { error: 'jwt' }),
      jsonResponse(502, { error: 'jwt' }),
    ]);
    // Drive the whole retry chain to settlement in one microtask flush so the
    // final rejection is observed by `rejects` (avoids an unhandled rejection
    // that slips out of a fire-and-advance pattern under fake timers).
    const p = sendMophPrompt({ sessionId: 'S', cid: CID_13, title: 't', text: 'x' });
    const expectation = expect(p).rejects.toMatchObject({ code: 'RETRYABLE_EXHAUSTED' });
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
    expect(calls).toHaveLength(3); // 1 + 2 retries
  });

  it('succeeds after a transient 502', async () => {
    mockFetchSeq([
      jsonResponse(502, { error: 'jwt' }),
      jsonResponse(200, { message_id: 'm2', line: { success: true, status: 'success' } }),
    ]);
    const p = sendMophPrompt({ sessionId: 'S', cid: CID_13, title: 't', text: 'x' });
    const expectation: Promise<MophPromptResponse> = p.then((r) => r);
    await vi.advanceTimersByTimeAsync(1000);
    const res = await expectation;
    expect(res.messageId).toBe('m2');
  });

  it('does not retry on 400 (terminal CLIENT_ERROR)', async () => {
    const { calls } = mockFetchSeq([jsonResponse(400, { error: 'bad cid' })]);
    await expect(
      sendMophPrompt({ sessionId: 'S', cid: CID_13, title: 't', text: 'x' }),
    ).rejects.toMatchObject({ code: 'CLIENT_ERROR' });
    expect(calls).toHaveLength(1);
  });

  it('treats line.status skipped as a non-error skipped outcome', async () => {
    const res = await runWith([
      jsonResponse(200, { message_id: null, line: { success: false, status: 'skipped' } }),
    ]);
    expect(res.line.status).toBe('skipped');
    expect(res.line.success).toBe(false);
  });

  async function runWith(responses: Response[]): Promise<MophPromptResponse> {
    mockFetchSeq(responses);
    return sendMophPrompt({ sessionId: 'S', cid: CID_13, title: 't', text: 'x' });
  }
});
