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
  upsertLabor,
  upsertLabourMedication,
  deleteLabourMedication,
  upsertStageMedication,
  deleteStageMedication,
  upsertComplication,
  deleteComplication,
  upsertNewborn,
  upsertLabourInfant,
  deleteInfant,
  dischargePatient,
  movePatientBed,
  getBedMoveReasons,
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
    // BMS requires typed params; executeSql wraps string '03' → {value, value_type}
    expect(body.params).toEqual({ ward: { value: '03', value_type: 'string' } });
    expect(body.sql).toContain('FROM bedno');
    expect(body.sql).toContain(':ward');
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
    expect(body.params).toEqual({ ward: { value: '03', value_type: 'string' } });
    expect(body.sql).toContain("i.confirm_discharge = 'N'");
    expect(body.sql).toContain(':ward');
  });
});

describe('upsertPartograph', () => {
  beforeEach(() => mockFetch.mockReset());

  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial via callFunction then restInsert + audit', async () => {
    // 0) getPatientLabour SELECT → resolves the ipt_labour_id FK. The insert
    //    path resolves it via a SQL SELECT when the caller omits row.ipt_labour_id
    //    (the Add dialog only carries clinical fields, not the labour PK).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [{ ipt_labour_id: 5 }], MessageCode: 200, Message: 'ok' }),
    });
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

    // Verify call sequence: SELECT labour → mint serial → insert → audit.
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/sql');
    expect(mockFetch.mock.calls[1][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[2][0]).toBe('https://t.example/api/api/rest/ipt_labour_partograph');
    expect(mockFetch.mock.calls[2][1].method).toBe('POST');
    const insertBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(insertBody).toMatchObject({
      ipt_labour_partograph_id: 99,
      ipt_labour_id: 5, // resolved from the getPatientLabour SELECT
      an: 'AN1',
      cervical_dilation_cm: 4,
    });

    // Audit call (fire-and-forget — let microtask queue drain)
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch.mock.calls[3][0]).toBe('/api/hospital/audit-log');
    const auditBody = JSON.parse(mockFetch.mock.calls[3][1].body);
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
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://t.example/api/api/rest/ipt_labour_partograph/7',
    );
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
    expect(mockFetch.mock.calls[1][0]).toBe(
      'https://t.example/api/api/rest/ipt_pregnancy_vital_sign',
    );
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

    // BMS REST keys ipt_labour by its surrogate PK (ipt_labour_id), not by AN.
    // Caller forwards the PK from the read-side getPatientLabour result.
    await upsertLabour(
      cfg,
      userInfo,
      'AN1',
      { ipt_labour_id: 42, g: 3, ga: 39, anc_count: 8 },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt_labour/42');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt_labour',
      op: 'update',
      resourceId: '42',
      hcode: '10670',
      fieldsTouched: ['g', 'ga', 'anc_count'],
    });
  });
});

// ─── Task 44: legacy `labor` table upsert ──────────────────────────────────
describe('upsertLabor', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('calls restUpdate keyed by an + audit', async () => {
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

    // BMS REST keys labor by laborid (int), not AN.
    await upsertLabor(
      cfg,
      userInfo,
      'AN1',
      { laborid: 7, mother_gvalue: 3, mother_hct: 36, mother_aging: 28 },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/labor/7');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(auditBody).toMatchObject({
      entity: 'labor',
      op: 'update',
      resourceId: '7',
      hcode: '10670',
      fieldsTouched: ['mother_gvalue', 'mother_hct', 'mother_aging'],
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
      upsertLabor(cfg, userInfo, 'AN1', { laborid: 7, mother_gvalue: 3 }, '10670'),
    ).resolves.not.toThrow();
  });
});

