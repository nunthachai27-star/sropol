// Readiness: 200 only when startup (config validation + migrations + seeds)
// succeeded AND the database answers. Liveness stays at /api/health.
import { NextResponse } from 'next/server';
import { getDatabase } from '@/db/connection';
import { ensureInit } from '@/lib/ensure-init';

export async function GET() {
  try {
    await ensureInit();
    const db = await getDatabase();
    await db.query('SELECT 1 as ok');
    return NextResponse.json({ ready: true, timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      {
        ready: false,
        reason: error instanceof Error ? error.message : 'unknown initialization failure',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
