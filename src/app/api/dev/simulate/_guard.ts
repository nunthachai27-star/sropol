// Shared guard for /api/dev/simulate/* routes.
// Two gates, both mandatory: (1) simulation feature enabled (hard-false in
// production), (2) handler-level admin authorization — middleware is defense
// in depth, not the authorization decision.
// Returns the admin Session on success (callers use it for audit identity),
// otherwise a NextResponse the caller must return directly.
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { isSimulationEnabled } from '@/lib/feature-flags';
import { requireAdmin } from '@/lib/admin-guard';

export async function simulationGuard(): Promise<Session | NextResponse> {
  if (!isSimulationEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return requireAdmin();
}
