// Browser-side HOSxP poll orchestrator.
//
// Server-side scheduled polling is disabled (see src/app/api/startup.ts). All
// HOSxP pulls now happen in the user's browser tab against the local gateway
// at 127.0.0.1:45011 (or the BMS tunnel as fallback) and are POSTed to
// /api/sync/browser-push, which dispatches to the existing webhook
// processors. This mirrors what HOSxP's own KKLRMSWebhookUnit.pas does for
// event-driven publishes — same shapes, same receiver.
//
// Responsibilities:
//   1. Run three categories of SQL against HOSxP via executeSql():
//        - active labour admissions (ipt + ipt_labour + vital signs)
//        - partograph observations for those admissions
//        - active ANC pregnancies + per-visit screen + classifying items
//   2. Map raw rows to the WebhookPayload / WebhookAncPayload /
//      WebhookPartographPayload shapes the server already understands.
//   3. POST one consolidated bundle to /api/sync/browser-push.
//
// Why not call processWebhookPayload() directly? Going through HTTP gives
// us the SyncProgressRun trail, the auth gate (NextAuth-only, hospital from
// session), and the same code path the Delphi client exercises in prod.

import { executeSql } from '@/lib/bms-browser-client';
import type { ConnectionConfig, SqlApiResponse } from '@/types/bms-browser';

// ─── Webhook payload shapes (mirror src/services/webhook.ts) ────────────────
//
// Re-declared here as plain `Omit<...>` to keep this file usable from the
// client bundle (the `webhook.ts` module imports DB / Node-only deps).

interface BrowserLaborPatient {
  hn: string;
  an: string;
  name: string;
  cid: string;
  age: number;
  gravida?: number | null;
  para?: number | null;
  abortion?: number | null;
  living_children?: number | null;
  preg_no?: number | null;
  ga_weeks?: number | null;
  ga_day?: number | null;
  anc_count?: number | null;
  admit_date: string;
  height_cm?: number | null;
  weight_kg?: number | null;
  pre_pregnancy_weight_kg?: number | null;
  hematocrit_pct?: number | null;
  bp_systolic_admit?: number | null;
  bp_diastolic_admit?: number | null;
  pulse_admit?: number | null;
  rr_admit?: number | null;
  temperature_admit?: number | null;
  cervical_open_cm_admit?: number | null;
  effacement_pct_admit?: number | null;
  station_admit?: string | null;
  labor_status?: string;
}

interface BrowserPartographObservation {
  an: string;
  externalObservationId: string;
  observeDatetime?: string;
  hourNo?: number | null;
  fetalHeartRate?: number | null;
  amnioticFluid?: string | null;
  amnioticTypeId?: number | null;
  moulding?: string | null;
  cervicalDilationCm?: number | null;
  descentOfHead?: string | null;
  contractionPer10Min?: number | null;
  contractionDurationSec?: number | null;
  contractionStrength?: 'mild' | 'moderate' | 'strong' | null;
  oxytocinUml?: number | null;
  oxytocinDropsMin?: number | null;
  drugsIvFluids?: string | null;
  pulse?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  temperature?: number | null;
  urineVolumeMl?: number | null;
  urineProtein?: string | null;
  urineGlucose?: string | null;
  urineAcetone?: string | null;
  note?: string | null;
  entryStaff?: string | null;
  entryDatetime?: string | null;
}

interface BrowserAncVisit {
  date: string;
  visitNumber: number;
  gaWeeks?: number;
  weightKg?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  fetalHr?: number;
  hctPct?: number | null;
  hbGDl?: number | null;
  urineProtein?: string | null;
  urineGlucose?: string | null;
  presentation?: string | null;
  engagement?: string | null;
}

interface BrowserAncPatient {
  hn: string | null;
  name: string;
  cid: string;
  birthday: string;
  pregNo: number;
  lmp?: string;
  edc?: string;
  riskLevel?: string;
  changwatCode?: string;
  amphurCode?: string;
  tambonCode?: string;
  vdrlResult?: string | null;
  hivResult?: string | null;
  visits?: BrowserAncVisit[];
}

export interface BrowserPushBody {
  labor?: { patients: BrowserLaborPatient[]; mode?: 'incremental' | 'full_snapshot' };
  anc?: { patients: BrowserAncPatient[] };
  partograph?: { observations: BrowserPartographObservation[] };
}

export interface BrowserPollResult {
  durationMs: number;
  /** `dropped*` = patients filtered out by the per-patient name probe. */
  labor: { read: number; mapped: number; sent: number; droppedNameUnstable: number };
  partograph: { read: number; mapped: number; sent: number; droppedNameUnstable: number };
  anc: { read: number; mapped: number; sent: number; droppedNameUnstable: number };
  pushedToServer: boolean;
  /** Verdict of the name round-trip probe — present whenever a probe ran. */
  authenticity?: { status: 'authentic' | 'name_unstable' | 'no_data' | 'probe_failed'; detail: string };
  error?: string;
  /**
   * True when the server returned a permanent rejection (403 — readonly
   * session, hospital inactive, hospital not registered, etc.). Caller
   * should STOP polling for the rest of this tab session so Chrome's
   * network panel doesn't log a red 403 every cycle.
   */
  permanentBlock?: boolean;
}

