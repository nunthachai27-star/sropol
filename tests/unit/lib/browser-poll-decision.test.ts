// Unit tests for decideLaborPush — the pure decision the browser poll uses to
// choose whether to POST and what labor reconciliation to attach.
//
// Context (Mantis #9505): the browser must POST the authoritative active-AN set
// so the server can close out cached ACTIVE patients HOSxP no longer returns —
// INCLUDING the "ward just emptied" case (Occupied=0) where there is nothing to
// upsert. But it must NOT POST a redundant reconciliation on every 30s tick for
// a perpetually-empty ward (keeps the Sync Log clean). This helper encodes that
// edge-triggered decision so runBrowserPoll stays thin and the logic is tested.

import { describe, it, expect } from 'vitest';
import { decideLaborPush } from '@/lib/browser-poll';

const patient = (an: string) => ({
  hn: `H${an}`,
  an,
  name: 'x',
  cid: '0',
  age: 20,
  admit_date: '2026-01-01T00:00:00',
});

describe('decideLaborPush', () => {
  it('posts and attaches labor (patients + activeAns) when there are rows to upsert', () => {
    const d = decideLaborPush({
      laborPatients: [patient('A1')],
      laborActiveAns: ['A1'],
      hasPartograph: false,
      hasAnc: false,
      lastPushedActiveKey: null,
    });
    expect(d.skip).toBe(false);
    expect(d.labor).toEqual({ patients: [patient('A1')], mode: 'incremental', activeAns: ['A1'] });
  });

  it('skips the POST when there is nothing to upsert and the active set is unchanged', () => {
    const d = decideLaborPush({
      laborPatients: [],
      laborActiveAns: ['A2', 'A1'],
      hasPartograph: false,
      hasAnc: false,
      lastPushedActiveKey: 'A1\nA2',
    });
    expect(d.skip).toBe(true);
  });

  it('posts an empty-patients reconciliation when the ward just emptied', () => {
    const d = decideLaborPush({
      laborPatients: [],
      laborActiveAns: [],
      hasPartograph: false,
      hasAnc: false,
      lastPushedActiveKey: 'A1\nA2',
    });
    expect(d.skip).toBe(false);
    expect(d.labor).toEqual({ patients: [], mode: 'incremental', activeAns: [] });
  });

  it('posts a reconciliation when the active set shrinks but is not empty', () => {
    const d = decideLaborPush({
      laborPatients: [],
      laborActiveAns: ['A1'],
      hasPartograph: false,
      hasAnc: false,
      lastPushedActiveKey: 'A1\nA2',
    });
    expect(d.skip).toBe(false);
    expect(d.labor).toEqual({ patients: [], mode: 'incremental', activeAns: ['A1'] });
  });

  it('posts for partograph/anc but omits labor when labor is empty and unchanged', () => {
    const d = decideLaborPush({
      laborPatients: [],
      laborActiveAns: [],
      hasPartograph: true,
      hasAnc: false,
      lastPushedActiveKey: '',
    });
    expect(d.skip).toBe(false);
    expect(d.labor).toBeUndefined();
  });

  it('computes an order-independent active key', () => {
    const a = decideLaborPush({
      laborPatients: [],
      laborActiveAns: ['A2', 'A1'],
      hasPartograph: true,
      hasAnc: false,
      lastPushedActiveKey: null,
    });
    const b = decideLaborPush({
      laborPatients: [],
      laborActiveAns: ['A1', 'A2'],
      hasPartograph: true,
      hasAnc: false,
      lastPushedActiveKey: null,
    });
    expect(a.activeKey).toBe(b.activeKey);
  });
});
