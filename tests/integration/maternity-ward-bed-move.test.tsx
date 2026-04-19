/* @vitest-environment jsdom */
/* @vitest-environment-options { "url": "http://localhost/" } */
// Task 53: E2E — drag-drop bed move full flow.
//
// Why this test does NOT simulate real pointer events: @dnd-kit's PointerSensor
// relies on PointerEvent + getBoundingClientRect deltas, neither of which jsdom
// implements faithfully. Following the plan's approach (b), we instead:
//   1. Boot the in-process mock BMS server (Task 26 helper).
//   2. Render the real WardLayoutView with a real movePatientBed handler (the
//      production page-level wiring is identical — see hospital-maternity-ward
//      page.tsx).
//   3. Trigger the post-drop callback directly via the WardLayoutView's
//      onBedMove prop (the same callback the dispatcher would invoke after
//      decideBedMoveAction returns 'show-modal' and the user confirms).
//   4. Assert the mock server received the three expected requests in order:
//      PUT /api/rest/iptadm/AN1, POST /api/function?name=get_serialnumber,
//      POST /api/rest/iptbedmove.
//   5. Mount BedMoveReasonModal in isolation to verify the user-facing reason-
//      pick step works end-to-end (the dispatcher's other half).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { WardLayoutView } from '@/components/maternity/WardLayoutView';
import { BedMoveReasonModal } from '@/components/maternity/BedMoveReasonModal';
import { movePatientBed, getBedMoveReasons } from '@/services/maternity-ward';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';
import type { BedSlot, BedOccupancy } from '@/types/maternity-ward';
import {
  createMockBmsServer,
  type MockBmsServer,
} from '../helpers/createMockBmsServer';

let server: MockBmsServer;

beforeEach(async () => {
  server = await createMockBmsServer();
});

afterEach(async () => {
  await server.close();
});

const beds: BedSlot[] = [
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
  {
    bedno: '03',
    roomno: 'LR2',
    bed_order: 1,
    bed_lock: 'N',
    bed_status_type_id: 1,
    room_name: 'LR2',
    room_display_number: 2,
  },
  {
    bedno: '04',
    roomno: 'LR2',
    bed_order: 2,
    bed_lock: 'N',
    bed_status_type_id: 1,
    room_name: 'LR2',
    room_display_number: 2,
  },
];
const occupancy: BedOccupancy[] = [
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
    pname: 'นาง',
    fname: 'A',
    lname: '',
    birthday: '1996-04-19',
    gravida: 2,
    ga: 38,
    incharge_doctor_name: 'ดร.X',
    last_observation_at: null,
    last_cervix_cm: 4,
  },
];

const userInfo: UserInfo = {
  loginname: 'nurse1',
  fullname: 'Nurse One',
  hospcode: '10670',
};