// ─── SQL queries (MySQL flavour — HOSxP) ────────────────────────────────────
//
// Mirrors src/config/hosxp-queries.ts (server-side polling) but inlined so
// the browser bundle doesn't drag in PG-only types.
//
// Scope:
//   - i.confirm_discharge = 'N'   → still admitted
//   - w.is_maternity_ward = 'Y'   → per-site scope flag set in HOSxP ward admin
//   - i.ipt_admit_type_id = 3     → "delivery admission" specifically. Without
//                                    this, we pick up early-pregnancy management
//                                    (miscarriage / threatened abortion, G1 GA
//                                    10 weeks at hcode 11004 was the first
//                                    real-world hit), post-partum readmissions,
//                                    and gynae procedures — all show up under
//                                    "ACTIVE LABOR · PROVINCE" with clinically
//                                    nonsensical GA values. Matches the
//                                    Pascal client (KKLRMSWebhookUnit.pas L594).
const SQL_ACTIVE_LABOUR = `
  SELECT i.an, i.hn, i.regdate, i.regtime, i.dchdate,
         CONCAT(p.pname, p.fname, ' ', p.lname) AS patient_name,
         p.pname, p.fname, p.lname,
         p.cid, p.birthday, p.height,
         pvs.bw AS weight,
         l.g AS gravida, l.p AS para, l.a AS abortion, l.l AS living_children,
         l.preg_no, COALESCE(ip.ga, l.ga) AS ga_weeks, l.ga_day, l.anc_count,
         pvs.hct,
         pvs.bps AS bp_sys_admit, pvs.bpd AS bp_dia_admit,
         pvs.hr AS pulse_admit, pvs.rr AS rr_admit, pvs.temperature AS temp_admit,
         pvs.cervical_open_size, pvs.eff, pvs.station,
         (SELECT pas.bw FROM person_anc_screen pas
            INNER JOIN person_anc_service pasv ON pasv.person_anc_service_id = pas.person_anc_service_id
            INNER JOIN person_anc pa ON pa.person_anc_id = pasv.person_anc_id
            INNER JOIN person pe ON pe.person_id = pa.person_id
           WHERE pe.cid = p.cid AND LENGTH(p.cid) = 13 AND pas.bw IS NOT NULL AND pas.bw > 0
           ORDER BY pasv.person_anc_service_id ASC LIMIT 1) AS pre_preg_weight
    FROM ipt i
    JOIN ward w ON w.ward = i.ward AND w.is_maternity_ward = 'Y'
    JOIN patient p ON p.hn = i.hn
    LEFT JOIN ipt_labour l ON l.an = i.an
    LEFT JOIN ipt_pregnancy ip ON ip.an = i.an
    LEFT JOIN ipt_pregnancy_vital_sign pvs ON pvs.an = i.an
   WHERE i.confirm_discharge = 'N'
     AND i.ipt_admit_type_id = 3
   ORDER BY i.regdate DESC`;

const SQL_PARTOGRAPH = `
  SELECT lp.ipt_labour_partograph_id, lp.an,
         lp.observe_datetime, lp.hour_no,
         lp.fetal_heart_rate,
         lp.amniotic_fluid, lp.labour_amniotic_type_id,
         lp.moulding, lp.cervical_dilation_cm, lp.descent_of_head,
         lp.contraction_per_10min, lp.contraction_duration_sec, lp.contraction_strength,
         lp.oxytocin_uml, lp.oxytocin_drops_min, lp.drugs_iv_fluids,
         lp.pulse, lp.bp_systolic, lp.bp_diastolic, lp.temperature,
         lp.urine_volume_ml, lp.urine_protein, lp.urine_glucose, lp.urine_acetone,
         lp.note, lp.entry_staff, lp.entry_datetime
    FROM ipt_labour_partograph lp
    JOIN ipt i ON i.an = lp.an
    JOIN ward w ON w.ward = i.ward AND w.is_maternity_ward = 'Y'
   WHERE i.confirm_discharge = 'N'
     AND i.ipt_admit_type_id = 3
   ORDER BY lp.an, lp.observe_datetime`;

