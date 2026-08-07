// TDD for the province center-monitors admin API (GET/POST/PUT/DELETE).
// Light: mocks db/auth/ensure-init (no PGlite boot), mirrors admin-moph-alerts test.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapter';
import { UserRole } from '@/types/domain';

let db: DatabaseAdapter;
let mockSessionUser: Record<string, unknown> | null = null;

vi.mock('@/db/connection', () => ({ getDatabase: async () => db }));
vi.mock('@/lib/ensure-init', () => ({ ensureInit: async () => {} }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (mockSessionUser ? { user: mockSessionUser } : null),
}));

import {
  GET as listGET,
  POST as createPOST,
} from '@/app/api/admin/provinces/[provinceCode]/center-monitors/route';
import {
  PUT as itemPUT,
  DELETE as itemDELETE,
} from '@/app/api/admin/provinces/[provinceCode]/center-monitors/[monitorId]/route';

const PROV = '30';

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}
function ctx(provinceCode: string) {
  return { params: Promise.resolve({ provinceCode }) };
}
function itemCtx(provinceCode: string, monitorId: string) {
  return { params: Promise.resolve({ provinceCode, monitorId }) };
}

const ADMIN = {
  id: 'u-admin',
  name: 'แอดมิน',
  userCid: '1100500090006',
  role: UserRole.ADMIN,
  hospitalCode: '10670',
  hospitalName: 'รพ.ขอนแก่น',
  accessMode: 'readwrite' as const,
  authProvider: 'bms' as const,
  tunnelUrl: '',
  databaseType: '',
};

describe('center-monitors admin API', () => {
  beforeEach(() => {
    mockSessionUser = ADMIN;
    db = {
      query: vi.fn(async () => [] as unknown[]),
      execute: vi.fn(async () => undefined),
    } as unknown as DatabaseAdapter;
  });
  afterEach(() => vi.restoreAllMocks());

  it('GET lists monitors for the province', async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'm1',
        province: PROV,
        cid: '3320500282121',
        name: 'ศูนย์กลาง ขก.',
        position: 'พยาบาลวิชาชีพ',
        is_active: true,
        created_at: 't',
        updated_at: 't',
      },
    ]);
    const res = await listGET(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors`) as never,
      ctx(PROV) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monitors).toHaveLength(1);
    expect(body.monitors[0]).toMatchObject({ cid: '3320500282121', isActive: true });
  });

  it('POST creates a monitor (201) with 13-digit CID', async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // no duplicate
    const res = await createPOST(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: '3320500282121', name: 'ศูนย์กลาง', position: 'พยาบาล' }),
      }) as never,
      ctx(PROV) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.monitor.cid).toBe('3320500282121');
    expect(db.execute).toHaveBeenCalled();
  });

  it('POST 400 on malformed CID', async () => {
    const res = await createPOST(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: '123', name: 'x' }),
      }) as never,
      ctx(PROV) as never,
    );
    expect(res.status).toBe(400);
  });

  it('POST 409 on duplicate CID', async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'existing' }]);
    const res = await createPOST(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: '3320500282121', name: 'ซ้ำ' }),
      }) as never,
      ctx(PROV) as never,
    );
    expect(res.status).toBe(409);
  });

  it('PUT updates name/position/active', async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'm1' }]) // existing
      .mockResolvedValueOnce([]); // no duplicate
    const res = await itemPUT(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors/m1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cid: '3320500282121',
          name: 'เปลี่ยนชื่อ',
          position: 'หัวหน้า',
          isActive: false,
        }),
      }) as never,
      itemCtx(PROV, 'm1') as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.monitor.isActive).toBe(false);
  });

  it('PUT 404 when monitor not found', async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const res = await itemPUT(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors/nope`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cid: '3320500282121', name: 'x' }),
      }) as never,
      itemCtx(PROV, 'nope') as never,
    );
    expect(res.status).toBe(404);
  });

  it('DELETE soft-deletes (is_active=false)', async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'm1' }]);
    const res = await itemDELETE(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors/m1`, {
        method: 'DELETE',
      }) as never,
      itemCtx(PROV, 'm1') as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    // execute was called with is_active=false (soft-delete)
    const execArgs = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(execArgs[1]).toContain(false);
  });

  it('rejects non-admin (401/403)', async () => {
    mockSessionUser = { ...ADMIN, role: UserRole.NURSE };
    const res = await listGET(
      req(`http://test/api/admin/provinces/${PROV}/center-monitors`) as never,
      ctx(PROV) as never,
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
