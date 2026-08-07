// TDD for the clinical-chatbot gate + DeepSeek-V4-Flash smoke (plan:
// docs/superpowers/plans/2026-08-03-clinical-chatbot-glm.md).
// The chatbot is ENABLED BY DEFAULT; only CLINICAL_CHAT_ENABLED="false" turns it
// off (explicit opt-out — like MOPH_ALERTS_ENABLED). When disabled the route
// must short-circuit 503 WITHOUT calling the LLM (proven by asserting
// global.fetch is never invoked). The inference target is DeepSeek-V4-Flash
// served at the on-prem SGLang/vLLM endpoint; sampling follows the DeepSeek
// V4 spec (temperature 1.0, top_p 1.0), with reasoning (thinking) ENABLED for
// answer quality — rationale: DeepSeek sampling params only take effect while
// thinking is on, and the 8k token cap covers reasoning tokens.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testSessionUser } from '../../helpers/session';

let mockSessionUser: Record<string, unknown> | null = null;
const ORIG_FLAG = process.env.CLINICAL_CHAT_ENABLED;

vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));
vi.mock('@/db/connection', () => ({
  getDatabase: async () => ({ query: async () => [] }),
}));

import { POST } from '@/app/api/chat/route';

function jsonRequest(body: unknown): Request {
  return new Request('http://test/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat — cost gate + DeepSeek-V4-Flash smoke', () => {
  beforeEach(() => {
    mockSessionUser = testSessionUser({ hospitalCode: '10670' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (ORIG_FLAG === undefined) delete process.env.CLINICAL_CHAT_ENABLED;
    else process.env.CLINICAL_CHAT_ENABLED = ORIG_FLAG;
  });

  it('rejects anonymous sessions (401/403)', async () => {
    mockSessionUser = null;
    delete process.env.CLINICAL_CHAT_ENABLED;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(jsonRequest({ message: 'สวัสดี' }) as never);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('flag unset -> ENABLED by default: calls LLM and returns 200', async () => {
    delete process.env.CLINICAL_CHAT_ENABLED;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'ความดัน 140/90 ถือเป็นความเสี่ยงสูง' } }],
            }),
            { status: 200 },
          ),
      ),
    );
    const res = await POST(jsonRequest({ message: 'ความดัน 140/90 อันตรายไหม?' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain('ความดัน 140/90');
  });

  it('flag "false" -> 503 Thai message, LLM never called', async () => {
    process.env.CLINICAL_CHAT_ENABLED = 'false';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(jsonRequest({ message: 'สวัสดี' }) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('ปิดใช้งานผู้ช่วยแชททางคลินิก');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('flag "true" -> DeepSeek-V4-Flash with DeepSeek sampling spec, returns answer', async () => {
    process.env.CLINICAL_CHAT_ENABLED = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: 'ความดัน 140/90 ถือเป็นความเสี่ยงสูง',
                    finish_reason: 'stop',
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 8 },
            }),
            { status: 200 },
          ),
      ),
    );
    const res = await POST(jsonRequest({ message: 'ความดัน 140/90 อันตรายไหม?' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain('ความดัน 140/90');

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(String(url)).toContain('/v1/chat/completions');
    const sent = JSON.parse(init.body) as {
      model?: string;
      max_tokens?: number;
      temperature?: number;
      top_p?: number;
      top_k?: number;
      chat_template_kwargs?: { enable_thinking?: boolean };
    };
    // DeepSeek-V4-Flash is the served model.
    expect(sent.model).toBe('deepseek-v4-flash');
    // Thinking (reasoning) ENABLED by default for answer quality; hard token
    // cap 8k gives headroom for reasoning tokens.
    expect(sent.chat_template_kwargs?.enable_thinking).toBe(true);
    expect(sent.max_tokens).toBe(8000);
    // DeepSeek V4 sampling spec: temperature 1.0, top_p 1.0, top_k non-restrictive.
    expect(sent.temperature).toBe(1.0);
    expect(sent.top_p).toBe(1.0);
    expect(typeof sent.top_k).toBe('number');
    expect(sent.top_k).toBeLessThanOrEqual(0); // -1/0 = disabled "usually only need temperature"
  });

  it('rejects an invalid mode with 400 (no silent misspelling)', async () => {
    process.env.CLINICAL_CHAT_ENABLED = 'true';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      jsonRequest({ message: 'กี่คนคะ', mode: 'statstics' }) as never, // typo
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('mode');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts statistics mode (dashboard aggregate answers)', async () => {
    process.env.CLINICAL_CHAT_ENABLED = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'มีผู้ป่วยทั้งหมด 2 คน' } }],
            }),
            { status: 200 },
          ),
      ),
    );
    const res = await POST(jsonRequest({ message: 'มีผู้ป่วยกี่คน', mode: 'statistics' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toContain('2');
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const sent = JSON.parse(init.body) as { messages?: Array<{ role: string; content: string }> };
    const system = sent.messages?.find((m) => m.role === 'system');
    expect(system?.content).toContain('สถิติ');
  });
});
