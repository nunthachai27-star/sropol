// POST /api/dev/simulate/start — dev-only. Body: SimulationConfig. Begins
// per-hospital simulation loops; returns status snapshot.
import { NextRequest, NextResponse } from 'next/server';
import { simulationGuard } from '../_guard';
import { simulationOrchestrator } from '@/services/dev-simulation/orchestrator';
import type { SimulationConfig } from '@/services/dev-simulation/types';

export async function POST(request: NextRequest) {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;

  let body: Partial<SimulationConfig>;
  try {
    body = (await request.json()) as Partial<SimulationConfig>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const config: SimulationConfig = {
    hospitals: Array.isArray(body.hospitals) ? body.hospitals : [],
    eventTypes: Array.isArray(body.eventTypes) ? body.eventTypes : ['labor'],
    ratePerHospitalPerMin:
      typeof body.ratePerHospitalPerMin === 'number' ? body.ratePerHospitalPerMin : 2,
    durationMin: typeof body.durationMin === 'number' ? body.durationMin : 10,
    model: typeof body.model === 'string' && body.model ? body.model : 'gemma4',
    scenario: typeof body.scenario === 'string' ? body.scenario : undefined,
  };

  try {
    const status = await simulationOrchestrator.start(config);
    return NextResponse.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
