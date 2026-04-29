// Dev-only smoke endpoint: read → no-op UPDATE → read-back per maternity tab.
// Verifies that each tab's update path resolves to the correct REST URL and
// the BMS round-trip actually succeeds against a live tunnel.
//
// Two probe layers:
//   1. REST probes — direct restUpdate to /api/rest/{table}/{pk}. Validates
//      the BMS endpoint accepts the pk + body shape we plan to send.
//   2. SERVICE probes — calls the actual upsert*() service functions the
//      tabs invoke (upsertLabour, upsertLabor, upsertPregnancy, etc.) with
//      the same fields shape each tab builds. This is the layer that catches
//      caller mistakes like "tab forgot to forward fields.ipt_labour_id" —
//      the bug PreLabourTab shipped with even after StageTab was fixed.
//
// Usage:
//   curl -s -X POST http://localhost:3000/api/dev/smoke-tab-update \
//     -H "Content-Type: application/json" \
//     -d '{"sessionId":"<bms-session-id>","an":"<optional AN>"}'
//
// Each probe runs its own try/catch — a failure in one tab doesn't abort
// the others, so the response surfaces the FULL set of pass/fail results.
//
// Gated on DEV_AUTH_BYPASS=true so this route is unreachable in production.
import { NextRequest, NextResponse } from 'next/server';
import { validateBmsSession } from '@/lib/auth-utils';
import { executeSql, restUpdate } from '@/lib/bms-browser-client';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';
import {
  getPatientLabour,
  getPatientLabor,
  getPatientPregnancy,
  getPatientPartograph,
  getPatientNurseNotes,
  getPatientLabourMedications,
  getPatientStageMedications,
  getPatientInfants,
  getPatientComplications,
  upsertLabour,
  upsertLabor,
  upsertPregnancy,
  upsertPartograph,
  upsertNurseNote,
  upsertLabourMedication,
  upsertStageMedication,
  upsertComplication,
  upsertLabourInfant,
} from '@/services/maternity-ward';

interface ProbeResult {
  table: string;
  status: 'ok' | 'no-data' | 'error';
  pkColumn: string;
  pkValue?: string | number;
  url?: string;
  message?: string;
}

interface ProbeSpec {
  table: string;
  pkColumn: string;
  // SQL to find one candidate row. Either select by AN, or pick newest.
  selectSql: (an?: string) => string;
  // Field on the row to read & write back unchanged. NULL is replaced with
  // an empty string for safety so we never wipe a previously-set field.
  noopField: string;
}

