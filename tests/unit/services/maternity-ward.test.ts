import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listMaternityWards,
  listWardBedsInventory,
  listWardBedsOccupancy,
  upsertPartograph,
  deletePartograph,
  upsertVitalSign,
  deleteVitalSign,
  upsertPregnancy,
  upsertLabour,
} from '@/services/maternity-ward';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const cfg: ConnectionConfig = {
  apiUrl: 'https://t.example/api',
  bearerToken: 'BEARER',
  appIdentifier: 'KK-LRMS.Web',
};

describe('listMaternityWards', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns the data array from BMS /api/sql', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({
        data: [
          { ward: '03', name: 'ห้องคลอด', real_bedcount: 12 },
          { ward: '04', name: 'ห้องคลอด VIP', real_bedcount: 4 },
        ],
        MessageCode: 200,
        Message: 'ok',
      }),
    });

    const wards = await listMaternityWards(cfg);
    expect(wards).toHaveLength(2);
    expect(wards[0]).toEqual({ ward: '03', name: 'ห้องคลอด', real_bedcount: 12 });
  });

  it('issues a SQL query against the maternity-wards template', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [], MessageCode: 200, Message: 'ok' }),
    });
    await listMaternityWards(cfg);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sql).toContain('FROM ward');
    expect(body.sql).toContain("is_maternity_ward = 'Y'");
  });

  it('returns empty array when BMS returns no data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [], MessageCode: 200, Message: 'ok' }),
    });
    expect(await listMaternityWards(cfg)).toEqual([]);
  });

  it('propagates BMS errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 501,
      statusText: 'Not Implemented',
      clone: function () {
        return { json: async () => ({ MessageCode: 401, Message: 'unauthorized' }) };
      },
      text: async () => '',
    });
    await expect(listMaternityWards(cfg)).rejects.toThrow(/Session unauthorized/);
  });
});

describe('listWardBedsInventory', () => {
  beforeEach(() => mockFetch.mockReset());

  it('passes ward as a SQL param and returns BedSlot[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({
        data: [
          {
            bedno: '01',
            roomno: 'LR1',
            bed_order: 1,
            bed_lock: 'N',
            bed_status_type_id: 1,
            room_name: 'LR1',
            room_display_number: 1,
          },
          {
            bedno: '02',
            roomno: 'LR1',
            bed_order: 2,
            bed_lock: 'N',
            bed_status_type_id: 1,
            room_name: 'LR1',
            room_display_number: 1,
          },
        ],
        MessageCode: 200,
        Message: 'ok',
      }),
    });
    const beds = await listWardBedsInventory(cfg, '03');
    expect(beds).toHaveLength(2);
    expect(beds[0].bedno).toBe('01');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toEqual({ ward: '03' });
    expect(body.sql).toContain('FROM bedno');
  });
});

describe('listWardBedsOccupancy', () => {
  beforeEach(() => mockFetch.mockReset());

  it('passes ward as a SQL param and returns BedOccupancy[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({
        data: [
          {
            an: 'AN1',
            hn: 'HN1',
            regdate: '2026-04-19',
            regtime: '10:00:00',
            ward: '03',
            bedno: '01',
            roomno: 'LR1',
            bedtype: null,
            roomname: 'LR1',
            pname: null,
            fname: 'นางA',
            lname: null,
            birthday: '1998-01-01',
            gravida: 2,
            ga: 38,
            incharge_doctor_name: 'ดร.X',
            last_observation_at: '2026-04-19T08:00:00',
            last_cervix_cm: 4,
          },
        ],
        MessageCode: 200,
        Message: 'ok',
      }),
    });
    const occ = await listWardBedsOccupancy(cfg, '03');
    expect(occ).toHaveLength(1);
    expect(occ[0].an).toBe('AN1');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params).toEqual({ ward: '03' });
    expect(body.sql).toContain("i.confirm_discharge = 'N'");
  });
});