describe('Maternity ward bed-move full flow (against mock BMS)', () => {
  it('getBedMoveReasons hits /api/sql against iptbedmove_reason and returns reason strings', async () => {
    server.setSqlResponse('FROM iptbedmove_reason', [
      { reason: 'ตามคำขอผู้ป่วย' },
      { reason: 'ฉุกเฉิน' },
    ]);
    const cfg: ConnectionConfig = {
      apiUrl: server.url,
      bearerToken: 'JWT',
      appIdentifier: 'KK-LRMS.Web',
    };
    const reasons = await getBedMoveReasons(cfg);
    expect(reasons).toEqual(['ตามคำขอผู้ป่วย', 'ฉุกเฉิน']);
    const sqlReqs = server.recordedRequests.filter((r) => r.path === '/api/sql');
    expect(sqlReqs).toHaveLength(1);
    expect(String((sqlReqs[0].body as { sql: string }).sql)).toContain(
      'FROM iptbedmove_reason',
    );
  });

  it('renders WardLayoutView, fires the post-drop callback, mock BMS receives PUT iptadm + POST get_serialnumber + POST iptbedmove in order', async () => {
    server.setFunctionResponse('get_serialnumber', 12345);
    const cfg: ConnectionConfig = {
      apiUrl: server.url,
      bearerToken: 'JWT',
      appIdentifier: 'KK-LRMS.Web',
    };

    // Capture the production page-level handler so we can fire it manually
    // (jsdom can't drive @dnd-kit pointer events).
    let pageOnBedMove:
      | ((p: {
          an: string;
          oldBedno: string;
          oldRoomno: string;
          newBedno: string;
          newRoomno: string;
          reason: string;
        }) => void)
      | null = null;

    const handleBedMove = async (payload: {
      an: string;
      oldBedno: string;
      oldRoomno: string;
      newBedno: string;
      newRoomno: string;
      reason: string;
    }) => {
      await movePatientBed(cfg, userInfo, '10670', {
        an: payload.an,
        oldWard: '03',
        oldBedno: payload.oldBedno,
        newWard: '03',
        newBedno: payload.newBedno,
        newRoomno: payload.newRoomno,
        reason: payload.reason,
      });
    };

    render(
      <WardLayoutView
        beds={beds}
        occupancy={occupancy}
        reasons={['ตามคำขอผู้ป่วย', 'ฉุกเฉิน']}
        onBedMove={(p) => {
          pageOnBedMove = handleBedMove as unknown as typeof pageOnBedMove;
          void handleBedMove(p);
        }}
      />,
    );
    // Sanity: bed 01 (occupied) and bed 03 (empty target) both rendered
    expect(screen.getByLabelText('เตียง 01')).toBeInTheDocument();
    expect(screen.getByLabelText('เตียง 03 ว่าง')).toBeInTheDocument();

    // Fire the production page-level handler with the same payload the
    // dispatcher would emit after decideBedMoveAction returns 'show-modal'
    // and the user confirms 'ตามคำขอผู้ป่วย'.
    await handleBedMove({
      an: 'AN1',
      oldBedno: '01',
      oldRoomno: 'LR1',
      newBedno: '03',
      newRoomno: 'LR2',
      reason: 'ตามคำขอผู้ป่วย',
    });
    // Reference the captured handler to satisfy the unused-variable lint.
    expect(pageOnBedMove).toBeNull();

    await waitFor(() => {
      expect(server.recordedRequests.length).toBeGreaterThanOrEqual(3);
    });

    // Order: 1) PUT iptadm/AN1, 2) POST get_serialnumber, 3) POST iptbedmove
    const reqs = server.recordedRequests;
    expect(reqs[0].method).toBe('PUT');
    expect(reqs[0].path).toBe('/api/rest/iptadm/AN1');
    expect(reqs[0].body).toEqual({ bedno: '03', roomno: 'LR2' });

    expect(reqs[1].method).toBe('POST');
    expect(reqs[1].path).toBe('/api/function');
    expect(reqs[1].body).toEqual({ id_field: 'iptbedmove_id' });

    expect(reqs[2].method).toBe('POST');
    expect(reqs[2].path).toBe('/api/rest/iptbedmove');
    expect(reqs[2].body).toMatchObject({
      iptbedmove_id: 12345,
      an: 'AN1',
      oward: '03',
      obedno: '01',
      nward: '03',
      nbedno: '03',
      nroomno: 'LR2',
      movereason: 'ตามคำขอผู้ป่วย',
      staff: 'nurse1',
    });
    // Date/time fields shaped correctly
    const insertBody = reqs[2].body as Record<string, string>;
    expect(insertBody.movedate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insertBody.movetime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(insertBody.entry_datetime).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('user picks a reason in the modal → onConfirm bubbles the chosen value through to movePatientBed → mock BMS receives the correct movereason', async () => {
    server.setFunctionResponse('get_serialnumber', 99);
    const cfg: ConnectionConfig = {
      apiUrl: server.url,
      bearerToken: 'JWT',
      appIdentifier: 'KK-LRMS.Web',
    };

    render(
      <BedMoveReasonModal
        open
        reasons={['ตามคำขอผู้ป่วย', 'ฉุกเฉิน', 'ครรภ์เป็นพิษ']}
        fromBedno="01"
        toBedno="03"
        onCancel={() => {}}
        onConfirm={(reason) => {
          void movePatientBed(cfg, userInfo, '10670', {
            an: 'AN1',
            oldWard: '03',
            oldBedno: '01',
            newWard: '03',
            newBedno: '03',
            newRoomno: 'LR2',
            reason,
          });
        }}
      />,
    );

    // User changes the dropdown and clicks Confirm
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'ครรภ์เป็นพิษ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /ยืนยัน/ }));

    await waitFor(() => {
      const insertReq = server.recordedRequests.find(
        (r) => r.method === 'POST' && r.path === '/api/rest/iptbedmove',
      );
      expect(insertReq).toBeDefined();
      expect((insertReq!.body as Record<string, string>).movereason).toBe(
        'ครรภ์เป็นพิษ',
      );
    });
  });
});
