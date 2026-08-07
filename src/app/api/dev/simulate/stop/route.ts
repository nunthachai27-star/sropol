// POST /api/dev/simulate/stop — dev-only. Cancels all simulation workers.
import { NextResponse } from 'next/server';
import { simulationGuard } from '../_guard';
import { simulationOrchestrator } from '@/services/dev-simulation/orchestrator';

export async function POST() {
  const guard = await simulationGuard();
  if (guard instanceof NextResponse) return guard;
  const status = await simulationOrchestrator.stop();
  return NextResponse.json(status);
}