const PROBES: ProbeSpec[] = [
  {
    table: 'ipt_labour',
    pkColumn: 'ipt_labour_id',
    selectSql: (an) =>
      an
        ? `SELECT ipt_labour_id, an, anc_count FROM ipt_labour WHERE an = '${an}' LIMIT 1`
        : `SELECT ipt_labour_id, an, anc_count FROM ipt_labour ORDER BY ipt_labour_id DESC LIMIT 1`,
    noopField: 'anc_count',
  },
  {
    table: 'labor',
    pkColumn: 'laborid',
    selectSql: (an) =>
      an
        ? `SELECT laborid, an, mother_aging FROM labor WHERE an = '${an}' LIMIT 1`
        : `SELECT laborid, an, mother_aging FROM labor ORDER BY laborid DESC LIMIT 1`,
    noopField: 'mother_aging',
  },
  {
    table: 'ipt_pregnancy',
    pkColumn: 'an',
    selectSql: (an) =>
      an
        ? `SELECT an, ga FROM ipt_pregnancy WHERE an = '${an}' LIMIT 1`
        : `SELECT an, ga FROM ipt_pregnancy ORDER BY an DESC LIMIT 1`,
    noopField: 'ga',
  },
  {
    table: 'ipt_labour_partograph',
    pkColumn: 'ipt_labour_partograph_id',
    selectSql: (an) =>
      an
        ? `SELECT ipt_labour_partograph_id, an, hour_no FROM ipt_labour_partograph WHERE an = '${an}' ORDER BY ipt_labour_partograph_id DESC LIMIT 1`
        : `SELECT ipt_labour_partograph_id, an, hour_no FROM ipt_labour_partograph ORDER BY ipt_labour_partograph_id DESC LIMIT 1`,
    noopField: 'hour_no',
  },
  {
    table: 'labour_medication',
    pkColumn: 'labour_medication_id',
    selectSql: (an) =>
      an
        ? `SELECT labour_medication_id, an, qty FROM labour_medication WHERE an = '${an}' LIMIT 1`
        : `SELECT labour_medication_id, an, qty FROM labour_medication ORDER BY labour_medication_id DESC LIMIT 1`,
    noopField: 'qty',
  },
  {
    table: 'labour_stage_medication',
    pkColumn: 'labour_stage_medication_id',
    selectSql: (an) =>
      an
        ? `SELECT labour_stage_medication_id, an, qty FROM labour_stage_medication WHERE an = '${an}' LIMIT 1`
        : `SELECT labour_stage_medication_id, an, qty FROM labour_stage_medication ORDER BY labour_stage_medication_id DESC LIMIT 1`,
    noopField: 'qty',
  },
  {
    table: 'ipt_labour_complication',
    pkColumn: 'ipt_labour_complication_id',
    selectSql: () =>
      `SELECT ipt_labour_complication_id, ipt_labour_id, complication_note FROM ipt_labour_complication ORDER BY ipt_labour_complication_id DESC LIMIT 1`,
    noopField: 'complication_note',
  },
  {
    table: 'ipt_labour_infant',
    pkColumn: 'ipt_labour_infant_id',
    selectSql: () =>
      `SELECT ipt_labour_infant_id, ipt_labour_id, birth_weight FROM ipt_labour_infant ORDER BY ipt_labour_infant_id DESC LIMIT 1`,
    noopField: 'birth_weight',
  },
];

async function probeOne(
  spec: ProbeSpec,
  config: ConnectionConfig,
  marketplaceToken: string,
  an: string | undefined,
): Promise<ProbeResult> {
  try {
    const sql = spec.selectSql(an);
    const r = await executeSql<Record<string, unknown>>(sql, config, undefined, marketplaceToken);
    if (!r.data || r.data.length === 0) {
      return { table: spec.table, pkColumn: spec.pkColumn, status: 'no-data' };
    }
    const row = r.data[0]!;
    const pk = row[spec.pkColumn];
    if (pk === null || pk === undefined) {
      return {
        table: spec.table,
        pkColumn: spec.pkColumn,
        status: 'error',
        message: `row missing PK column ${spec.pkColumn}`,
      };
    }
    const noopValue = row[spec.noopField] ?? null;
    const url = `${config.apiUrl}/api/rest/${spec.table}/${pk}`;
    // Write back the same value — verifies the URL resolves AND the body shape
    // is accepted, without mutating real clinical data.
    await restUpdate(
      spec.table,
      String(pk),
      { [spec.noopField]: noopValue },
      config,
      marketplaceToken,
    );
    return {
      table: spec.table,
      pkColumn: spec.pkColumn,
      status: 'ok',
      pkValue: pk as string | number,
      url,
      message: `noop UPDATE ${spec.noopField}=${JSON.stringify(noopValue)} succeeded`,
    };
  } catch (e) {
    return {
      table: spec.table,
      pkColumn: spec.pkColumn,
      status: 'error',
      message: (e as Error).message,
    };
  }
}