describe('upsertPartograph', () => {
  beforeEach(() => mockFetch.mockReset());

  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial via callFunction then restInsert + audit', async () => {
    // 1) callFunction → returns Value 99
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 99 }),
    });
    // 2) restInsert → ok
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', insert_count: 1 }),
    });
    // 3) audit POST → ok (fire-and-forget)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const result = await upsertPartograph(
      cfg,
      userInfo,
      'AN1',
      { cervical_dilation_cm: 4, fetal_heart_rate: 140 },
      '10670',
    );
    expect(result.ipt_labour_partograph_id).toBe(99);

    // Verify call sequence
    expect(mockFetch.mock.calls[0][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[1][0]).toBe('https://t.example/api/api/rest/ipt_labour_partograph');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    const insertBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(insertBody).toMatchObject({
      ipt_labour_partograph_id: 99,
      an: 'AN1',
      cervical_dilation_cm: 4,
    });

    // Audit call (fire-and-forget — let microtask queue drain)
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch.mock.calls[2][0]).toBe('/api/hospital/audit-log');
    const auditBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_labour_partograph',
      op: 'insert',
      resourceId: '99',
      hcode: '10670',
      staff: 'nurse1',
    });
  });

  it('update: skips serial mint, calls restUpdate + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await upsertPartograph(
      cfg,
      userInfo,
      'AN1',
      { ipt_labour_partograph_id: 7, cervical_dilation_cm: 5 },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt_labour_partograph/7');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const putBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(putBody).toEqual({ cervical_dilation_cm: 5 });
    expect(putBody.ipt_labour_partograph_id).toBeUndefined();

    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch.mock.calls[1][0]).toBe('/api/hospital/audit-log');
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_labour_partograph',
      op: 'update',
      resourceId: '7',
      hcode: '10670',
      staff: 'nurse1',
      fieldsTouched: ['cervical_dilation_cm'],
    });
  });

  it('does not throw if audit POST returns non-ok (fire-and-forget)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      upsertPartograph(
        cfg,
        userInfo,
        'AN1',
        { ipt_labour_partograph_id: 1, cervical_dilation_cm: 4 },
        '10670',
      ),
    ).resolves.toBeDefined();
  });
});

describe('deletePartograph', () => {
  beforeEach(() => mockFetch.mockReset());

  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('calls restDelete and fires audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    await deletePartograph(cfg, userInfo, 42, '10670');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rest/ipt_labour_partograph/42');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch.mock.calls[1][0]).toBe('/api/hospital/audit-log');
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_labour_partograph',
      op: 'delete',
      resourceId: '42',
      hcode: '10670',
      staff: 'nurse1',
    });
  });
});

// ─── Task 42: vital signs CRUD ─────────────────────────────────────────────
describe('upsertVitalSign', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial then restInsert + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 55 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', insert_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const result = await upsertVitalSign(cfg, userInfo, 'AN1', { hr: 88, bps: 120 }, '10670');
    expect(result.ipt_pregnancy_vital_sign_id).toBe(55);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[1][0]).toBe('https://t.example/api/api/rest/ipt_pregnancy_vital_sign');
    const insertBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(insertBody).toMatchObject({
      ipt_pregnancy_vital_sign_id: 55,
      an: 'AN1',
      hr: 88,
      bps: 120,
    });
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_pregnancy_vital_sign',
      op: 'insert',
      resourceId: '55',
      hcode: '10670',
      staff: 'nurse1',
    });
  });

  it('update: skips serial mint, calls restUpdate + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    await upsertVitalSign(
      cfg,
      userInfo,
      'AN1',
      { ipt_pregnancy_vital_sign_id: 9, hr: 90 },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://t.example/api/api/rest/ipt_pregnancy_vital_sign/9',
    );
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const putBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(putBody).toEqual({ hr: 90 });
    expect(putBody.ipt_pregnancy_vital_sign_id).toBeUndefined();
  });

  it('does not throw if audit POST fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      upsertVitalSign(cfg, userInfo, 'AN1', { ipt_pregnancy_vital_sign_id: 1, hr: 90 }, '10670'),
    ).resolves.toBeDefined();
  });
});

describe('deleteVitalSign', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('calls restDelete and fires audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    await deleteVitalSign(cfg, userInfo, 21, '10670');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rest/ipt_pregnancy_vital_sign/21');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_pregnancy_vital_sign',
      op: 'delete',
      resourceId: '21',
      hcode: '10670',
    });
  });
});

// ─── Task 43: pregnancy + labour upsert (composite write) ──────────────────
describe('upsertPregnancy', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('calls restUpdate keyed by an + audit (1:1 record per AN)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await upsertPregnancy(
      cfg,
      userInfo,
      'AN1',
      { preg_number: 3, ga: 39, anc_complete: 'Y' },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt_pregnancy/AN1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ preg_number: 3, ga: 39, anc_complete: 'Y' });
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_pregnancy',
      op: 'update',
      resourceId: 'AN1',
      hcode: '10670',
      staff: 'nurse1',
      fieldsTouched: ['preg_number', 'ga', 'anc_complete'],
    });
  });

  it('does not throw if audit fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      upsertPregnancy(cfg, userInfo, 'AN1', { preg_number: 3 }, '10670'),
    ).resolves.not.toThrow();
  });
});

describe('upsertLabour', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('calls restUpdate keyed by an + audit (1:1 record per AN)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await upsertLabour(cfg, userInfo, 'AN1', { g: 3, ga: 39, anc_count: 8 }, '10670');
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt_labour/AN1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_labour',
      op: 'update',
      resourceId: 'AN1',
      hcode: '10670',
      fieldsTouched: ['g', 'ga', 'anc_count'],
    });
  });
});