// ─── Task 45: labour_medication CRUD ───────────────────────────────────────
describe('upsertLabourMedication', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial then restInsert + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 33 }),
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

    const r = await upsertLabourMedication(
      cfg,
      userInfo,
      'AN1',
      { icode: 'D0001', qty: 2, drugusage: '1x3' },
      '10670',
    );
    expect(r.labour_medication_id).toBe(33);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[1][0]).toBe('https://t.example/api/api/rest/labour_medication');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      labour_medication_id: 33,
      an: 'AN1',
      icode: 'D0001',
      qty: 2,
    });
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(auditBody).toMatchObject({
      entity: 'labour_medication',
      op: 'insert',
      resourceId: '33',
      hcode: '10670',
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
    await upsertLabourMedication(
      cfg,
      userInfo,
      'AN1',
      { labour_medication_id: 9, qty: 5 },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/labour_medication/9');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ qty: 5 });
  });

  it('does not throw if audit fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      upsertLabourMedication(cfg, userInfo, 'AN1', { labour_medication_id: 1, qty: 2 }, '10670'),
    ).resolves.toBeDefined();
  });
});

describe('deleteLabourMedication', () => {
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
    await deleteLabourMedication(cfg, userInfo, 33, '10670');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rest/labour_medication/33');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({ entity: 'labour_medication', op: 'delete', resourceId: '33' });
  });
});

// ─── Task 46: labour_stage_medication CRUD ──────────────────────────────────
describe('upsertStageMedication', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial then restInsert + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 71 }),
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

    const r = await upsertStageMedication(
      cfg,
      userInfo,
      'AN1',
      { icode: 'D0007', qty: 1, medication_date: '2026-04-19', medication_time: '10:00:00' },
      '10670',
    );
    expect(r.labour_stage_medication_id).toBe(71);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[1][0]).toBe(
      'https://t.example/api/api/rest/labour_stage_medication',
    );
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      labour_stage_medication_id: 71,
      an: 'AN1',
      icode: 'D0007',
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
    await upsertStageMedication(
      cfg,
      userInfo,
      'AN1',
      { labour_stage_medication_id: 12, qty: 2 },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://t.example/api/api/rest/labour_stage_medication/12',
    );
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ qty: 2 });
  });

  it('does not throw if audit fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      upsertStageMedication(
        cfg,
        userInfo,
        'AN1',
        { labour_stage_medication_id: 1, qty: 1 },
        '10670',
      ),
    ).resolves.toBeDefined();
  });
});

describe('deleteStageMedication', () => {
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
    await deleteStageMedication(cfg, userInfo, 71, '10670');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rest/labour_stage_medication/71');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      entity: 'labour_stage_medication',
      op: 'delete',
      resourceId: '71',
    });
  });
});

// ─── Task 47: ipt_labour_complication CRUD (keyed by ipt_labour_id) ────────
describe('upsertComplication', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial then restInsert with ipt_labour_id + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 88 }),
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

    const r = await upsertComplication(
      cfg,
      userInfo,
      99,
      { labour_complication_id: 5, complication_note: 'PPH' },
      '10670',
    );
    expect(r.ipt_labour_complication_id).toBe(88);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[1][0]).toBe(
      'https://t.example/api/api/rest/ipt_labour_complication',
    );
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      ipt_labour_complication_id: 88,
      ipt_labour_id: 99,
      labour_complication_id: 5,
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
    await upsertComplication(
      cfg,
      userInfo,
      99,
      { ipt_labour_complication_id: 4, complication_note: 'updated' },
      '10670',
    );
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://t.example/api/api/rest/ipt_labour_complication/4',
    );
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ complication_note: 'updated' });
  });

  it('does not throw if audit fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      upsertComplication(
        cfg,
        userInfo,
        99,
        { ipt_labour_complication_id: 1, complication_note: 'x' },
        '10670',
      ),
    ).resolves.toBeDefined();
  });
});

describe('deleteComplication', () => {
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
    await deleteComplication(cfg, userInfo, 88, '10670');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rest/ipt_labour_complication/88');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      entity: 'ipt_labour_complication',
      op: 'delete',
      resourceId: '88',
    });
  });
});

// ─── Task 48: ipt_newborn + ipt_labour_infant CRUD ─────────────────────────
describe('upsertNewborn', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial then restInsert + audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 200 }),
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

    const r = await upsertNewborn(cfg, userInfo, 'AN1', { sex: 'M', birth_weight: 3200 }, '10670');
    expect(r.ipt_newborn_id).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/function?name=get_serialnumber');
    expect(mockFetch.mock.calls[1][0]).toBe('https://t.example/api/api/rest/ipt_newborn');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toMatchObject({ ipt_newborn_id: 200, an: 'AN1', sex: 'M' });
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
    await upsertNewborn(cfg, userInfo, 'AN1', { ipt_newborn_id: 11, sex: 'F' }, '10670');
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt_newborn/11');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
  });
});