export async function POST(request: NextRequest) {
  if (process.env.DEV_AUTH_BYPASS !== 'true' && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'disabled in production' }, { status: 403 });
  }
  let body: { sessionId?: string; an?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const sessionId = body.sessionId;
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const tunnelUrl = process.env.DEV_HOSPITAL_TUNNEL_URL ?? '';
  const identity = await validateBmsSession(sessionId, tunnelUrl);
  if (!identity || !identity.tunnelUrl || !identity.jwt) {
    return NextResponse.json(
      { error: 'session validation failed', sessionId },
      { status: 401 },
    );
  }

  // BMS tunnel auth split (matches extractConnectionConfig in bms-browser-client):
  //   * bearerToken = the session ID itself (bms_session_code)
  //   * marketplace-token = auth_key from PasteJSON
  // identity.jwt holds the auth_key — pass it as the marketplaceToken arg.
  const config: ConnectionConfig = {
    apiUrl: identity.tunnelUrl,
    bearerToken: sessionId,
    appIdentifier: 'KK-LRMS.SmokeTest',
  };

  // Set the marketplace-token in the module singleton so service helpers
  // (executeSql / restUpdate inside upsert*) pick it up automatically.
  // Restored after the smoke completes.
  const { setActiveMarketplaceToken } = await import('@/lib/bms-browser-client');
  setActiveMarketplaceToken(identity.jwt);

  const restResults: ProbeResult[] = [];
  for (const spec of PROBES) {
    // sequential — keeps log output ordered + avoids hammering the tunnel
    // eslint-disable-next-line no-await-in-loop
    restResults.push(await probeOne(spec, config, identity.jwt, body.an));
  }

  const serviceResults = await runServiceProbes(config, identity, body.an);

  setActiveMarketplaceToken(null);

  const all = [...restResults, ...serviceResults];
  const ok = all.filter((r) => r.status === 'ok').length;
  const errors = all.filter((r) => r.status === 'error').length;
  const noData = all.filter((r) => r.status === 'no-data').length;

  return NextResponse.json({
    summary: { total: all.length, ok, errors, noData },
    hospital: identity.hospitalCode,
    tunnel: identity.tunnelUrl,
    an: body.an ?? '(latest row per table)',
    rest: restResults,
    services: serviceResults,
  });
}

// ─── Service-flow probes ──────────────────────────────────────────────────
// Calls each upsert*() service function with the SAME payload shape its tab
// builds. Catches caller mistakes that bypass restUpdate (e.g. forgetting to
// forward the surrogate PK) — the kind of bug PreLabourTab shipped with.

async function pickAn(
  config: ConnectionConfig,
  marketplaceToken: string,
  preferred: string | undefined,
): Promise<string | null> {
  if (preferred) return preferred;
  // Find a recent AN that has both ipt_pregnancy and ipt_labour rows so the
  // pre-labour + stage probes both have something to update.
  const r = await executeSql<{ an: string }>(
    `SELECT p.an FROM ipt_pregnancy p
       JOIN ipt_labour l ON l.an = p.an
       ORDER BY l.ipt_labour_id DESC LIMIT 1`,
    config,
    undefined,
    marketplaceToken,
  );
  return r.data?.[0]?.an ?? null;
}

