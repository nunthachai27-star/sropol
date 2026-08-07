// T109: Health check endpoint tests — TDD: write tests FIRST
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';
import { SeedOrchestrator } from '@/db/seeds/index';

describe('Health Check', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();
    await new SeedOrchestrator().run(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('should return degraded status when no hospital has ever synced (grace state)', async () => {
    // All 26 seeded hospitals start UNKNOWN — zero usable integrations must
    // never be reported as 'healthy'.
    const { getHealthStatus } = await import('@/services/health');
    const status = await getHealthStatus(db);
    expect(status.status).toBe('degraded');
    expect(status.database).toBe('connected');
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.hospitalConnections).toBeDefined();
    expect(status.hospitalConnections.total).toBe(26); // seeded KK hospitals
    expect(status.degradedReasons).toContain('no_hospitals_online');
  });

  it('should report hospital connection counts', async () => {
    const { getHealthStatus } = await import('@/services/health');
    const status = await getHealthStatus(db);
    expect(status.hospitalConnections.online).toBe(0);
    expect(status.hospitalConnections.offline).toBe(0);
    expect(status.hospitalConnections.unknown).toBe(26);
  });

  it('should return healthy status once at least one hospital is online', async () => {
    await db.execute(
      "UPDATE hospitals SET connection_status = 'ONLINE' WHERE hcode = (SELECT hcode FROM hospitals LIMIT 1)",
    );
    const { getHealthStatus } = await import('@/services/health');
    const status = await getHealthStatus(db);
    expect(status.status).toBe('healthy');
    expect(status.hospitalConnections.online).toBe(1);
    expect(status.degradedReasons).toEqual([]);
  });
});