describe('upsertLabourInfant', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('insert: mints serial + restInsert + audit', async () => {
    // getPatientLabour SELECT → resolves the ipt_labour_id FK (NOT NULL on
    // ipt_labour_infant). The insert path resolves it when the caller omits
    // row.ipt_labour_id — same shape as upsertPartograph.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({ data: [{ ipt_labour_id: 5 }], MessageCode: 200, Message: 'ok' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 300 }),
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
    const r = await upsertLabourInfant(
      cfg,
      userInfo,
      'AN1',
      { sex: 'M', birth_weight: 3200 },
      '10670',
    );
    expect(r.ipt_labour_infant_id).toBe(300);
    // SELECT labour (calls[0]) → mint (calls[1]) → restInsert (calls[2]).
    expect(mockFetch.mock.calls[2][0]).toBe('https://t.example/api/api/rest/ipt_labour_infant');
    const insertBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(insertBody).toMatchObject({
      ipt_labour_infant_id: 300,
      ipt_labour_id: 5, // resolved from the getPatientLabour SELECT
      an: 'AN1',
      sex: 'M',
    });
  });

  it('update: skips serial mint, calls restUpdate', async () => {
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
    await upsertLabourInfant(cfg, userInfo, 'AN1', { ipt_labour_infant_id: 22, sex: 'F' }, '10670');
    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt_labour_infant/22');
  });
});

describe('deleteInfant', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('deletes both ipt_newborn and ipt_labour_infant rows + fires audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok' }),
    });
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
    await deleteInfant(cfg, userInfo, 11, 22, '10670');
    // First call: delete the labour_infant child
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rest/ipt_labour_infant/22');
    // Second call: delete the newborn parent
    expect(mockFetch.mock.calls[1][0]).toContain('/api/rest/ipt_newborn/11');
    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(body).toMatchObject({
      entity: 'ipt_newborn',
      op: 'delete',
      resourceId: '11',
    });
  });
});

// ─── Task 50: dischargePatient (composite write to ipt + iptadm) ───────────
describe('dischargePatient', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('updates ipt + iptadm sequentially and fires audit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
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

    await dischargePatient(cfg, userInfo, '10670', {
      an: 'AN1',
      dchdate: '2026-04-19',
      dchtime: '14:30:00',
      dchtype: '1',
      dchstts: '1',
    });

    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/ipt/AN1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const iptBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // confirm_discharge is now caller-controlled — service writes it only
    // when DischargeArgs.confirm_discharge is explicitly 'Y' or 'N'. This
    // test omits the field, so it should NOT appear in the body. The tab
    // owns the toggle.
    expect(iptBody).toEqual({
      dchdate: '2026-04-19',
      dchtime: '14:30:00',
      dchtype: '1',
      dchstts: '1',
    });
    expect(mockFetch.mock.calls[1][0]).toBe('https://t.example/api/api/rest/iptadm/AN1');
    const admBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(admBody).toEqual({ outdate: '2026-04-19', outtime: '14:30:00' });
    await new Promise((r) => setTimeout(r, 0));
    const auditBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(auditBody).toMatchObject({
      entity: 'ipt',
      op: 'discharge',
      resourceId: 'AN1',
      hcode: '10670',
    });
  });

  it('throws if ipt update fails (does not write iptadm)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      clone: function () {
        return this;
      },
      json: async () => ({ Message: 'boom' }),
      text: async () => 'boom',
    });
    await expect(
      dischargePatient(cfg, userInfo, '10670', {
        an: 'AN1',
        dchdate: '2026-04-19',
        dchtime: '14:30:00',
        dchtype: '1',
        dchstts: '1',
      }),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not throw if audit fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockRejectedValueOnce(new Error('audit endpoint down'));
    await expect(
      dischargePatient(cfg, userInfo, '10670', {
        an: 'AN1',
        dchdate: '2026-04-19',
        dchtime: '14:30:00',
        dchtype: '1',
        dchstts: '1',
      }),
    ).resolves.not.toThrow();
  });
});

