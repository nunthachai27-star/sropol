// GET /api/dev/simulate/models — dev-only. Proxies the LLM /v1/models list so
// the UI can populate a model-picker without baking vLLM URL into the client.
import { NextResponse } from 'next/server';
import { simulationGuard } from '../_guard';
import { listLlmModels } from '@/lib/llm-client';

export async function GET() {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;
  try {
    const models = await listLlmModels();
    return NextResponse.json({ models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, models: [] }, { status: 502 });
  }
}