// ANC active window: edc within 45 days post-EDC OR lmp within 330 days.
// Mirrors activeAncWhereClause() in src/services/sync/polling.ts so the
// browser-poll matches what server-side polling used to pull.
function ancActiveWhere(): string {
  const today = new Date();
  const postpartumCutoff = new Date(today.getTime() - 45 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const lmpCutoff = new Date(today.getTime() - 330 * 86_400_000).toISOString().slice(0, 10);
  return `(COALESCE(pa.discharge, 'N') <> 'Y'
      AND pa.labor_status_id = 1
      AND (
        (pa.edc IS NOT NULL AND pa.edc >= '${postpartumCutoff}')
        OR (pa.lmp IS NOT NULL AND pa.lmp >= '${lmpCutoff}')
      ))`;
}

const ancMastersSql = (): string => `
  SELECT pa.person_anc_id, pa.preg_no, pa.lmp, pa.edc,
         pa.blood_vdrl1_result, pa.blood_vdrl2_result,
         pa.blood_hiv1_result, pa.blood_hiv2_result,
         pt.hn, pt.chwpart, pt.amppart, pt.tmbpart,
         CONCAT(pe.pname, pe.fname, ' ', pe.lname) AS patient_name,
         pe.pname, pe.fname, pe.lname,
         pe.cid, pe.birthdate AS birthday
    FROM person_anc pa
    INNER JOIN person pe ON pe.person_id = pa.person_id
    LEFT JOIN patient pt ON pt.cid = pe.cid AND LENGTH(pe.cid) = 13
   WHERE ${ancActiveWhere()}
   ORDER BY pa.person_anc_id DESC
   LIMIT 500`;

const ancVisitsSql = (): string => `
  SELECT s.person_anc_id,
         s.anc_service_date, s.anc_service_number, s.pa_week,
         sc.bw, sc.bps, sc.bpd, sc.baby_fetal_heart_sound,
         sc.albumin, sc.sugar,
         bp.anc_baby_position_name AS presentation_name,
         bl.anc_baby_lead_name     AS engagement_name,
         plh.anc_lab_result AS hct_result,
         plb.anc_lab_result AS hb_result
    FROM person_anc_service s
    LEFT JOIN person_anc_screen sc ON sc.person_anc_service_id = s.person_anc_service_id
    LEFT JOIN anc_baby_position bp ON bp.anc_baby_position_id = sc.anc_baby_position_id
    LEFT JOIN anc_baby_lead     bl ON bl.anc_baby_lead_id     = sc.anc_baby_lead_id
    LEFT JOIN person_anc_lab    plh ON plh.person_anc_service_id = s.person_anc_service_id AND plh.anc_lab_id = 6
    LEFT JOIN person_anc_lab    plb ON plb.person_anc_service_id = s.person_anc_service_id AND plb.anc_lab_id = 8
   WHERE s.person_anc_id IN (SELECT pa.person_anc_id FROM person_anc pa WHERE ${ancActiveWhere()})
   ORDER BY s.person_anc_id, s.anc_service_number`;

const ancClassifyingSql = (): string => `
  SELECT c.person_anc_id, c.person_anc_classifying_item_id
    FROM person_anc_classifying c
   WHERE c.check_value = 'Y'
     AND c.person_anc_id IN (SELECT pa.person_anc_id FROM person_anc pa WHERE ${ancActiveWhere()})`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidCid13(s: string | null): s is string {
  return typeof s === 'string' && /^\d{13}$/.test(s);
}

// Combine HOSxP date + time fields to ISO 8601. Mirrors combineHosxpDateTime()
// in polling.ts; HOSxP returns date and time as separate columns.
function combineDateTime(date: unknown, time: unknown): string {
  const d = strOrNull(date);
  const t = strOrNull(time) ?? '00:00:00';
  if (!d) return new Date().toISOString();
  if (d.includes('T')) return d;
  return `${d}T${t}`;
}

function parseLabFloat(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace('%', '').replace(',', '.').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function pickLatest(r1: unknown, r2: unknown): string | null {
  const second = strOrNull(r2);
  if (second) return second;
  return strOrNull(r1);
}

// Khon Kaen ANC risk classification — mirrors GetANCRiskLevel in
// docs/hosxp/KKLRMSWebhookUnit.pas. HR3 > HR2 > HR1; any HR3 item wins.
function deriveAncRisk(itemIds: number[]): string {
  let max = 0;
  for (const id of itemIds) {
    const lvl =
      [15, 16, 17, 18].includes(id) ? 3
      : [4, 6, 10, 12, 13, 14].includes(id) ? 2
      : [1, 2, 3, 5, 7, 8, 9, 11].includes(id) ? 1
      : 1;
    if (lvl > max) max = lvl;
  }
  if (max === 3) return 'HR3';
  if (max === 2) return 'HR2';
  if (max === 1) return 'HR1';
  return 'LOW';
}

function calcAge(birthday: string | null): number {
  if (!birthday) return 0;
  const ms = Date.parse(birthday);
  if (Number.isNaN(ms)) return 0;
  return Math.floor((Date.now() - ms) / (365.25 * 86_400_000));
}

// ─── Mappers (raw rows → webhook payload shapes) ────────────────────────────

function mapLabor(row: Record<string, unknown>): BrowserLaborPatient | null {
  const hn = strOrNull(row.hn);
  const an = strOrNull(row.an);
  const name = strOrNull(row.patient_name);
  const cid = strOrNull(row.cid);
  if (!hn || !an || !name || !cid) return null;
  if (!isValidCid13(cid)) return null;
  if (!row.regdate || !row.birthday) return null;

  return {
    hn,
    an,
    name,
    cid,
    age: calcAge(strOrNull(row.birthday)),
    gravida: intOrNull(row.gravida),
    para: intOrNull(row.para),
    abortion: intOrNull(row.abortion),
    living_children: intOrNull(row.living_children),
    preg_no: intOrNull(row.preg_no),
    ga_weeks: intOrNull(row.ga_weeks),
    ga_day: intOrNull(row.ga_day),
    anc_count: intOrNull(row.anc_count),
    admit_date: combineDateTime(row.regdate, row.regtime),
    height_cm: intOrNull(row.height),
    weight_kg: intOrNull(row.weight),
    pre_pregnancy_weight_kg: intOrNull(row.pre_preg_weight),
    hematocrit_pct: numOrNull(row.hct),
    bp_systolic_admit: intOrNull(row.bp_sys_admit),
    bp_diastolic_admit: intOrNull(row.bp_dia_admit),
    pulse_admit: intOrNull(row.pulse_admit),
    rr_admit: intOrNull(row.rr_admit),
    temperature_admit: numOrNull(row.temp_admit),
    cervical_open_cm_admit: numOrNull(row.cervical_open_size),
    effacement_pct_admit: numOrNull(row.eff),
    station_admit: strOrNull(row.station),
    labor_status: row.dchdate ? 'DELIVERED' : 'ACTIVE',
  };
}

function mapPartograph(row: Record<string, unknown>): BrowserPartographObservation | null {
  const an = strOrNull(row.an);
  const id = strOrNull(row.ipt_labour_partograph_id);
  if (!an || !id) return null;

  const strengthRaw = strOrNull(row.contraction_strength);
  const strength: BrowserPartographObservation['contractionStrength'] =
    strengthRaw === 'mild' || strengthRaw === 'moderate' || strengthRaw === 'strong'
      ? strengthRaw
      : null;

  return {
    an,
    externalObservationId: id,
    observeDatetime: strOrNull(row.observe_datetime) ?? undefined,
    hourNo: intOrNull(row.hour_no),
    fetalHeartRate: intOrNull(row.fetal_heart_rate),
    amnioticFluid: strOrNull(row.amniotic_fluid),
    amnioticTypeId: intOrNull(row.labour_amniotic_type_id),
    moulding: strOrNull(row.moulding),
    cervicalDilationCm: numOrNull(row.cervical_dilation_cm),
    descentOfHead: strOrNull(row.descent_of_head),
    contractionPer10Min: intOrNull(row.contraction_per_10min),
    contractionDurationSec: intOrNull(row.contraction_duration_sec),
    contractionStrength: strength,
    oxytocinUml: numOrNull(row.oxytocin_uml),
    oxytocinDropsMin: numOrNull(row.oxytocin_drops_min),
    drugsIvFluids: strOrNull(row.drugs_iv_fluids),
    pulse: intOrNull(row.pulse),
    bpSystolic: intOrNull(row.bp_systolic),
    bpDiastolic: intOrNull(row.bp_diastolic),
    temperature: numOrNull(row.temperature),
    urineVolumeMl: intOrNull(row.urine_volume_ml),
    urineProtein: strOrNull(row.urine_protein),
    urineGlucose: strOrNull(row.urine_glucose),
    urineAcetone: strOrNull(row.urine_acetone),
    note: strOrNull(row.note),
    entryStaff: strOrNull(row.entry_staff),
    entryDatetime: strOrNull(row.entry_datetime),
  };
}

function mapAncBundle(
  masters: Record<string, unknown>[],
  visits: Record<string, unknown>[],
  classifying: Record<string, unknown>[],
): BrowserAncPatient[] {
  // Index visits + classifying by person_anc_id.
  const visitsByAnc = new Map<string, Record<string, unknown>[]>();
  for (const v of visits) {
    const k = String(v.person_anc_id ?? '');
    if (!k) continue;
    const arr = visitsByAnc.get(k) ?? [];
    arr.push(v);
    visitsByAnc.set(k, arr);
  }

  const classByAnc = new Map<string, number[]>();
  for (const c of classifying) {
    const k = String(c.person_anc_id ?? '');
    const item = intOrNull(c.person_anc_classifying_item_id);
    if (!k || item == null) continue;
    const arr = classByAnc.get(k) ?? [];
    arr.push(item);
    classByAnc.set(k, arr);
  }

  const out: BrowserAncPatient[] = [];
  for (const m of masters) {
    const cid = strOrNull(m.cid);
    const name = strOrNull(m.patient_name);
    const birthday = strOrNull(m.birthday);
    const pregNo = intOrNull(m.preg_no);
    if (!cid || !name || !birthday || pregNo == null) continue;
    if (!isValidCid13(cid)) continue;

    const ancId = String(m.person_anc_id ?? '');
    const items = classByAnc.get(ancId) ?? [];

    const visitRows = (visitsByAnc.get(ancId) ?? []).map((v) => {
      const date = strOrNull(v.anc_service_date);
      const visitNumber = intOrNull(v.anc_service_number);
      if (!date || visitNumber == null) return null;
      const visit: BrowserAncVisit = { date, visitNumber };
      const ga = intOrNull(v.pa_week);
      if (ga != null) visit.gaWeeks = ga;
      const w = numOrNull(v.bw);
      if (w != null) visit.weightKg = w;
      const bps = intOrNull(v.bps);
      if (bps != null) visit.bpSystolic = bps;
      const bpd = intOrNull(v.bpd);
      if (bpd != null) visit.bpDiastolic = bpd;
      const fhr = intOrNull(v.baby_fetal_heart_sound);
      if (fhr != null) visit.fetalHr = fhr;
      visit.hctPct = parseLabFloat(strOrNull(v.hct_result));
      visit.hbGDl = parseLabFloat(strOrNull(v.hb_result));
      visit.urineProtein = strOrNull(v.albumin);
      visit.urineGlucose = strOrNull(v.sugar);
      visit.presentation = strOrNull(v.presentation_name);
      visit.engagement = strOrNull(v.engagement_name);
      return visit;
    }).filter((x): x is BrowserAncVisit => x !== null);

    const patient: BrowserAncPatient = {
      hn: strOrNull(m.hn),
      name,
      cid,
      birthday,
      pregNo,
    };
    const lmp = strOrNull(m.lmp);
    if (lmp) patient.lmp = lmp;
    const edc = strOrNull(m.edc);
    if (edc) patient.edc = edc;
    const chw = strOrNull(m.chwpart);
    if (chw) patient.changwatCode = chw;
    const amp = strOrNull(m.amppart);
    if (amp) patient.amphurCode = amp;
    const tmb = strOrNull(m.tmbpart);
    if (tmb) patient.tambonCode = tmb;
    patient.riskLevel = deriveAncRisk(items);
    patient.vdrlResult = pickLatest(m.blood_vdrl1_result, m.blood_vdrl2_result);
    patient.hivResult = pickLatest(m.blood_hiv1_result, m.blood_hiv2_result);
    if (visitRows.length > 0) patient.visits = visitRows;
    out.push(patient);
  }
  return out;
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

interface RunOptions {
  config: ConnectionConfig;
  marketplaceToken?: string | null;
  signal?: AbortSignal;
}

async function runQuery<T>(sql: string, opts: RunOptions): Promise<T[]> {
  if (opts.signal?.aborted) {
    throw new DOMException('aborted', 'AbortError');
  }
  const res: SqlApiResponse<T> = await executeSql<T>(sql, opts.config, undefined, opts.marketplaceToken);
  return Array.isArray(res.data) ? res.data : [];
}

// ─── Authenticity probe ─────────────────────────────────────────────────────
//
// Some HOSxP installations run an old API-server build that returns
// ANONYMISED first/last names while leaving structural fields (HN, CID)
// stable. The CID-only round-trip on the server-side polling worker missed
// this because CID still matched itself. The reliable test is to take each
// patient's (hn, fname, lname) tuple from the freshly-pulled row and
// re-query HOSxP — anonymised values will never match themselves on the
// second look-up.
//
// Mandatory per-patient gate: every patient must round-trip before they
// enter the push payload. Patients whose tuple doesn't round-trip get
// dropped (the rest still sync). If literally zero patients out of the
// fingerprintable population round-trip, the whole hospital is flagged
// as 'name_unstable' on hospital_bms_config so the admin UI surfaces
// a BLOCKED state.
//
// All probes run as ONE bulk SQL — one network round-trip regardless of
// how many patients are in the batch. The BMS tunnel rate-limits at 15
// calls/sec/hospital, so the per-patient approach as N independent queries
// would burn the budget; the bulk shape is essential.

// Inline SQL string escape — HOSxP names occasionally contain apostrophes
// (e.g. transliterated Western names like O'Connor). Standard SQL escapes
// single quotes by doubling them. Names cannot contain backslash-quote
// because HOSxP stores plain Thai/Western text — nothing fancy.
function sqlString(v: string): string {
  return v.replace(/'/g, "''");
}

// Identity key for a probe candidate. Source-prefixed so labour and ANC
// don't collide when the same patient has both a `patient` row (keyed by
// HN) and a `person` row (keyed by CID).
//   labor|<hn>|<fname>|<lname>
//   anc|<cid>|<fname>|<lname>
function laborKey(hn: string, fname: string, lname: string): string {
  return `labor|${hn}|${fname}|${lname}`;
}
function ancKey(cid: string, fname: string, lname: string): string {
  return `anc|${cid}|${fname}|${lname}`;
}

export type ProbeCandidate =
  | { source: 'labor'; hn: string; fname: string; lname: string }
  | { source: 'anc'; cid: string; fname: string; lname: string };

export interface BulkProbeResult {
  candidates: number;
  matched: Set<string>;
  /** Failure mode when matched.size === 0 and candidates > 0. */
  reason?: string;
  /** True when the probe query itself errored — caller should soft-fail. */
  probeFailed?: boolean;
  errorDetail?: string;
}

// Two bulk SQLs (one per source table):
//   Labor candidates check (hn, fname, lname) against `patient` — internally
//     consistent because the labour query reads p.fname/p.lname directly.
//   ANC candidates check (cid, fname, lname) against `person` — the ANC
//     master query reads pe.fname/pe.lname from `person`, so the round-trip
//     must hit the same table. The previous single-table probe sent ANC
//     candidates against `patient`, which gave wrong answers when HOSxP's
//     two PII tables were anonymised differently (false positives let
//     anonymised ANC data through; false negatives dropped real patients).
//
// Each query uses row-value IN — MySQL 5.7+ / PostgreSQL — batched to
// BULK_PROBE_BATCH per call so the SQL string stays under 10–15 KB even
// for 500-patient hospitals.
const BULK_PROBE_BATCH = 200;

async function probeOneSource(
  table: 'patient' | 'person',
  idColumn: 'hn' | 'cid',
  candidates: Array<{ idValue: string; fname: string; lname: string; key: string }>,
  opts: RunOptions,
): Promise<{ matched: Set<string>; failed?: string }> {
  const matched = new Set<string>();
  if (candidates.length === 0) return { matched };
  try {
    for (let i = 0; i < candidates.length; i += BULK_PROBE_BATCH) {
      const batch = candidates.slice(i, i + BULK_PROBE_BATCH);
      const tuples = batch
        .map(
          (c) =>
            `('${sqlString(c.idValue)}','${sqlString(c.fname)}','${sqlString(c.lname)}')`,
        )
        .join(',');
      const sql =
        `SELECT ${idColumn}, fname, lname FROM ${table} ` +
        `WHERE (${idColumn}, fname, lname) IN (${tuples})`;
      const rows = await runQuery<Record<string, unknown>>(sql, opts);
      // Match the response rows back to candidate keys via an idValue+name
      // lookup map — same idValue+fname+lname yields the same identityKey,
      // so we just rebuild the key in the response row's namespace.
      const keyByIdValue = new Map<string, string>();
      for (const c of batch) {
        keyByIdValue.set(`${c.idValue}|${c.fname}|${c.lname}`, c.key);
      }
      for (const row of rows) {
        const id = strOrNull(row[idColumn]);
        const fname = strOrNull(row.fname);
        const lname = strOrNull(row.lname);
        if (id && fname && lname) {
          const k = keyByIdValue.get(`${id}|${fname}|${lname}`);
          if (k) matched.add(k);
        }
      }
    }
  } catch (err) {
    return {
      matched,
      failed: err instanceof Error ? err.message : String(err),
    };
  }
  return { matched };
}

async function probeAllPatientsNames(
  candidates: ProbeCandidate[],
  opts: RunOptions,
): Promise<BulkProbeResult> {
  const result: BulkProbeResult = {
    candidates: candidates.length,
    matched: new Set<string>(),
  };
  if (candidates.length === 0) return result;

  // Partition by source table and dedupe per-source.
  const laborByKey = new Map<string, { idValue: string; fname: string; lname: string; key: string }>();
  const ancByKey = new Map<string, { idValue: string; fname: string; lname: string; key: string }>();
  for (const c of candidates) {
    if (c.source === 'labor') {
      const key = laborKey(c.hn, c.fname, c.lname);
      laborByKey.set(key, { idValue: c.hn, fname: c.fname, lname: c.lname, key });
    } else {
      const key = ancKey(c.cid, c.fname, c.lname);
      ancByKey.set(key, { idValue: c.cid, fname: c.fname, lname: c.lname, key });
    }
  }

  try {
    const [laborRes, ancRes] = await Promise.all([
      probeOneSource('patient', 'hn', [...laborByKey.values()], opts),
      probeOneSource('person', 'cid', [...ancByKey.values()], opts),
    ]);
    if (laborRes.failed && ancRes.failed) {
      // Both source probes errored — treat as transient probe failure.
      result.probeFailed = true;
      result.errorDetail = `labor: ${laborRes.failed}; anc: ${ancRes.failed}`;
      return result;
    }
    for (const k of laborRes.matched) result.matched.add(k);
    for (const k of ancRes.matched) result.matched.add(k);
  } catch (err) {
    result.probeFailed = true;
    result.errorDetail = err instanceof Error ? err.message : String(err);
    return result;
  }

  if (result.matched.size === 0) {
    const uniqueCount = laborByKey.size + ancByKey.size;
    result.reason =
      `Bulk name round-trip returned 0 matches for ${uniqueCount} unique ` +
      `(labor: ${laborByKey.size} hn/fname/lname against \`patient\`, anc: ` +
      `${ancByKey.size} cid/fname/lname against \`person\`) — HOSxP is ` +
      `returning anonymised PII (likely on old API server build).`;
  }
  return result;
}

/**
 * POSTs the verdict to /api/sync/browser-authenticity. Returns true when
 * the server returns a permanent rejection (403) — caller should set
 * `result.permanentBlock` and stop polling so we don't spam Chrome's
 * network panel.
 */
async function reportAuthenticityVerdict(
  status: 'authentic' | 'name_unstable' | 'no_data',
  reason: string | null,
  signal?: AbortSignal,
): Promise<{ permanentBlock: boolean }> {
  try {
    const res = await fetch('/api/sync/browser-authenticity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason }),
      signal,
      credentials: 'same-origin',
    });
    if (res.status === 403) return { permanentBlock: true };
  } catch {
    // Network error — transient, not permanent. Best-effort: a flaky
    // network shouldn't lock the hook out of all future cycles.
  }
  return { permanentBlock: false };
}

export async function runBrowserPoll(opts: RunOptions): Promise<BrowserPollResult> {
  const startedAt = Date.now();
  const result: BrowserPollResult = {
    durationMs: 0,
    labor: { read: 0, mapped: 0, sent: 0, droppedNameUnstable: 0 },
    partograph: { read: 0, mapped: 0, sent: 0, droppedNameUnstable: 0 },
    anc: { read: 0, mapped: 0, sent: 0, droppedNameUnstable: 0 },
    pushedToServer: false,
  };

  try {
    // Five queries in parallel — saves a couple of RTTs vs sequential. The
    // BMS gateway tolerates up to 15 calls/sec/hospital, so 5 in parallel
    // from one tab is well below the limit.
    const [laborRows, partRows, ancMasters, ancVisits, ancClasses] = await Promise.all([
      runQuery<Record<string, unknown>>(SQL_ACTIVE_LABOUR, opts),
      runQuery<Record<string, unknown>>(SQL_PARTOGRAPH, opts),
      runQuery<Record<string, unknown>>(ancMastersSql(), opts),
      runQuery<Record<string, unknown>>(ancVisitsSql(), opts),
      runQuery<Record<string, unknown>>(ancClassifyingSql(), opts),
    ]);

    result.labor.read = laborRows.length;
    result.partograph.read = partRows.length;
    result.anc.read = ancMasters.length;

    // ─── Per-patient name authenticity gate ───────────────────────────────
    // Collect every fingerprintable (hn, fname, lname) candidate from
    // labour and ANC masters, then run ONE bulk SQL that asks HOSxP which
    // tuples round-trip. Patients whose tuple isn't in the match set are
    // filtered out of the push payload (their AN-linked partograph rows
    // too); the rest sync normally.
    //
    // Patients with empty fname OR lname can't be probed — we let them
    // through unverified (the row is incomplete anyway, anonymisation
    // would have filled fields, not emptied them). HOSxP's anonymisation
    // sets non-empty fake values, so they DO get caught by this gate.
    const candidates: ProbeCandidate[] = [];
    // an → identity-key for labour patients (used to filter the mapped
    // BrowserLaborPatient list and the partograph observations). Keys are
    // 'labor|<hn>|<fname>|<lname>'.
    const laborKeyByAn = new Map<string, string>();
    // cid → identity-key for ANC masters. Keyed by CID rather than HN
    // because the ANC name comes from `person` (probed against `person`,
    // not `patient`), and `person.cid` is the canonical join column.
    // Patients with null/short CID are not probeable and pass through.
    const ancKeyByCid = new Map<string, string>();
    for (const row of laborRows) {
      const hn = strOrNull(row.hn);
      const an = strOrNull(row.an);
      const fname = strOrNull(row.fname);
      const lname = strOrNull(row.lname);
      if (hn && fname && lname && an) {
        const k = laborKey(hn, fname, lname);
        candidates.push({ source: 'labor', hn, fname, lname });
        laborKeyByAn.set(an, k);
      }
    }
    for (const m of ancMasters) {
      const cid = strOrNull(m.cid);
      const fname = strOrNull(m.fname);
      const lname = strOrNull(m.lname);
      if (cid && fname && lname && /^\d{13}$/.test(cid)) {
        const k = ancKey(cid, fname, lname);
        candidates.push({ source: 'anc', cid, fname, lname });
        ancKeyByCid.set(cid, k);
      }
    }

    let matched = new Set<string>();
    if (candidates.length > 0) {
      const probe = await probeAllPatientsNames(candidates, opts);
      matched = probe.matched;
      if (probe.probeFailed) {
        // Transient probe error (network/timeout) — soft-fail: trust the
        // pull this cycle, don't flag the hospital, don't filter. A flaky
        // probe shouldn't lock a hospital out.
        result.authenticity = {
          status: 'probe_failed',
          detail: probe.errorDetail ?? 'unknown probe error',
        };
      } else if (probe.matched.size === 0) {
        // Hard failure: not a single patient round-tripped. Treat as
        // hospital-wide anonymisation. Record verdict + abort push.
        result.authenticity = {
          status: 'name_unstable',
          detail: probe.reason ?? 'bulk name probe returned 0 matches',
        };
        const r = await reportAuthenticityVerdict('name_unstable', probe.reason ?? null, opts.signal);
        if (r.permanentBlock) result.permanentBlock = true;
        result.error = 'authenticity_failed_name_unstable';
        result.durationMs = Date.now() - startedAt;
        return result;
      } else {
        const dropped = candidates.length - probe.matched.size;
        result.authenticity = {
          status: 'authentic',
          detail:
            `Name round-trip: ${probe.matched.size}/${candidates.length} patients matched` +
            (dropped > 0 ? ` (${dropped} dropped — names do not round-trip).` : '.'),
        };
        const r = await reportAuthenticityVerdict(
          'authentic',
          result.authenticity.detail,
          opts.signal,
        );
        if (r.permanentBlock) {
          // /api/sync/browser-authenticity 403'd — the hospital is
          // inactive or the session can't push. No point continuing to
          // /api/sync/browser-push for the same reason.
          result.permanentBlock = true;
          result.error = 'permanently_blocked';
          result.durationMs = Date.now() - startedAt;
          return result;
        }
      }
    }

    const laborPatients = laborRows
      .map(mapLabor)
      .filter((x): x is BrowserLaborPatient => x !== null);
    const partographs = partRows
      .map(mapPartograph)
      .filter((x): x is BrowserPartographObservation => x !== null);
    const ancPatients = mapAncBundle(ancMasters, ancVisits, ancClasses);

    result.labor.mapped = laborPatients.length;
    result.partograph.mapped = partographs.length;
    result.anc.mapped = ancPatients.length;

    // ─── Apply the per-patient filter ─────────────────────────────────────
    // Anyone who was probeable AND failed the round-trip is dropped here.
    // Patients with empty fname/lname (non-probeable) flow through.
    if (candidates.length > 0 && result.authenticity?.status === 'authentic') {
      const laborSurvivors: BrowserLaborPatient[] = [];
      const droppedAns = new Set<string>();
      for (const p of laborPatients) {
        const k = laborKeyByAn.get(p.an);
        if (k && !matched.has(k)) {
          result.labor.droppedNameUnstable += 1;
          droppedAns.add(p.an);
          continue;
        }
        laborSurvivors.push(p);
      }
      // Drop partograph observations whose AN belonged to a failed labour
      // patient — keeping them would leave orphan severity rows.
      const partSurvivors = partographs.filter((o) => {
        if (droppedAns.has(o.an)) {
          result.partograph.droppedNameUnstable += 1;
          return false;
        }
        return true;
      });
      // ANC: filter by CID → identity key. The ANC name was fingerprinted
      // against the `person` table by CID, so the survivor lookup is also
      // by CID. Patients with non-13-digit CID weren't probeable and fall
      // through untouched.
      const ancSurvivors = ancPatients.filter((a) => {
        if (!/^\d{13}$/.test(a.cid)) return true;
        const masterKey = ancKeyByCid.get(a.cid);
        if (masterKey && !matched.has(masterKey)) {
          result.anc.droppedNameUnstable += 1;
          return false;
        }
        return true;
      });
      laborPatients.length = 0;
      laborPatients.push(...laborSurvivors);
      partographs.length = 0;
      partographs.push(...partSurvivors);
      ancPatients.length = 0;
      ancPatients.push(...ancSurvivors);
      result.labor.mapped = laborPatients.length;
      result.partograph.mapped = partographs.length;
      result.anc.mapped = ancPatients.length;
    }

    // Skip the POST entirely when there's nothing to send — keeps the Sync
    // Log clean for hospitals with no active patients (would otherwise
    // record a "0 rows / 0 rows" run on every browser tick).
    if (laborPatients.length === 0 && partographs.length === 0 && ancPatients.length === 0) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    const body: BrowserPushBody = {};
    if (laborPatients.length > 0) {
      // 'incremental' — server-side full_snapshot semantics rely on a single
      // payload covering every active patient at the hospital. The browser
      // poll is per-user and per-tab, so several tabs may push partial views;
      // incremental upserts are the safe default.
      body.labor = { patients: laborPatients, mode: 'incremental' };
    }
    if (partographs.length > 0) body.partograph = { observations: partographs };
    if (ancPatients.length > 0) body.anc = { patients: ancPatients };

    const pushRes = await fetch('/api/sync/browser-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
      credentials: 'same-origin',
    });

    if (!pushRes.ok) {
      const text = await pushRes.text().catch(() => pushRes.statusText);
      // 403 is a permanent rejection for this session (readonly,
      // hospital_inactive, hospital_not_registered) — flag the caller so
      // it stops polling instead of generating a fresh 403 every cycle.
      if (pushRes.status === 403) {
        result.permanentBlock = true;
        result.error = `permanently_blocked: ${text.slice(0, 200)}`;
        result.durationMs = Date.now() - startedAt;
        return result;
      }
      throw new Error(`browser-push HTTP ${pushRes.status}: ${text.slice(0, 200)}`);
    }

    const pushed = (await pushRes.json().catch(() => null)) as
      | { labor?: { processed: number }; anc?: { processed: number }; partograph?: { accepted: number } }
      | null;

    result.labor.sent = pushed?.labor?.processed ?? laborPatients.length;
    result.anc.sent = pushed?.anc?.processed ?? ancPatients.length;
    result.partograph.sent = pushed?.partograph?.accepted ?? partographs.length;
    result.pushedToServer = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}
