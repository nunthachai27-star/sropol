// T092: Admin API route tests — TDD: write tests FIRST
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../../helpers/testDb';
import type { DatabaseAdapter } from '@/db/adapter';

describe('Admin API Logic', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDb();

    // Seed hospitals
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['hosp-1', '10670', 'รพ.ขอนแก่น', 'A_S', true, 'ONLINE', now, now],
    );
    await db.execute(
      `INSERT INTO hospitals (id, hcode, name, level, is_active, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['hosp-2', '11000', 'รพ.น้ำพอง', 'M1', true, 'OFFLINE', now, now],
    );
  });

  it('returns hospitals with BMS config status', async () => {
    // Add BMS config for first hospital
    await db.execute(
      `INSERT INTO hospital_bms_config (id, hospital_id, tunnel_url, session_jwt, database_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        'cfg-1',
        'hosp-1',
        'https://tunnel1.example.com',
        'jwt-123',
        'postgresql',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    const hospitals = await db.query<{
      hcode: string;
      name: string;
      connection_status: string;
      tunnel_url: string | null;
      session_jwt: string | null;
      database_type: string | null;
    }>(
      `SELECT h.hcode, h.name, h.connection_status,
              hbc.tunnel_url, hbc.session_jwt, hbc.database_type
       FROM hospitals h
       LEFT JOIN hospital_bms_config hbc ON hbc.hospital_id = h.id
       ORDER BY h.name`,
    );

    expect(hospitals.length).toBe(2);
    // First hospital has BMS config
    const configuredHospital = hospitals.find((h) => h.hcode === '10670');
    expect(configuredHospital?.tunnel_url).toBe('https://tunnel1.example.com');
    expect(configuredHospital?.database_type).toBe('postgresql');

    // Second hospital has no BMS config
    const unconfiguredHospital = hospitals.find((h) => h.hcode === '11000');
    expect(unconfiguredHospital?.tunnel_url).toBeNull();
  });

  it('updates BMS config for a hospital', async () => {
    await db.execute(
      `INSERT INTO hospital_bms_config (id, hospital_id, tunnel_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'cfg-1',
        'hosp-1',
        'https://old-tunnel.example.com',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    await db.execute(
      `UPDATE hospital_bms_config SET tunnel_url = ?, updated_at = ? WHERE hospital_id = ?`,
      ['https://new-tunnel.example.com', new Date().toISOString(), 'hosp-1'],
    );

    const configs = await db.query<{ tunnel_url: string }>(
      'SELECT tunnel_url FROM hospital_bms_config WHERE hospital_id = ?',
      ['hosp-1'],
    );

    expect(configs[0].tunnel_url).toBe('https://new-tunnel.example.com');
  });

  it('creates BMS config if not exists', async () => {
    await db.execute(
      `INSERT INTO hospital_bms_config (id, hospital_id, tunnel_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'cfg-2',
        'hosp-2',
        'https://tunnel2.example.com',
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );

    const configs = await db.query<{ tunnel_url: string }>(
      'SELECT tunnel_url FROM hospital_bms_config WHERE hospital_id = ?',
      ['hosp-2'],
    );

    expect(configs.length).toBe(1);
    expect(configs[0].tunnel_url).toBe('https://tunnel2.example.com');
  });
});