// ─── Task 51: movePatientBed (composite write to iptadm + iptbedmove) ──────
describe('getBedMoveReasons', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns the reason string array from BMS /api/sql', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: function () {
        return this;
      },
      json: async () => ({
        data: [{ reason: 'ตามคำขอ' }, { reason: 'ฉุกเฉิน' }],
        MessageCode: 200,
        Message: 'ok',
      }),
    });
    const reasons = await getBedMoveReasons(cfg);
    expect(reasons).toEqual(['ตามคำขอ', 'ฉุกเฉิน']);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sql).toContain('FROM iptbedmove_reason');
  });
});

describe('movePatientBed', () => {
  beforeEach(() => mockFetch.mockReset());
  const userInfo: UserInfo = { loginname: 'nurse1', fullname: 'Nurse', hospcode: '10670' };

  it('calls restUpdate(iptadm, an, {bedno, roomno}) first', async () => {
    // 1) restUpdate ipt adm → ok
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    // 2) callFunction get_serialnumber → 77
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 77 }),
    });
    // 3) restInsert iptbedmove → ok
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', insert_count: 1 }),
    });
    // 4) audit POST → ok
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await movePatientBed(cfg, userInfo, '10670', {
      an: 'AN1',
      oldWard: '03',
      oldBedno: '01',
      newWard: '03',
      newBedno: '05',
      newRoomno: 'LR2',
      reason: 'ตามคำขอ',
    });

    expect(mockFetch.mock.calls[0][0]).toBe('https://t.example/api/api/rest/iptadm/AN1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    const admBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(admBody).toEqual({ bedno: '05', roomno: 'LR2' });
  });

  it('calls callFunction(get_serialnumber, iptbedmove_id) second', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 77 }),
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

    await movePatientBed(cfg, userInfo, '10670', {
      an: 'AN1',
      oldWard: '03',
      oldBedno: '01',
      newWard: '03',
      newBedno: '05',
      newRoomno: 'LR2',
      reason: 'ตามคำขอ',
    });

    expect(mockFetch.mock.calls[1][0]).toContain('/api/function?name=get_serialnumber');
    const fnBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    // get_serialnumber requires serial_name + table_name + field_name (verified live)
    expect(fnBody).toEqual({
      serial_name: 'iptbedmove_id',
      table_name: 'iptbedmove',
      field_name: 'iptbedmove_id',
    });
  });

  it('calls restInsert(iptbedmove, {...}) third with all expected fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 77 }),
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

    await movePatientBed(cfg, userInfo, '10670', {
      an: 'AN1',
      oldWard: '03',
      oldBedno: '01',
      newWard: '03',
      newBedno: '05',
      newRoomno: 'LR2',
      reason: 'ตามคำขอ',
    });

    expect(mockFetch.mock.calls[2][0]).toBe('https://t.example/api/api/rest/iptbedmove');
    expect(mockFetch.mock.calls[2][1].method).toBe('POST');
    const insertBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(insertBody).toMatchObject({
      iptbedmove_id: 77,
      an: 'AN1',
      oward: '03',
      obedno: '01',
      nward: '03',
      nbedno: '05',
      nroomno: 'LR2',
      movereason: 'ตามคำขอ',
      staff: 'nurse1',
    });
    // Date/time fields are present and shaped like YYYY-MM-DD / HH:mm:ss
    expect(insertBody.movedate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insertBody.movetime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(insertBody.entry_datetime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('fires audit POST after the inserts succeed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', update_count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageCode: 200, Message: 'ok', Value: 77 }),
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

    await movePatientBed(cfg, userInfo, '10670', {
      an: 'AN1',
      oldWard: '03',
      oldBedno: '01',
      newWard: '03',
      newBedno: '05',
      newRoomno: 'LR2',
      reason: 'ตามคำขอ',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch.mock.calls[3][0]).toBe('/api/hospital/audit-log');
    const auditBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(auditBody).toMatchObject({
      entity: 'iptadm',
      op: 'bed_move',
      resourceId: 'AN1',
      hcode: '10670',
      staff: 'nurse1',
      fieldsTouched: ['bedno', 'roomno'],
    });
  });
});