async function runServiceProbes(
  config: ConnectionConfig,
  identity: { hospitalCode: string },
  preferredAn: string | undefined,
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  // We don't have a real BMS session UserInfo here, but every audit call
  // only reads loginname, so a stub is fine for a smoke test.
  const userInfo: UserInfo = {
    loginname: 'smoke-test',
    fullname: 'Smoke Test',
    hospcode: identity.hospitalCode,
  };
  const hcode = identity.hospitalCode;

  const an = await pickAn(config, '', preferredAn).catch(() => null);
  if (!an) {
    out.push({
      table: '(service)',
      pkColumn: '-',
      status: 'no-data',
      message: 'no AN with both ipt_pregnancy + ipt_labour rows',
    });
    return out;
  }

  // 1. PreLabourTab → upsertPregnancy + upsertLabour with ipt_labour_id
  try {
    const preg = await getPatientPregnancy(config, an);
    const labour = await getPatientLabour(config, an);
    if (preg) {
      await upsertPregnancy(
        config,
        userInfo,
        an,
        { preg_number: preg.preg_number ?? null },
        hcode,
        true,
      );
    }
    if (labour) {
      await upsertLabour(
        config,
        userInfo,
        an,
        { ipt_labour_id: labour.ipt_labour_id, anc_count: labour.anc_count ?? null },
        hcode,
        true,
      );
    }
    out.push({
      table: 'PreLabourTab → upsertPregnancy + upsertLabour',
      pkColumn: 'ipt_labour_id',
      status: 'ok',
      pkValue: labour?.ipt_labour_id,
      message: `an=${an} pregnancy=${preg ? 'yes' : 'no'} labour=${labour ? 'yes' : 'no'}`,
    });
  } catch (e) {
    out.push({
      table: 'PreLabourTab → upsertPregnancy + upsertLabour',
      pkColumn: 'ipt_labour_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 2. StageTab → upsertLabour + upsertLabor (both surrogate PKs forwarded)
  try {
    const labour = await getPatientLabour(config, an);
    const labor = await getPatientLabor(config, an);
    if (labour) {
      await upsertLabour(
        config,
        userInfo,
        an,
        { ipt_labour_id: labour.ipt_labour_id, g: labour.g ?? null },
        hcode,
        true,
      );
    }
    if (labor) {
      await upsertLabor(
        config,
        userInfo,
        an,
        { laborid: labor.laborid, mother_aging: labor.mother_aging ?? null },
        hcode,
        true,
      );
    }
    out.push({
      table: 'StageTab → upsertLabour + upsertLabor',
      pkColumn: 'ipt_labour_id+laborid',
      status: 'ok',
      message: `an=${an} labour=${labour ? 'yes' : 'no'} labor=${labor ? 'yes' : 'no'}`,
    });
  } catch (e) {
    out.push({
      table: 'StageTab → upsertLabour + upsertLabor',
      pkColumn: 'ipt_labour_id+laborid',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 3. PartographTab → upsertPartograph (surrogate PK in row)
  try {
    const rows = await getPatientPartograph(config, an);
    const row = rows[0];
    if (!row) {
      out.push({
        table: 'PartographTab → upsertPartograph',
        pkColumn: 'ipt_labour_partograph_id',
        status: 'no-data',
        message: `no partograph rows for an=${an}`,
      });
    } else {
      await upsertPartograph(
        config,
        userInfo,
        an,
        { ipt_labour_partograph_id: row.ipt_labour_partograph_id, hour_no: row.hour_no ?? null },
        hcode,
      );
      out.push({
        table: 'PartographTab → upsertPartograph',
        pkColumn: 'ipt_labour_partograph_id',
        status: 'ok',
        pkValue: row.ipt_labour_partograph_id,
      });
    }
  } catch (e) {
    out.push({
      table: 'PartographTab → upsertPartograph',
      pkColumn: 'ipt_labour_partograph_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 4. VitalsTab → upsertNurseNote (ipd_nurse_note — what the tab actually uses)
  try {
    const rows = await getPatientNurseNotes(config, an);
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      out.push({
        table: 'VitalsTab → upsertNurseNote',
        pkColumn: 'nurse_note_id',
        status: 'no-data',
        message: `no nurse-note rows for an=${an}`,
      });
    } else {
      await upsertNurseNote(
        config,
        userInfo,
        an,
        {
          nurse_note_id: row.nurse_note_id as number | undefined,
          bps: (row.bps as number | null | undefined) ?? null,
        },
        hcode,
      );
      out.push({
        table: 'VitalsTab → upsertNurseNote',
        pkColumn: 'nurse_note_id',
        status: 'ok',
        pkValue: row.nurse_note_id as number | undefined,
      });
    }
  } catch (e) {
    out.push({
      table: 'VitalsTab → upsertNurseNote',
      pkColumn: 'nurse_note_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 5. MedicationsTab → upsertLabourMedication
  try {
    const rows = await getPatientLabourMedications(config, an);
    const row = rows[0];
    if (!row) {
      out.push({
        table: 'MedicationsTab → upsertLabourMedication',
        pkColumn: 'labour_medication_id',
        status: 'no-data',
      });
    } else {
      await upsertLabourMedication(
        config,
        userInfo,
        an,
        {
          labour_medication_id: row.labour_medication_id,
          icode: row.icode,
          qty: row.qty ?? null,
          drugusage: row.drugusage ?? null,
        },
        hcode,
      );
      out.push({
        table: 'MedicationsTab → upsertLabourMedication',
        pkColumn: 'labour_medication_id',
        status: 'ok',
        pkValue: row.labour_medication_id,
      });
    }
  } catch (e) {
    out.push({
      table: 'MedicationsTab → upsertLabourMedication',
      pkColumn: 'labour_medication_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 6. StageMedTab → upsertStageMedication
  try {
    const rows = await getPatientStageMedications(config, an);
    const row = rows[0];
    if (!row) {
      out.push({
        table: 'StageMedTab → upsertStageMedication',
        pkColumn: 'labour_stage_medication_id',
        status: 'no-data',
      });
    } else {
      await upsertStageMedication(
        config,
        userInfo,
        an,
        {
          labour_stage_medication_id: row.labour_stage_medication_id,
          icode: row.icode,
          qty: row.qty ?? null,
        },
        hcode,
      );
      out.push({
        table: 'StageMedTab → upsertStageMedication',
        pkColumn: 'labour_stage_medication_id',
        status: 'ok',
        pkValue: row.labour_stage_medication_id,
      });
    }
  } catch (e) {
    out.push({
      table: 'StageMedTab → upsertStageMedication',
      pkColumn: 'labour_stage_medication_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 7. ComplicationsTab → upsertComplication (keyed by ipt_labour_id parent)
  try {
    const labour = await getPatientLabour(config, an);
    if (!labour) {
      out.push({
        table: 'ComplicationsTab → upsertComplication',
        pkColumn: 'ipt_labour_complication_id',
        status: 'no-data',
        message: 'no parent ipt_labour row',
      });
    } else {
      const rows = await getPatientComplications(config, labour.ipt_labour_id);
      const row = rows[0];
      if (!row) {
        out.push({
          table: 'ComplicationsTab → upsertComplication',
          pkColumn: 'ipt_labour_complication_id',
          status: 'no-data',
        });
      } else {
        await upsertComplication(
          config,
          userInfo,
          labour.ipt_labour_id,
          {
            ipt_labour_complication_id: row.ipt_labour_complication_id,
            labour_complication_id: row.labour_complication_id,
            complication_note: row.complication_note ?? null,
          },
          hcode,
        );
        out.push({
          table: 'ComplicationsTab → upsertComplication',
          pkColumn: 'ipt_labour_complication_id',
          status: 'ok',
          pkValue: row.ipt_labour_complication_id,
        });
      }
    }
  } catch (e) {
    out.push({
      table: 'ComplicationsTab → upsertComplication',
      pkColumn: 'ipt_labour_complication_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  // 8. InfantTab → upsertLabourInfant
  try {
    const rows = await getPatientInfants(config, an);
    const row = rows[0];
    if (!row) {
      out.push({
        table: 'InfantTab → upsertLabourInfant',
        pkColumn: 'ipt_labour_infant_id',
        status: 'no-data',
      });
    } else {
      await upsertLabourInfant(
        config,
        userInfo,
        an,
        {
          ipt_labour_infant_id: row.ipt_labour_infant_id,
          birth_weight: row.birth_weight ?? null,
        },
        hcode,
      );
      out.push({
        table: 'InfantTab → upsertLabourInfant',
        pkColumn: 'ipt_labour_infant_id',
        status: 'ok',
        pkValue: row.ipt_labour_infant_id,
      });
    }
  } catch (e) {
    out.push({
      table: 'InfantTab → upsertLabourInfant',
      pkColumn: 'ipt_labour_infant_id',
      status: 'error',
      message: (e as Error).message,
    });
  }

  return out;
}
