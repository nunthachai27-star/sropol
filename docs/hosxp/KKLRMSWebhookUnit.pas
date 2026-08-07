unit KKLRMSWebhookUnit;
{
  KK-LRMS (Khon Kaen Labour Room Monitoring System) Webhook Client

  Sends patient data to the KK-LRMS central dashboard via webhook API.
  Supports: Labour admission, ANC pregnancy, Referral status updates.

  Configuration (hosvariable):
    HOSPITAL_CODE  - 5-digit MOPH hospital code
    KKLRMS_API_KEY - Bearer token (kklrms_xxx format, 47 chars)

  Usage from UI events:
    // After labour entry save:
    SendKKLRMSLabourData(FAN);

    // After ANC entry save:
    SendKKLRMSANCData(FPersonANCID);

    // After creating referral out (sender hospital):
    SendKKLRMSReferralCreate(FReferoutID);

    // After receiving referral status change (receiver hospital):
    SendKKLRMSReferralUpdate(FReferinVN, 'ACCEPTED', 'reason');

    // Periodic snapshot (timer, every 5 min recommended):
    SendKKLRMSLabourSnapshot;

  Optional `maternal_screening` object (H2, v1 — 2026-07-17):
    Every labor patient object (BuildLabourPatient) can optionally carry a
    `maternal_screening` sub-object with a preeclampsia/eclampsia/hemorrhage/
    obstructed-labor triage snapshot. OFF by default — see
    KKLRMS_SEND_MATERNAL_SCREENING below. Built STRICTLY from the field map
    in docs/hosxp/maternal-screening-field-map.md (H1): only 8 fields have a
    verified structured HOSxP source today (identity/anchor fields,
    proteinuria_grade, FHR, maternal pulse, RR, SpO2); everything else is
    omitted (no structured source, or pending per-site config / clinical
    sign-off — never inferred from free text, per GC-H1).
    Contract (frozen, `MS_KNOWN_TRANSPORT_KEYS` in src/services/webhook.ts):
      - Only documented snake_case keys are emitted; unknown keys cause the
        server to reject the WHOLE screening object (the labor upsert itself
        is unaffected).
      - `assessed_at` is always a REAL observation timestamp (never Now),
        strict ISO-8601 with UTC+7 offset via the existing ISO8601() helper.
      - `source_pk` is a stable HOSxP row-PK-derived key so replays are
        idempotent (see BuildMaternalScreeningJson for the exact format).
    See docs/hosxp/maternal-screening-field-map.md (H1, source-of-truth
    mapping) and docs/WEBHOOK-SPEC.md (payload contract + examples).
    Enabling this flag here does NOTHING on the server unless the KK-LRMS
    side also has MATERNAL_SCREEN_INGEST_ENABLED=true (default OFF) — until
    both are on, sending the object is a harmless no-op.
}

interface

uses
  Windows, SysUtils, Classes, DB, DBClient, Variants;

{ Labour - send single patient after admit/update/discharge
  Action: 'upsert' (default) or 'delete' }
function SendKKLRMSLabourData(const AN: String;
  const Action: String = 'upsert'): Variant;

{ Labour - send all active labor patients as full_snapshot
  Patients not in snapshot are auto-discharged on dashboard }
function SendKKLRMSLabourSnapshot: Variant;

{ ANC - send pregnancy registration + visits
  RiskLevel auto-queried from person_anc_classifying }
function SendKKLRMSANCData(const PersonANCID: Integer;
  const Action: String = 'upsert'): Variant;

{ Referral eligibility check — call before creating referral
  Returns: Variant with canRefer, reason, patient info, activeReferrals
  Uses POST /api/referrals/check with patient CID }
function CheckKKLRMSReferralEligibility(const CID: String): Variant;

{ Referral CREATE - sent by รพ.ต้นทาง (sender) when creating referral out
  type: "referral" — auto-checks eligibility, includes patient data + GIS }
function SendKKLRMSReferralCreate(const ReferoutID: Integer;
  const Action: String = 'upsert'): Variant;

{ Referral UPDATE - sent by รพ.ปลายทาง (receiver) to accept/reject/transit/arrive
  type: "referral_update" — auto-reads fromHospitalCode, referralId from referin
  ReferinVN: referin.vn (visit at receiving hospital)
  Status: 'ACCEPTED','IN_TRANSIT','ARRIVED','REJECTED' }
function SendKKLRMSReferralUpdate(const ReferinVN: String;
  const Status: String;
  const Reason: String = '';
  const TransportMode: String = '';
  const Action: String = 'update'): Variant;

var  KKLRMS_UAT : Boolean = false;

{ Optional `maternal_screening` object on the labor payload (H2, v1). OFF by
  default — flip to True per-site only AFTER: (1) confirming this hospital's
  ipt_labour_partograph / ipd_nurse_note charting matches the H1 field map
  (docs/hosxp/maternal-screening-field-map.md), and (2) the KK-LRMS side has
  set MATERNAL_SCREEN_INGEST_ENABLED=true — with either side off, the object
  is either not sent or silently ignored server-side (harmless no-op either
  way). Turning this on alone does NOT enable the PARTIAL fields (pih
  diagnosis, labs, contraction/membrane/presentation derivations) — those
  stay null in v1 pending per-site config + clinical sign-off (see H1). }
var  KKLRMS_SEND_MATERNAL_SCREENING : Boolean = false;

implementation

uses
  DateUtils, hosxpdmu,BMSApplicationConstUnit, BMSApplicationUtil, SIAuto,
{$IFDEF BMSMORMOT2}
  mormot.core.base, mormot.crypt.core, mormot.core.text, mormot.core.variants,
  mormot.core.json, mormot.core.unicode, mormot.core.buffers, mormot.crypt.openssl,
  syncrtsock
{$ELSE}
  syncommons, syncrtsock
{$ENDIF};

const
  KKLRMS_HOST = 'kk-lrms.bmscloud.in.th';
  KKLRMS_PORT = '443';
  KKLRMS_PATH = '/api/webhooks/patient-data';
  LOG_TAG     = '[KK-LRMS]';



function GetKKLRMS_HOST:String;
begin
   if KKLRMS_UAT then

    result:='127.0.0.1' else
    result:= KKLRMS_HOST;
end;

function GetKKLRMS_PORT:String;
begin
   if KKLRMS_UAT then

    result:='3000' else
    result:= KKLRMS_PORT;
end;

function TruncFor(const S: String; MaxLen: Integer = 500): String;
begin
  if Length(S) <= MaxLen then
    Result := S
  else
    Result := Copy(S, 1, MaxLen) + '...(+' + IntToStr(Length(S) - MaxLen) + 'b)';
end;

function ModeTag: String;
begin
  if KKLRMS_UAT then Result := 'UAT' else Result := 'PROD';
end;

function TargetUrl(const Path: String): String;
var scheme: String;
begin
  if KKLRMS_UAT then scheme := 'http' else scheme := 'https';
  Result := Format('%s://%s:%s%s', [scheme, GetKKLRMS_HOST, GetKKLRMS_PORT, Path]);
end;

{ ── Configuration ──────────────────────────────────────────────────────────── }

function GetConfig(out ApiKey, HospCode: String): Boolean;
begin
  ApiKey   := vartostr(getsqldata('select webhook_authorization_key from webhook_setting where webhook_module_id = 3 and webhook_setting_code = "KK-LRMS" and webhook_active = "Y"'));
  HospCode := fhospitalcode;
  Result := (ApiKey <> '') and (HospCode <> '');
  if not Result then
  begin
    if ApiKey = '' then
      SIMain.LogWarning(LOG_TAG + ' Config: API key missing (webhook_setting row with code="KK-LRMS", module_id=3, active="Y" not found or empty) — all webhooks will be skipped')
    else
      SIMain.LogWarning(LOG_TAG + ' Config: hospital code missing (fhospitalcode is empty) — all webhooks will be skipped');
   // DoShowAutoHideAlertWindow('KK-LRMS');
  end;
end;

{ ── HTTP Post ──────────────────────────────────────────────────────────────── }

function PostWebhook(const Payload: Variant; const ApiKey: String;
  const OpLabel: String = ''): Variant;
var
  ss: sockstring;
  t0, elapsed: Cardinal;
  op, target, line: String;
begin
  Result := Null;
  op := OpLabel;
  if op = '' then op := 'webhook';
  target := TargetUrl(KKLRMS_PATH);

  // Pre-send announcement — makes it obvious which environment we're hitting and
  // pairs each result line with the request that triggered it (useful when
  // tailing the log during a multi-patient snapshot or smoke test).
  SIMain.LogMessage(Format('%s [%s] POST -> %s op=%s',
    [LOG_TAG, ModeTag, target, op]));

  t0 := GetTickCount;
  try
    // aUseSSL must follow KKLRMS_UAT — UAT hits the local Next.js dev server on
    // plain http://127.0.0.1:3000; only PROD uses HTTPS. Forcing SSL in UAT
    // gives an empty response body (SSL handshake to a plain-HTTP server),
    // which used to surface as "invalid non-JSON response: <empty>" with every
    // smoke-test row marked SKIPPED/NULL.
    ss := PostCurlWithContentType(
      GetKKLRMS_HOST, GetKKLRMS_PORT, KKLRMS_PATH,
      Payload, ApiKey, 'application/json',
      not KKLRMS_UAT, False, 5000, 15000, 30000);
    elapsed := GetTickCount - t0;

    if IsValidJSON(ss) then
    begin
      Result := _json(ss);
      if Result.exists('error') then
        SIMain.LogError(Format('%s [%s] FAIL %s in %dms: error=%s body=%s',
          [LOG_TAG, ModeTag, op, elapsed, vartostr(Result.error), TruncFor(ss, 800)]))
      else
      begin
        // Surface the most useful response counters when present so the OK
        // line carries the verdict without needing to scroll to the body.
        line := Format('%s [%s] OK   %s in %dms (resp=%db)',
          [LOG_TAG, ModeTag, op, elapsed, Length(ss)]);
        try
          if Result.exists('patientsProcessed') then
            line := line + ' processed=' + vartostr(Result.patientsProcessed);
          if Result.exists('newAdmissions') then
            line := line + ' new=' + vartostr(Result.newAdmissions);
          if Result.exists('discharges') then
            line := line + ' dch=' + vartostr(Result.discharges);
          if Result.exists('deleted') then
            line := line + ' del=' + vartostr(Result.deleted);
          if Result.exists('referralId') then
            line := line + ' refId=' + vartostr(Result.referralId);
          if Result.exists('status') then
            line := line + ' status=' + vartostr(Result.status);
        except
          // ignore — fall back to body preview only
        end;
        line := line + ' body=' + TruncFor(ss, 500);
        SIMain.LogMessage(line);
      end;
    end
    else
      SIMain.LogError(Format('%s [%s] BAD  %s in %dms invalid non-JSON response: %s',
        [LOG_TAG, ModeTag, op, elapsed, TruncFor(ss, 800)]));
  except
    on E: Exception do
    begin
      elapsed := GetTickCount - t0;
      SIMain.LogError(Format('%s [%s] EXC  %s in %dms %s: %s',
        [LOG_TAG, ModeTag, op, elapsed, E.ClassName, E.Message]));
    end;
  end;
end;

{ ── Referral Eligibility Check ─────────────────────────────────────────────── }

const
  KKLRMS_CHECK_PATH = '/api/referrals/check';

function CheckKKLRMSReferralEligibility(const CID: String): Variant;
var
  apiKey, hc: String;
  ss: sockstring;
  payload: Variant;
  t0, elapsed: Cardinal;
begin
  Result := Null;
  if not GetConfig(apiKey, hc) then Exit;

  payload := _obj(['cid', CID]);
  SIMain.LogMessage(Format('%s [%s] Eligibility check: cid=%s -> %s',
    [LOG_TAG, ModeTag, CID, TargetUrl(KKLRMS_CHECK_PATH)]));

  t0 := GetTickCount;
  try
    // See PostWebhook: aUseSSL must follow KKLRMS_UAT (plain http for the
    // local dev server, https in production).
    ss := PostCurlWithContentType(
      GetKKLRMS_HOST, GetKKLRMS_PORT, KKLRMS_CHECK_PATH,
      payload, apiKey, 'application/json',
      not KKLRMS_UAT, False, 5000, 15000, 15000);
    elapsed := GetTickCount - t0;

    if IsValidJSON(ss) then
    begin
      Result := _json(ss);
      SIMain.LogMessage(Format('%s Eligibility result in %dms: cid=%s canRefer=%s reason=%s',
        [LOG_TAG, elapsed, CID, vartostr(Result.canRefer), vartostr(Result.reason)]));
    end
    else
      SIMain.LogWarning(Format('%s Eligibility invalid non-JSON response in %dms for cid=%s: %s',
        [LOG_TAG, elapsed, CID, TruncFor(ss)]));
  except
    on E: Exception do
    begin
      elapsed := GetTickCount - t0;
      SIMain.LogWarning(Format('%s Eligibility EXCEPTION in %dms for cid=%s: %s: %s',
        [LOG_TAG, elapsed, CID, E.ClassName, E.Message]));
    end;
  end;
end;

{ ── Format Helpers ─────────────────────────────────────────────────────────── }

function ISO8601(const DT: TDateTime): String;
begin
  Result := FormatDateTime('yyyy-mm-dd"T"hh:nn:ss', DT) + '+07:00';
end;

function ISODate(const D: TDateTime): String;
begin
  Result := FormatDateTime('yyyy-mm-dd', D);
end;

function CalcAge(const Birthday: TDateTime): Integer;
begin
  if Birthday < 2 then
    Result := 0
  else
    Result := YearsBetween(Date, Birthday);
end;

{ Parse a HOSxP lab result varchar (e.g. "35", "34%", " 12.5 ") into a float.
  Strips '%' and whitespace; tolerates both '.' and ',' as decimal. Returns
  False (and sets V := 0) when the value is empty or not a number — caller
  should then omit the field rather than send 0. }
function ParseLabFloat(const S: String; out V: Double): Boolean;
var
  T: String;
begin
  V := 0;
  T := Trim(StringReplace(S, '%', '', [rfReplaceAll]));
  if T = '' then begin Result := False; Exit; end;
  if Pos(',', T) > 0 then
    T := StringReplace(T, ',', '.', [rfReplaceAll]);
  Result := TryStrToFloat(T, V);
end;

{ Pick the most recent non-empty lab value: prefer round-2 result, fall back
  to round-1. Used for VDRL/HIV which HOSxP stores as two separate columns
  (blood_vdrl1_result + blood_vdrl2_result, etc.). }
function LatestLab(const R1, R2: String): String;
begin
  if Trim(R2) <> '' then Result := Trim(R2)
  else if Trim(R1) <> '' then Result := Trim(R1)
  else Result := '';
end;

(* Server enforces a strict 13-digit CID regex on the labour endpoint and
   rejects the WHOLE batch on a single bad value. Validate locally so a bad
   row skips itself instead of killing a 100-patient snapshot. *)
function IsValidCID13(const S: String): Boolean;
var
  i: Integer;
begin
  Result := False;
  if Length(S) <> 13 then Exit;
  for i := 1 to 13 do
    if not CharInSet(S[i], ['0'..'9']) then Exit;
  Result := True;
end;

{ ── Labour ─────────────────────────────────────────────────────────────────── }

{  HOSxP Table Mapping:
     ipt           : an, hn, regdate, dchdate
     patient       : pname, fname, lname, cid, birthday, height
     ipt_labour    : g (gravida), ga (GA weeks), anc_count
     ipt_pregnancy_vital_sign : bw (weight at admission), hct (hematocrit)
   Webhook CPD Risk Factors:
     height_cm (<150 -> +2), gravida (=1 -> +2), ga_weeks (>=40 -> +1.5),
     anc_count (<4 -> +1.5), weight_diff_kg (>20 -> +2),
     fundal_height_cm (>36 -> +2), us_weight_g (>3500 -> +2),
     hematocrit_pct (<30 -> +1.5)                                              }

{ Pre-pregnancy weight subquery: pulls the EARLIEST recorded BW from this
  woman's ANC visits, joined via cid (cross-hospital safe) — falls back to
  null when she has no ANC history at this site. The MIN(person_anc_service_id)
  proxy works because anc_service rows are inserted in visit order.            }
const
  SQL_PREPREG_WEIGHT_SUBQ =
    '(SELECT pas.bw FROM person_anc_screen pas ' +
    ' INNER JOIN person_anc_service pasv ON pasv.person_anc_service_id = pas.person_anc_service_id ' +
    ' INNER JOIN person_anc pa ON pa.person_anc_id = pasv.person_anc_id ' +
    ' INNER JOIN person pe ON pe.person_id = pa.person_id ' +
    ' WHERE pe.cid = p.cid AND LENGTH(p.cid) = 13 AND pas.bw IS NOT NULL AND pas.bw > 0 ' +
    ' ORDER BY pasv.person_anc_service_id ASC LIMIT 1) AS pre_preg_weight';

const
  SQL_LABOUR =
    'SELECT i.an, i.hn, i.regdate, i.regtime, i.dchdate, ' +
    'CONCAT(p.pname, p.fname, '' '', p.lname) AS patient_name, ' +
    'p.cid, p.birthday, p.height, pvs.bw AS weight, ' +
    'l.g AS gravida, l.p AS para, l.a AS abortion, l.l AS living_children, ' +
    'l.preg_no, l.ga AS ga_weeks, l.ga_day, l.anc_count, ' +
    'pvs.hct, ' +
    'pvs.bps AS bp_sys_admit, pvs.bpd AS bp_dia_admit, ' +
    'pvs.hr AS pulse_admit, pvs.rr AS rr_admit, pvs.temperature AS temp_admit, ' +
    'pvs.cervical_open_size, pvs.eff, pvs.station, ' +
    SQL_PREPREG_WEIGHT_SUBQ + ' ' +
    'FROM ipt i ' +
    'INNER JOIN patient p ON p.hn = i.hn ' +
    'LEFT JOIN ipt_labour l ON l.an = i.an ' +
    'LEFT JOIN ipt_pregnancy_vital_sign pvs ON pvs.an = i.an ';

{ Find a field by name without raising when absent — useful for snapshot/upsert
  callers that may run against an older SQL_LABOUR shape (e.g. unit tests). }
function FldOrNil(Q: TClientDataSet; const Name: String): TField;
begin
  Result := Q.FindField(Name);
end;

{ ── Maternal Screening (optional, H2) ──────────────────────────────────────

  Builds the OPTIONAL `maternal_screening` sub-object attached to a labor
  patient (see BuildLabourPatient below), STRICTLY from the H1 field map
  (docs/hosxp/maternal-screening-field-map.md). Gated by
  KKLRMS_SEND_MATERNAL_SCREENING (default False) — the caller only invokes
  this when the flag is on.

  Anchor row (H1 §2 recommendation):
    1. PRIMARY: latest ipt_labour_partograph row for the AN
       (ORDER BY observe_datetime DESC, ipt_labour_partograph_id DESC LIMIT 1).
       assessed_at := observe_datetime, assessed_by := entry_staff,
       source_pk := 'AN:{an}:LP:{id}'. Directly supplies proteinuria_grade
       (raw urine_protein string — server normalizes), fetal_heart_rate_bpm,
       maternal_pulse_bpm. respiratory_rate_per_min / oxygen_saturation_pct
       have NO partograph column, so they are supplemented from the latest
       ipd_nurse_note ONLY when that note falls within 60 minutes of the
       anchor's observe_datetime (H1 §2 "context window" — never silently mix
       a fresh anchor with a stale vital); when a supplement is used the key
       is extended to 'AN:{an}:LP:{id}:NN:{nnid}' so a newer nurse note
       correctly registers as a new observation rather than a duplicate.
    2. FALLBACK (no partograph rows yet): latest ipd_nurse_note row
       (ORDER BY note_date DESC, note_time DESC, nurse_note_id DESC LIMIT 1).
       assessed_at := note_date+note_time, assessed_by := doctor_code,
       source_pk := 'AN:{an}:NN:{id}'. Supplies maternal_pulse_bpm
       (COALESCE pulse, heart_rate), respiratory_rate_per_min,
       oxygen_saturation_pct (COALESCE spo2_ra, spo2_o2).
       proteinuria_grade / fetal_heart_rate_bpm have no source on this
       anchor — omitted.
    3. Neither row exists -> returns Null (Unassigned); caller attaches
       nothing. assessed_at is REQUIRED and must be a real observation time
       — NEVER Now (that would assert an assessment that never happened).

  PARTIAL fields (H1 — structured source verified but pending per-site
  item/master mapping, a unit check, or clinical sign-off): pih_diagnosed,
  creatinine_mg_dl, platelet_per_ul, ast_iu_l, alt_iu_l,
  urine_output_ml_per_hour, frequent_contractions,
  contraction_duration_exceeds_interval, membranes_ruptured,
  abnormal_presentation, fetal_tracing_pattern.
  TODO(H1): enable per-site, one field at a time, only after its named
  precondition in the field map is signed off. NOT implemented in v1.

  NOT AVAILABLE fields (H1 — no structured HOSxP source anywhere; GC-H1
  forbids inferring from free text/nurse narrative): creatinine_baseline_mg_dl,
  headache, blurred_vision, epigastric_pain, pulmonary_edema,
  right_upper_quadrant_pain, vaginal_bleeding, estimated_bleeding_ml,
  bleeding_rate, concealed_bleeding_suspected, abdominal_or_back_pain,
  uterine_tenderness, suprapubic_tenderness, bandls_ring, consciousness,
  shock_signs_present, placenta_previa_excluded, placenta_location_source.

  Convention: every field above (PARTIAL + NOT AVAILABLE) is OMITTED from
  the JSON object entirely — this unit's existing style (BuildLabourPatient)
  never emits an explicit JSON null for an absent optional field, and the
  server treats an omitted key identically to an explicit null
  (`v === undefined || v === null` in src/services/webhook.ts's bool/num/enum
  parsers) — so omission is contract-safe and matches this unit's idiom.

  Never breaks the main labor payload: any exception here is caught, logged,
  and the object is omitted (Result := Null) — the labor upsert proceeds
  without it.

  Cannot be unit-tested here — this is reference Pascal shipped to hospitals,
  no Delphi compiler in this repo. Task H3's dev-simulation profiles exercise
  the IDENTICAL transport shape end-to-end against the real webhook
  validator; that is the executable test for this function's output
  contract. }
function BuildMaternalScreeningJson(const AN: String): Variant;
const
  SUPPLEMENT_WINDOW_MINUTES = 60;
var
  cLp, cNn: TClientDataSet;
  haveNn: Boolean;
  dtAnchor, dtNn: TDateTime;
  sSourcePk, sAssessedBy, sProtein: String;
begin
  Result := Null;
  try
    cLp := TClientDataSet.Create(nil);
    try
      cNn := TClientDataSet.Create(nil);
    except
      // M4: if the second Create raises (e.g. resource exhaustion), free
      // the first before re-raising so it doesn't leak — the outer except
      // below still catches and logs the re-raised exception.
      cLp.Free;
      raise;
    end;
    try
      // PRIMARY anchor candidate: latest partograph row.
      cLp.Data := hosxp_getdataset(
        'SELECT lp.ipt_labour_partograph_id, lp.observe_datetime, lp.entry_staff, ' +
        'lp.urine_protein, lp.fetal_heart_rate, lp.pulse ' +
        'FROM ipt_labour_partograph lp ' +
        'WHERE lp.an = ''' + AN + ''' ' +
        'ORDER BY lp.observe_datetime DESC, lp.ipt_labour_partograph_id DESC LIMIT 1');

      // I1: a partograph row can exist with a NULL observe_datetime (bad
      // data entry) — AsDateTime on a null field returns the Delphi epoch
      // (0 = 1899-12-30), which would fabricate assessed_at rather than
      // report a real observation. Require a non-null timestamp to take
      // the primary path; otherwise fall through to the nurse-note
      // fallback below exactly as if there were no partograph row at all.
      if (cLp.RecordCount > 0) and (not cLp.FieldByName('observe_datetime').IsNull) then
      begin
        // ── Primary anchor: ipt_labour_partograph ──────────────────────
        dtAnchor := cLp.FieldByName('observe_datetime').AsDateTime;
        sSourcePk := 'AN:' + AN + ':LP:' +
          vartostr(cLp.FieldByName('ipt_labour_partograph_id').AsVariant);

        Result := _obj([
          'source_pk',   sSourcePk,
          'assessed_at', ISO8601(dtAnchor)
        ]);

        if not cLp.FieldByName('entry_staff').IsNull then
        begin
          sAssessedBy := Trim(vartostr(cLp.FieldByName('entry_staff').AsVariant));
          if sAssessedBy <> '' then Result.assessed_by := sAssessedBy;
        end;

        // Raw dipstick string ("1+", "trace", "ลบ", ...) — server normalizes
        // via normalizeProteinuriaGrade; we never interpret it here.
        if not cLp.FieldByName('urine_protein').IsNull then
        begin
          sProtein := Trim(vartostr(cLp.FieldByName('urine_protein').AsVariant));
          if sProtein <> '' then Result.proteinuria_grade := sProtein;
        end;

        // 0 is a real finding (documented absent FHR) — send whenever the
        // column is non-null; never guarded by "> 0" like admission vitals.
        if not cLp.FieldByName('fetal_heart_rate').IsNull then
          Result.fetal_heart_rate_bpm := cLp.FieldByName('fetal_heart_rate').AsFloat;

        if not cLp.FieldByName('pulse').IsNull then
          Result.maternal_pulse_bpm := cLp.FieldByName('pulse').AsFloat;

        // RR / SpO2 supplement: latest nurse note, only inside the context
        // window (H1 §2) — a stale nurse note outside the window is left
        // null rather than silently mixed with a fresh partograph anchor.
        cNn.Data := hosxp_getdataset(
          'SELECT nn.nurse_note_id, nn.note_date, nn.note_time, ' +
          'nn.respiratory_rate, nn.spo2_ra, nn.spo2_o2 ' +
          'FROM ipd_nurse_note nn ' +
          'WHERE nn.an = ''' + AN + ''' ' +
          'ORDER BY nn.note_date DESC, nn.note_time DESC, nn.nurse_note_id DESC LIMIT 1');
        haveNn := cNn.RecordCount > 0;

        if haveNn and (not cNn.FieldByName('note_date').IsNull) then
        begin
          dtNn := cNn.FieldByName('note_date').AsDateTime;
          if not cNn.FieldByName('note_time').IsNull then
            dtNn := Trunc(dtNn) + Frac(cNn.FieldByName('note_time').AsDateTime);

          if MinutesBetween(dtNn, dtAnchor) <= SUPPLEMENT_WINDOW_MINUTES then
          begin
            // Extend the idempotency key so a newer nurse note (same
            // partograph anchor) registers as a new observation.
            sSourcePk := sSourcePk + ':NN:' +
              vartostr(cNn.FieldByName('nurse_note_id').AsVariant);
            Result.source_pk := sSourcePk;

            if not cNn.FieldByName('respiratory_rate').IsNull then
              Result.respiratory_rate_per_min := cNn.FieldByName('respiratory_rate').AsFloat;

            if not cNn.FieldByName('spo2_ra').IsNull then
              Result.oxygen_saturation_pct := cNn.FieldByName('spo2_ra').AsFloat
            else if not cNn.FieldByName('spo2_o2').IsNull then
              Result.oxygen_saturation_pct := cNn.FieldByName('spo2_o2').AsFloat;
          end;
        end;
      end
      else
      begin
        // ── Fallback anchor: latest ipd_nurse_note (no partograph yet) ──
        cNn.Data := hosxp_getdataset(
          'SELECT nn.nurse_note_id, nn.note_date, nn.note_time, nn.doctor_code, ' +
          'nn.pulse, nn.heart_rate, nn.respiratory_rate, nn.spo2_ra, nn.spo2_o2 ' +
          'FROM ipd_nurse_note nn ' +
          'WHERE nn.an = ''' + AN + ''' ' +
          'ORDER BY nn.note_date DESC, nn.note_time DESC, nn.nurse_note_id DESC LIMIT 1');

        if (cNn.RecordCount = 0) or cNn.FieldByName('note_date').IsNull then
        begin
          // H1 §2.3: neither anchor exists (or the only candidate row has no
          // real timestamp) — send no object at all. NEVER fabricate with Now.
          Result := Null;
          Exit;
        end;

        dtAnchor := cNn.FieldByName('note_date').AsDateTime;
        if not cNn.FieldByName('note_time').IsNull then
          dtAnchor := Trunc(dtAnchor) + Frac(cNn.FieldByName('note_time').AsDateTime);

        sSourcePk := 'AN:' + AN + ':NN:' +
          vartostr(cNn.FieldByName('nurse_note_id').AsVariant);

        Result := _obj([
          'source_pk',   sSourcePk,
          'assessed_at', ISO8601(dtAnchor)
        ]);

        if not cNn.FieldByName('doctor_code').IsNull then
        begin
          sAssessedBy := Trim(vartostr(cNn.FieldByName('doctor_code').AsVariant));
          if sAssessedBy <> '' then Result.assessed_by := sAssessedBy;
        end;

        if not cNn.FieldByName('pulse').IsNull then
          Result.maternal_pulse_bpm := cNn.FieldByName('pulse').AsFloat
        else if not cNn.FieldByName('heart_rate').IsNull then
          Result.maternal_pulse_bpm := cNn.FieldByName('heart_rate').AsFloat;

        if not cNn.FieldByName('respiratory_rate').IsNull then
          Result.respiratory_rate_per_min := cNn.FieldByName('respiratory_rate').AsFloat;

        if not cNn.FieldByName('spo2_ra').IsNull then
          Result.oxygen_saturation_pct := cNn.FieldByName('spo2_ra').AsFloat
        else if not cNn.FieldByName('spo2_o2').IsNull then
          Result.oxygen_saturation_pct := cNn.FieldByName('spo2_o2').AsFloat;

        // proteinuria_grade / fetal_heart_rate_bpm: no source on the
        // nurse-note anchor (H1 §2.2) — omitted.
      end;
    finally
      cLp.Free;
      cNn.Free;
    end;
  except
    on E: Exception do
    begin
      // A screening-build failure must NEVER break the main labor payload —
      // log and omit the object; the labor upsert proceeds without it.
      SIMain.LogWarning(Format('%s MaternalScreening: build failed for an=%s: %s: %s — omitting object',
        [LOG_TAG, AN, E.ClassName, E.Message]));
      Result := Null;
    end;
  end;
end;

function BuildLabourPatient(Q: TClientDataSet; const Action: String): Variant;
var
  age: Integer;
  dtAdmit: TDateTime;
  f: TField;
  sStation: String;
  msObj: Variant;
begin
  age := CalcAge(Q.FieldByName('birthday').AsDateTime);

  // SPEC: admit_date should combine regdate + regtime (HOSxP stores separately)
  dtAdmit := Q.FieldByName('regdate').AsDateTime;
  if not Q.FieldByName('regtime').IsNull then
    dtAdmit := Trunc(dtAdmit) + Frac(Q.FieldByName('regtime').AsDateTime);

  Result := _obj([
    'hn',         vartostr(Q.FieldByName('hn').AsVariant),
    'an',         vartostr(Q.FieldByName('an').AsVariant),
    'name',       vartostr(Q.FieldByName('patient_name').AsVariant),
    'cid',        vartostr(Q.FieldByName('cid').AsVariant),
    'age',        age,
    'admit_date', ISO8601(dtAdmit)
  ]);

  if Action = 'delete' then
  begin
    Result.action := 'delete';
    Exit;
  end;

  // Labor status based on discharge date
  if Q.FieldByName('dchdate').IsNull then
    Result.labor_status := 'ACTIVE'
  else
    Result.labor_status := 'DELIVERED';

  // Obstetric formula G_P_A_L
  if not Q.FieldByName('gravida').IsNull then
    Result.gravida := Q.FieldByName('gravida').AsInteger;
  f := FldOrNil(Q, 'para');
  if (f <> nil) and (not f.IsNull) then Result.para := f.AsInteger;
  f := FldOrNil(Q, 'abortion');
  if (f <> nil) and (not f.IsNull) then Result.abortion := f.AsInteger;
  f := FldOrNil(Q, 'living_children');
  if (f <> nil) and (not f.IsNull) then Result.living_children := f.AsInteger;
  f := FldOrNil(Q, 'preg_no');
  if (f <> nil) and (not f.IsNull) then Result.preg_no := f.AsInteger;

  // Gestational age (weeks + days)
  if not Q.FieldByName('ga_weeks').IsNull then
    Result.ga_weeks := Q.FieldByName('ga_weeks').AsInteger;
  f := FldOrNil(Q, 'ga_day');
  if (f <> nil) and (not f.IsNull) then Result.ga_day := f.AsInteger;

  if not Q.FieldByName('anc_count').IsNull then
    Result.anc_count := Q.FieldByName('anc_count').AsInteger;

  // Anthropometry
  if not Q.FieldByName('height').IsNull then
    Result.height_cm := Round(Q.FieldByName('height').AsFloat);
  if not Q.FieldByName('weight').IsNull then
    Result.weight_kg := Round(Q.FieldByName('weight').AsFloat);
  f := FldOrNil(Q, 'pre_preg_weight');
  if (f <> nil) and (not f.IsNull) and (f.AsFloat > 0) then
    Result.pre_pregnancy_weight_kg := Round(f.AsFloat);

  if not Q.FieldByName('hct').IsNull then
    Result.hematocrit_pct := Q.FieldByName('hct').AsFloat;

  // Admission vital signs (one-shot snapshot, not partograph)
  f := FldOrNil(Q, 'bp_sys_admit');
  if (f <> nil) and (not f.IsNull) and (f.AsFloat > 0) then
    Result.bp_systolic_admit := Round(f.AsFloat);
  f := FldOrNil(Q, 'bp_dia_admit');
  if (f <> nil) and (not f.IsNull) and (f.AsFloat > 0) then
    Result.bp_diastolic_admit := Round(f.AsFloat);
  f := FldOrNil(Q, 'pulse_admit');
  if (f <> nil) and (not f.IsNull) and (f.AsInteger > 0) then
    Result.pulse_admit := f.AsInteger;
  f := FldOrNil(Q, 'rr_admit');
  if (f <> nil) and (not f.IsNull) and (f.AsInteger > 0) then
    Result.rr_admit := f.AsInteger;
  f := FldOrNil(Q, 'temp_admit');
  if (f <> nil) and (not f.IsNull) and (f.AsFloat > 0) then
    Result.temperature_admit := f.AsFloat;

  // Cervical exam at admission
  f := FldOrNil(Q, 'cervical_open_size');
  if (f <> nil) and (not f.IsNull) then
    Result.cervical_open_cm_admit := f.AsFloat;
  f := FldOrNil(Q, 'eff');
  if (f <> nil) and (not f.IsNull) then
    Result.effacement_pct_admit := f.AsFloat;
  f := FldOrNil(Q, 'station');
  if f <> nil then
  begin
    sStation := Trim(f.AsString);
    if sStation <> '' then Result.station_admit := sStation;
  end;

  // Optional maternal_screening object (H2) — off by default; see
  // KKLRMS_SEND_MATERNAL_SCREENING. Never attached on a 'delete' action (we
  // already Exit'ed above for that case) and never allowed to break this
  // payload on failure — BuildMaternalScreeningJson catches its own errors
  // and returns Null, in which case we simply omit the key.
  if KKLRMS_SEND_MATERNAL_SCREENING then
  begin
    msObj := BuildMaternalScreeningJson(vartostr(Q.FieldByName('an').AsVariant));
    if not VarIsNull(msObj) then
      Result.maternal_screening := msObj;
  end;
end;

function SendKKLRMSLabourData(const AN: String; const Action: String): Variant;
var
  apiKey, hc, sHN, sName, sCID, sStatus: String;
  cds: TClientDataSet;
  payload: Variant;
begin
  Result := Null;
  if not GetConfig(apiKey, hc) then Exit;

  cds := TClientDataSet.Create(nil);
  try
    cds.Data := hosxp_getdataset(SQL_LABOUR + 'WHERE i.an = ''' + AN + '''');
    if cds.RecordCount = 0 then
    begin
      SIMain.LogWarning(Format('%s Labour: No ipt/patient row for an=%s action=%s — skipped',
        [LOG_TAG, AN, Action]));
      Exit;
    end;

    sHN   := Trim(vartostr(cds.FieldByName('hn').AsVariant));
    sName := Trim(vartostr(cds.FieldByName('patient_name').AsVariant));
    sCID  := vartostr(cds.FieldByName('cid').AsVariant);
    if cds.FieldByName('dchdate').IsNull then sStatus := 'ACTIVE' else sStatus := 'DELIVERED';

    // Server requires non-empty hn / name (validatePayload returns 400 with
    // "<field> is required"). vartostr(NullVariant) is '', so guard locally
    // with a clear reason rather than waste an HTTP round-trip per bad row.
    if (Action <> 'delete') and (sHN = '') then
    begin
      SIMain.LogWarning(Format('%s Labour: hn is empty for an=%s — skipped (server rejects empty hn)',
        [LOG_TAG, AN]));
      Exit;
    end;
    if (Action <> 'delete') and (sName = '') then
    begin
      SIMain.LogWarning(Format('%s Labour: patient_name is empty for an=%s hn=%s — skipped (server rejects empty name)',
        [LOG_TAG, AN, sHN]));
      Exit;
    end;
    // regdate=null → dtAdmit=1899-12-30 — server's `new Date()` accepts it but
    // the row is clinically meaningless. Drop early instead of polluting cache.
    if (Action <> 'delete') and cds.FieldByName('regdate').IsNull then
    begin
      SIMain.LogWarning(Format('%s Labour: regdate is null for an=%s hn=%s — skipped (no admit date)',
        [LOG_TAG, AN, sHN]));
      Exit;
    end;
    // birthday=null → CalcAge returns 0 — sending age=0 corrupts CPD risk scoring.
    if (Action <> 'delete') and cds.FieldByName('birthday').IsNull then
    begin
      SIMain.LogWarning(Format('%s Labour: birthday is null for an=%s hn=%s — skipped (cannot compute age)',
        [LOG_TAG, AN, sHN]));
      Exit;
    end;

    // Server rejects entire payload (400) on any non-13-digit CID. Skip locally
    // with a clear log so a bad patient.cid doesn't poison every send for this an.
    // Allowed exception: action='delete' still fires — the dashboard may need to
    // remove a previously-sent stale row whose CID we never validated before.
    if (Action <> 'delete') and (not IsValidCID13(sCID)) then
    begin
      SIMain.LogWarning(Format('%s Labour: invalid CID "%s" for an=%s hn=%s name="%s" — must be 13 digits, skipped',
        [LOG_TAG, sCID, AN, sHN, sName]));
      Exit;
    end;

    payload := _obj([
      'hospitalCode', hc,
      'mode',         'incremental',
      'patients',     _arr([BuildLabourPatient(cds, Action)])
    ]);

    SIMain.LogMessage(Format('%s Labour send: an=%s hn=%s name="%s" status=%s action=%s hosp=%s',
      [LOG_TAG, AN, sHN, sName, sStatus, Action, hc]));
    Result := PostWebhook(payload, apiKey, 'labour:' + Action + ':' + AN);
  finally
    cds.Free;
  end;
end;

function SendKKLRMSLabourSnapshot: Variant;
const
  CHUNK_SIZE = 100; // server cap: payloads with >100 patients return 400
var
  apiKey, hc, sCID, modeStr: String;
  cds: TClientDataSet;
  payload, chunkPatients: Variant;
  rawCount, activeCount, deliveredCount, invalidCount, sentCount: Integer;
  chunkIdx, chunkRows: Integer;
  isOverCap: Boolean;

  procedure FlushChunk;
  begin
    if chunkRows = 0 then Exit;
    payload := _obj([
      'hospitalCode', hc,
      'mode',         modeStr,
      'patients',     chunkPatients
    ]);
    Inc(chunkIdx);
    Result := PostWebhook(payload, apiKey,
      Format('labour:snapshot:chunk%d:%d', [chunkIdx, chunkRows]));
    Inc(sentCount, chunkRows);
    chunkPatients := _arr([]);
    chunkRows := 0;
  end;

begin
  Result := Null;
  if not GetConfig(apiKey, hc) then Exit;

  cds := TClientDataSet.Create(nil);
  try
    // Active pregnancy admissions (ipt_admit_type_id = 3)
    cds.Data := hosxp_getdataset(SQL_LABOUR +
      'WHERE i.dchdate IS NULL AND i.ipt_admit_type_id = 3');

    rawCount := cds.RecordCount;
    // SPEC: server rejects empty patients array with 400.
    // Skip the call locally to avoid useless error in the log.
    if rawCount = 0 then
    begin
      SIMain.LogMessage(Format('%s Snapshot: no active labour admissions at hosp=%s — nothing to send',
        [LOG_TAG, hc]));
      Exit;
    end;

    // full_snapshot semantics (auto-discharge of patients NOT in payload) only
    // make sense when the WHOLE list fits in one request. Above the cap we
    // chunk as 'incremental' — every patient is upserted but no auto-discharge
    // happens this cycle (callers must handle that via individual delete events
    // or a later snapshot when the count drops below the cap).
    isOverCap := rawCount > CHUNK_SIZE;
    if isOverCap then
    begin
      modeStr := 'incremental';
      SIMain.LogWarning(Format('%s Snapshot: %d active admissions exceeds server cap (%d) — chunking as INCREMENTAL upserts; auto-discharge will NOT occur this cycle',
        [LOG_TAG, rawCount, CHUNK_SIZE]));
    end
    else
      modeStr := 'full_snapshot';

    chunkPatients  := _arr([]);
    activeCount    := 0;
    deliveredCount := 0;
    invalidCount   := 0;
    sentCount      := 0;
    chunkIdx       := 0;
    chunkRows      := 0;

    cds.First;
    while not cds.Eof do
    begin
      sCID := vartostr(cds.FieldByName('cid').AsVariant);
      // Snapshot rejects whole batch on a single bad row — apply ALL guards
      // applied by SendKKLRMSLabourData to keep parity with the per-patient path.
      if not IsValidCID13(sCID) then
      begin
        Inc(invalidCount);
        SIMain.LogWarning(Format('%s Snapshot: skip an=%s hn=%s — invalid CID "%s" (must be 13 digits)',
          [LOG_TAG, vartostr(cds.FieldByName('an').AsVariant),
                    vartostr(cds.FieldByName('hn').AsVariant), sCID]));
        cds.Next;
        Continue;
      end;
      if Trim(vartostr(cds.FieldByName('hn').AsVariant)) = '' then
      begin
        Inc(invalidCount);
        SIMain.LogWarning(Format('%s Snapshot: skip an=%s — hn is empty',
          [LOG_TAG, vartostr(cds.FieldByName('an').AsVariant)]));
        cds.Next;
        Continue;
      end;
      if Trim(vartostr(cds.FieldByName('patient_name').AsVariant)) = '' then
      begin
        Inc(invalidCount);
        SIMain.LogWarning(Format('%s Snapshot: skip an=%s hn=%s — patient_name is empty',
          [LOG_TAG, vartostr(cds.FieldByName('an').AsVariant),
                    vartostr(cds.FieldByName('hn').AsVariant)]));
        cds.Next;
        Continue;
      end;
      if cds.FieldByName('regdate').IsNull then
      begin
        Inc(invalidCount);
        SIMain.LogWarning(Format('%s Snapshot: skip an=%s hn=%s — regdate is null',
          [LOG_TAG, vartostr(cds.FieldByName('an').AsVariant),
                    vartostr(cds.FieldByName('hn').AsVariant)]));
        cds.Next;
        Continue;
      end;
      if cds.FieldByName('birthday').IsNull then
      begin
        Inc(invalidCount);
        SIMain.LogWarning(Format('%s Snapshot: skip an=%s hn=%s — birthday is null (cannot compute age)',
          [LOG_TAG, vartostr(cds.FieldByName('an').AsVariant),
                    vartostr(cds.FieldByName('hn').AsVariant)]));
        cds.Next;
        Continue;
      end;

      if cds.FieldByName('dchdate').IsNull then
        Inc(activeCount)
      else
        Inc(deliveredCount);

      DocVariantData(chunkPatients)^.AddItem(BuildLabourPatient(cds, ''));
      Inc(chunkRows);

      if chunkRows >= CHUNK_SIZE then
        FlushChunk;

      cds.Next;
    end;

    // Tail flush. If we never accumulated any valid rows, sentCount stays 0.
    if chunkRows > 0 then
      FlushChunk;

    if sentCount = 0 then
    begin
      SIMain.LogWarning(Format('%s Snapshot: %d rows fetched but %d had invalid CID — nothing sent',
        [LOG_TAG, rawCount, invalidCount]));
      Exit;
    end;

    SIMain.LogMessage(Format('%s Snapshot: total=%d (active=%d, delivered=%d, invalid_cid=%d) sent=%d in %d chunk(s) mode=%s hosp=%s',
      [LOG_TAG, rawCount, activeCount, deliveredCount, invalidCount, sentCount, chunkIdx, modeStr, hc]));
  finally
    cds.Free;
  end;
end;

{ ── ANC ────────────────────────────────────────────────────────────────────── }

{  HOSxP Table Mapping:
     person_anc         : person_anc_id, preg_no, lmp, edc,
                          blood_vdrl1/2_result, blood_hiv1/2_result
     person             : pname, fname, lname, cid, birthdate (aliased birthday)
     patient            : hn, chwpart, amppart, tmbpart (joined via cid)
     person_anc_service : anc_service_date, anc_service_number, pa_week
     person_anc_screen  : bw, bps, bpd, baby_fetal_heart_sound,
                          albumin (urine protein), sugar (urine glucose),
                          anc_baby_position_id, anc_baby_lead_id
                          (joined via person_anc_service_id)
     person_anc_lab     : per-visit lab results (joined via person_anc_service_id)
                          anc_lab_id=6 -> HCT (%); anc_lab_id=8 -> Hb (g/dL)
     anc_baby_position  : anc_baby_position_name (presentation)
     anc_baby_lead      : anc_baby_lead_name     (engagement)
     person_anc_classifying      : check_value='Y' per item
     person_anc_classifying_item : person_anc_classifying_type_id (1-3)
   Risk Level Mapping (Khon Kaen criteria, per-item not per-type):
     HR3: 15,16,17,18  (ไต, หัวใจ, ยาเสพติด, อายุรกรรม)
     HR2: 4,6,10,12,13,14  (>4000g, ผ่าตัด, Rh-, ก้อน, BP>90, เบาหวาน)
     HR1: 1,2,3,5,7,8,9,11 (ทารกตาย, แท้ง, <2500g, ครรภ์พิษ, แฝด, <17/>35, เลือดออก)
     (none checked)    -> LOW                                                  }

function GetANCRiskLevel(const PersonANCID: Integer): String;
var
  maxLevel: Integer;
  cds: TClientDataSet;
  itemId, level: Integer;
begin
  // Map each checked person_anc_classifying_item to KK-LRMS 4-tier risk
  // Based on: เกณฑ์คัดกรองหญิงตั้งครรภ์ตามความเสี่ยง จ.ขอนแก่น
  maxLevel := 0;
  cds := TClientDataSet.Create(nil);
  try
    cds.Data := hosxp_getdataset(
      'SELECT c.person_anc_classifying_item_id ' +
      'FROM person_anc_classifying c ' +
      'WHERE c.person_anc_id = ' + IntToStr(PersonANCID) + ' ' +
      'AND c.check_value = ''Y''');

    cds.First;
    while not cds.Eof do
    begin
      itemId := cds.FieldByName('person_anc_classifying_item_id').AsInteger;
      case itemId of
        // HR1: ประวัติทารกตายในครรภ์, ประวัติครรภ์เป็นพิษ, เลือดออกทางช่องคลอด,
        //      อายุ <17 / ≥35, ครรภ์แฝด (DCDA only -> HR1 baseline)
        1,          // เคยมีทารกตายในครรภ์
        2,          // เคยแท้งเอง 3 ครั้งขึ้นไป
        3,          // เคยคลอดบุตร น.น. < 2500 g
        5,          // เคยครรภ์เป็นพิษ
        7,          // ครรภ์แฝด
        8,          // อายุ < 17
        9,          // อายุ > 35
        11:         // เลือดออกทางช่องคลอด
          level := 1;
        // HR2: เคยคลอดบุตร >4000g, เคยผ่าตัดคลอด, ความดัน Diastolic >90,
        //      Rh Negative, ก้อนในอุ้งเชิงกราน, เบาหวาน
        4,          // เคยคลอดบุตร น.น. > 4000 g
        6,          // เคยผ่าตัดคลอด/ผ่าตัดมดลูก
        10,         // Rh Negative
        12,         // ก้อนในอุ้งเชิงกราน
        13,         // ความดัน Diastolic > 90
        14:         // เบาหวาน
          level := 2;
        // HR3: โรคไต, โรคหัวใจ, ติดยาเสพติด, โรคอายุรกรรม (SLE/โลหิตจาง/ไทรอยด์)
        15,         // โรคไต
        16,         // โรคหัวใจ
        17,         // ติดยาเสพติด/สุรา
        18:         // โรคอายุรกรรม (โลหิตจาง/ไทรอยด์/SLE)
          level := 3;
      else
        level := 1; // unknown item -> HR1 as safe default
      end;
      if level > maxLevel then
        maxLevel := level;
      cds.Next;
    end;
  finally
    cds.Free;
  end;

  case maxLevel of
    1: Result := 'HR1';
    2: Result := 'HR2';
    3: Result := 'HR3';
  else
    Result := 'LOW';
  end;
end;

function SendKKLRMSANCData(const PersonANCID: Integer; const Action: String): Variant;
var
  apiKey, hc, sql, sHN, sCID, sName, sRisk, sLab: String;
  cdm, cdv: TClientDataSet;
  payload, pv, visits, vv: Variant;
  f: TField;
  fLab: Double;
begin
  Result := Null;
  if not GetConfig(apiKey, hc) then Exit;

  cdm := TClientDataSet.Create(nil);
  cdv := TClientDataSet.Create(nil);
  try
    // Master: person_anc + person + patient (cid, GIS address from patient)
    // person has birthdate (not birthday); chwpart/amppart/tmbpart exist only on patient
    // VDRL/HIV are stored as round-1/round-2 columns; latest non-empty wins below
    sql := 'SELECT pa.person_anc_id, pa.preg_no, pa.lmp, pa.edc, ' +
           'pa.blood_vdrl1_result, pa.blood_vdrl2_result, ' +
           'pa.blood_hiv1_result, pa.blood_hiv2_result, ' +
           'pt.hn, ' +
           'CONCAT(pe.pname, pe.fname, '' '', pe.lname) AS patient_name, ' +
           'pe.cid, pe.birthdate AS birthday, ' +
           'pt.chwpart, pt.amppart, pt.tmbpart ' +
           'FROM person_anc pa ' +
           'INNER JOIN person pe ON pe.person_id = pa.person_id ' +
           'LEFT JOIN patient pt ON pt.cid = pe.cid AND LENGTH(pe.cid) = 13 ' +
           'WHERE pa.person_anc_id = ' + IntToStr(PersonANCID);

    cdm.Data := hosxp_getdataset(sql);
    if cdm.RecordCount = 0 then
    begin
      SIMain.LogWarning(Format('%s ANC: No person_anc row for person_anc_id=%d action=%s — skipped',
        [LOG_TAG, PersonANCID, Action]));
      Exit;
    end;

    sCID  := vartostr(cdm.FieldByName('cid').AsVariant);
    sName := vartostr(cdm.FieldByName('patient_name').AsVariant);

    // Build patient object with required fields (cid required since v2.2).
    // SPEC v2.5: hn is string|null — send Null explicitly when the person has no
    // patient row (community-registered ANC). Server falls back to CID hash match.
    pv := _obj([
      'name',     sName,
      'cid',      sCID,
      'birthday', ISODate(cdm.FieldByName('birthday').AsDateTime),
      'pregNo',   cdm.FieldByName('preg_no').AsInteger
    ]);
    if cdm.FieldByName('hn').IsNull then
    begin
      pv.hn := Null;
      sHN := '(null)';
    end
    else
    begin
      sHN := vartostr(cdm.FieldByName('hn').AsVariant);
      pv.hn := sHN;
    end;

    // Delete: only required fields needed
    if Action = 'delete' then
    begin
      pv.action := 'delete';
      payload := _obj([
        'type',         'anc_data',
        'hospitalCode', hc,
        'patients',     _arr([pv])
      ]);
      SIMain.LogMessage(Format('%s ANC DELETE: person_anc_id=%d hn=%s cid=%s name="%s"',
        [LOG_TAG, PersonANCID, sHN, sCID, sName]));
      Result := PostWebhook(payload, apiKey,
        Format('anc:delete:%d', [PersonANCID]));
      Exit;
    end;

    // Optional pregnancy fields
    if not cdm.FieldByName('lmp').IsNull then
      pv.lmp := ISODate(cdm.FieldByName('lmp').AsDateTime);
    if not cdm.FieldByName('edc').IsNull then
      pv.edc := ISODate(cdm.FieldByName('edc').AsDateTime);

    // GIS address fields (person.chwpart/amppart/tmbpart)
    if not cdm.FieldByName('chwpart').IsNull then
      pv.changwatCode := vartostr(cdm.FieldByName('chwpart').AsVariant);
    if not cdm.FieldByName('amppart').IsNull then
      pv.amphurCode := vartostr(cdm.FieldByName('amppart').AsVariant);
    if not cdm.FieldByName('tmbpart').IsNull then
      pv.tambonCode := vartostr(cdm.FieldByName('tmbpart').AsVariant);

    // Risk level: auto-query from person_anc_classifying
    sRisk := GetANCRiskLevel(PersonANCID);
    pv.riskLevel := sRisk;

    // Patient-level VDRL / HIV — pick latest non-empty between round 1 and round 2.
    // HOSxP stores varchar codes ("Pos"/"Neg"/"-"/etc.); server is shape-only here
    // and passes the string through to the dashboard CDSS for interpretation.
    sLab := LatestLab(
      vartostr(cdm.FieldByName('blood_vdrl1_result').AsVariant),
      vartostr(cdm.FieldByName('blood_vdrl2_result').AsVariant));
    if sLab <> '' then pv.vdrlResult := sLab;
    sLab := LatestLab(
      vartostr(cdm.FieldByName('blood_hiv1_result').AsVariant),
      vartostr(cdm.FieldByName('blood_hiv2_result').AsVariant));
    if sLab <> '' then pv.hivResult := sLab;

    // ANC visit records — vitals live in person_anc_screen, lab results (HCT/Hb)
    // live in person_anc_lab; both join via person_anc_service_id. Position /
    // engagement are int FKs into anc_baby_position / anc_baby_lead — we resolve
    // the *_name (varchar) here so the payload carries human strings, not IDs.
    // person_anc_lab has at most one row per (service, lab) so the per-visit row
    // count stays 1:1 with the service row.
    sql := 'SELECT s.anc_service_date, s.anc_service_number, s.pa_week, ' +
           'sc.bw, sc.bps, sc.bpd, sc.baby_fetal_heart_sound, ' +
           'sc.albumin, sc.sugar, ' +
           'bp.anc_baby_position_name AS presentation_name, ' +
           'bl.anc_baby_lead_name     AS engagement_name, ' +
           'plh.anc_lab_result AS hct_result, ' +
           'plb.anc_lab_result AS hb_result ' +
           'FROM person_anc_service s ' +
           'LEFT JOIN person_anc_screen sc ON sc.person_anc_service_id = s.person_anc_service_id ' +
           'LEFT JOIN anc_baby_position bp ON bp.anc_baby_position_id = sc.anc_baby_position_id ' +
           'LEFT JOIN anc_baby_lead     bl ON bl.anc_baby_lead_id     = sc.anc_baby_lead_id ' +
           'LEFT JOIN person_anc_lab    plh ON plh.person_anc_service_id = s.person_anc_service_id AND plh.anc_lab_id = 6 ' +
           'LEFT JOIN person_anc_lab    plb ON plb.person_anc_service_id = s.person_anc_service_id AND plb.anc_lab_id = 8 ' +
           'WHERE s.person_anc_id = ' + IntToStr(PersonANCID) + ' ' +
           'ORDER BY s.anc_service_number';

    cdv.Data := hosxp_getdataset(sql);

    if cdv.RecordCount > 0 then
    begin
      visits := _arr([]);
      cdv.First;
      while not cdv.Eof do
      begin
        vv := _obj([
          'date',        ISODate(cdv.FieldByName('anc_service_date').AsDateTime),
          'visitNumber', cdv.FieldByName('anc_service_number').AsInteger
        ]);

        f := cdv.FindField('pa_week');
        if (f <> nil) and (not f.IsNull) then vv.gaWeeks := f.AsInteger;

        f := cdv.FindField('bw');
        if (f <> nil) and (not f.IsNull) then vv.weightKg := f.AsFloat;

        f := cdv.FindField('bps');
        if (f <> nil) and (not f.IsNull) then vv.bpSystolic := f.AsInteger;

        f := cdv.FindField('bpd');
        if (f <> nil) and (not f.IsNull) then vv.bpDiastolic := f.AsInteger;

        f := cdv.FindField('baby_fetal_heart_sound');
        if (f <> nil) and (not f.IsNull) then vv.fetalHr := f.AsInteger;

        // Per-visit HCT (anc_lab_id=6). Strings often come in as "34" or "34%";
        // ParseLabFloat strips the percent sign and returns False on garbage so
        // we omit the field rather than send 0.
        if ParseLabFloat(vartostr(cdv.FieldByName('hct_result').AsVariant), fLab) then
          vv.hctPct := fLab;

        // Per-visit Hb (anc_lab_id=8) — g/dL.
        if ParseLabFloat(vartostr(cdv.FieldByName('hb_result').AsVariant), fLab) then
          vv.hbGDl := fLab;

        // Urine dipstick — pass HOSxP's Thai/symbolic strings ("ปกติ", "+1",
        // "Trace") straight through; server stores as-is.
        f := cdv.FindField('albumin');
        if (f <> nil) and (Trim(f.AsString) <> '') then vv.urineProtein := Trim(f.AsString);
        f := cdv.FindField('sugar');
        if (f <> nil) and (Trim(f.AsString) <> '') then vv.urineGlucose := Trim(f.AsString);

        // Fetal presentation / engagement — looked-up names from the FK tables.
        f := cdv.FindField('presentation_name');
        if (f <> nil) and (Trim(f.AsString) <> '') then vv.presentation := Trim(f.AsString);
        f := cdv.FindField('engagement_name');
        if (f <> nil) and (Trim(f.AsString) <> '') then vv.engagement := Trim(f.AsString);

        DocVariantData(visits)^.AddItem(vv);
        cdv.Next;
      end;
      pv.visits := visits;
    end;

    payload := _obj([
      'type',         'anc_data',
      'hospitalCode', hc,
      'patients',     _arr([pv])
    ]);

    SIMain.LogMessage(Format('%s ANC send: person_anc_id=%d hn=%s cid=%s name="%s" pregNo=%d risk=%s visits=%d action=%s',
      [LOG_TAG, PersonANCID, sHN, sCID, sName,
       cdm.FieldByName('preg_no').AsInteger, sRisk, cdv.RecordCount, Action]));
    Result := PostWebhook(payload, apiKey,
      Format('anc:%s:%d', [Action, PersonANCID]));
  finally
    cdm.Free;
    cdv.Free;
  end;
end;

{ ── Referral ───────────────────────────────────────────────────────────────── }

{  Two-Hospital Workflow:
     รพ.ต้นทาง (sender)   → type:"referral"        → CREATE referral
     รพ.ปลายทาง (receiver) → type:"referral_update"  → ACCEPT/REJECT/TRANSIT/ARRIVE

   HOSxP Table Mapping (sender side):
     referout : referout_id, refer_number, hn, refer_hospcode, pdx,
                pre_diagnosis, referout_emergency_type_id, refer_date
     referout_emergency_type : 1=Life threatening, 2=Emergency, 3=Urgent, 4=Acute, 5=Non acute
     patient  : pname, fname, lname, cid
   HOSxP Table Mapping (receiver side):
     referin  : vn(PK), refer_hospcode (=sender HCODE), referout_number (=sender ref#),
                date_in, refer_date, refer_time
     ovst     : vstdate, vsttime (arrival time at receiving hospital)

   Status Flow:
     INITIATED → ACCEPTED → IN_TRANSIT → ARRIVED
              → REJECTED

   Eligibility Check:
     POST /api/referrals/check   cid   → canRefer, reason, patient info
     Server checks: pregnancy status, delivery, active referrals             }

function SendKKLRMSReferralCreate(const ReferoutID: Integer;
  const Action: String): Variant;
var
  apiKey, hc, sql, sCID, sHN, sName, sRefNum, sToHosp, sUrgency, sReason: String;
  cds: TClientDataSet;
  payload, checkResult: Variant;
begin
  Result := Null;
  if not GetConfig(apiKey, hc) then Exit;

  cds := TClientDataSet.Create(nil);
  try
    sql := 'SELECT r.referout_id, r.refer_number, r.hn, r.refer_hospcode, ' +
           'r.pdx, r.pre_diagnosis, r.diagnosis_text, r.referout_emergency_type_id, ' +
           'r.refer_date, r.refer_time, ' +
           'CONCAT(p.pname, p.fname, '' '', p.lname) AS patient_name, ' +
           'p.cid, p.chwpart, p.amppart, p.tmbpart ' +
           'FROM referout r ' +
           'INNER JOIN patient p ON p.hn = r.hn ' +
           'WHERE r.referout_id = ' + IntToStr(ReferoutID);

    cds.Data := hosxp_getdataset(sql);
    if cds.RecordCount = 0 then
    begin
      SIMain.LogWarning(Format('%s Referral Create: No referout row for referout_id=%d action=%s — skipped',
        [LOG_TAG, ReferoutID, Action]));
      Exit;
    end;

    sRefNum := vartostr(cds.FieldByName('refer_number').AsVariant);
    sHN     := vartostr(cds.FieldByName('hn').AsVariant);
    sCID    := vartostr(cds.FieldByName('cid').AsVariant);
    sName   := vartostr(cds.FieldByName('patient_name').AsVariant);
    sToHosp := vartostr(cds.FieldByName('refer_hospcode').AsVariant);

    // SPEC: reason is required for non-delete (server returns 400 if empty).
    // Fall back pre_diagnosis -> diagnosis_text -> pdx -> generic.
    sReason := vartostr(cds.FieldByName('pre_diagnosis').AsVariant);
    if sReason = '' then
      sReason := vartostr(cds.FieldByName('diagnosis_text').AsVariant);
    if sReason = '' then
      sReason := vartostr(cds.FieldByName('pdx').AsVariant);
    if sReason = '' then
      sReason := 'ส่งต่อเพื่อรักษา';

    // Eligibility check via server API (skip for delete)
    if Action <> 'delete' then
    begin
      checkResult := CheckKKLRMSReferralEligibility(sCID);
      if not VarIsNull(checkResult) and checkResult.exists('canRefer') then
      begin
        if checkResult.canRefer = False then
        begin
          SIMain.LogMessage(Format('%s Referral SKIPPED (ineligible): refNo=%s hn=%s cid=%s name="%s" reason=%s',
            [LOG_TAG, sRefNum, sHN, sCID, sName, vartostr(checkResult.reason)]));
          Exit;
        end;
      end
      else
        SIMain.LogWarning(Format('%s Referral: eligibility API unavailable for cid=%s — proceeding (server will validate)',
          [LOG_TAG, sCID]));
    end;

    payload := _obj([
      'type',             'referral',
      'hospitalCode',     hc,
      'referralId',       sRefNum,
      'hn',               sHN,
      'cid',              sCID,
      'name',             sName,
      'toHospitalCode',   sToHosp,
      'reason',           sReason
    ]);

    // diagnosisCode: omit empty per SPEC — referout.pdx is often "" in HOSxP
    if (not cds.FieldByName('pdx').IsNull)
       and (vartostr(cds.FieldByName('pdx').AsVariant) <> '') then
      payload.diagnosisCode := vartostr(cds.FieldByName('pdx').AsVariant);

    // Urgency mapping from referout_emergency_type.
    // NOTE: WEBHOOK-SPEC v2.5 table (null/1→ROUTINE, 2→URGENT, 3→EMERGENCY) assumes a
    // 3-tier HOSxP. This hospital uses the 5-tier variant with OPPOSITE severity order:
    //   1=Life threatening, 2=Emergency, 3=Urgent, 4=Acute, 5=Non acute.
    // Following SPEC literally would mark "Life threatening" as ROUTINE — clinically
    // unsafe. We map by clinical severity instead:
    //   1,2 -> EMERGENCY   (Life threatening, Emergency)
    //   3,4 -> URGENT      (Urgent, Acute)
    //   5/null -> ROUTINE  (Non acute / field unused)
    if not cds.FieldByName('referout_emergency_type_id').IsNull then
      case cds.FieldByName('referout_emergency_type_id').AsInteger of
        1, 2: sUrgency := 'EMERGENCY';
        3, 4: sUrgency := 'URGENT';
      else
        sUrgency := 'ROUTINE';
      end
    else
      sUrgency := 'ROUTINE';
    payload.urgencyLevel := sUrgency;

    // GIS address fields (patient.chwpart/amppart/tmbpart → DOPA 6-digit code)
    if not cds.FieldByName('chwpart').IsNull then
      payload.changwatCode := vartostr(cds.FieldByName('chwpart').AsVariant);
    if not cds.FieldByName('amppart').IsNull then
      payload.amphurCode := vartostr(cds.FieldByName('amppart').AsVariant);
    if not cds.FieldByName('tmbpart').IsNull then
      payload.tambonCode := vartostr(cds.FieldByName('tmbpart').AsVariant);

    if Action = 'delete' then
      payload.action := 'delete';

    SIMain.LogMessage(Format('%s Referral Create: refNo=%s from=%s to=%s hn=%s cid=%s name="%s" urgency=%s action=%s',
      [LOG_TAG, sRefNum, hc, sToHosp, sHN, sCID, sName, sUrgency, Action]));
    Result := PostWebhook(payload, apiKey,
      Format('referral:%s:%s', [Action, sRefNum]));
  finally
    cds.Free;
  end;
end;

function SendKKLRMSReferralUpdate(const ReferinVN: String;
  const Status: String; const Reason: String; const TransportMode: String;
  const Action: String): Variant;
var
  apiKey, hc, sql: String;
  cds: TClientDataSet;
  payload: Variant;
  sReferralId, sFromHosp, sArrived: String;
  dtArrived: TDateTime;
begin
  Result := Null;
  if not GetConfig(apiKey, hc) then Exit;

  cds := TClientDataSet.Create(nil);
  try
    // Read referin record: sender's refer_hospcode + referral number + arrival date
    sql := 'SELECT ri.vn, ri.refer_hospcode, ri.referout_number, ' +
           'ri.date_in, o.vstdate, o.vsttime ' +
           'FROM referin ri ' +
           'LEFT JOIN ovst o ON o.vn = ri.vn ' +
           'WHERE ri.vn = ''' + ReferinVN + '''';

    cds.Data := hosxp_getdataset(sql);
    if cds.RecordCount = 0 then
    begin
      SIMain.LogWarning(Format('%s Referral Update: No referin row for vn=%s status=%s — skipped',
        [LOG_TAG, ReferinVN, Status]));
      Exit;
    end;

    sFromHosp   := vartostr(cds.FieldByName('refer_hospcode').AsVariant);
    sReferralId := vartostr(cds.FieldByName('referout_number').AsVariant);

    if sReferralId = '' then
    begin
      SIMain.LogWarning(Format('%s Referral Update: referin.referout_number empty for vn=%s from=%s status=%s — cannot correlate, skipped',
        [LOG_TAG, ReferinVN, sFromHosp, Status]));
      Exit;
    end;

    payload := _obj([
      'type',             'referral_update',
      'hospitalCode',     hc,
      'referralId',       sReferralId,
      'fromHospitalCode', sFromHosp
    ]);

    sArrived := '';
    if Action = 'delete' then
      payload.action := 'delete'
    else
    begin
      payload.status := Status;
      if Reason <> '' then
      begin
        if Status = 'REJECTED' then
          payload.rejectionReason := Reason
        else
          payload.reason := Reason;
      end;
      if TransportMode <> '' then
        payload.transportMode := TransportMode;

      // ARRIVED: use date_in from referin, fallback to vstdate+vsttime
      if Status = 'ARRIVED' then
      begin
        if not cds.FieldByName('date_in').IsNull then
          dtArrived := cds.FieldByName('date_in').AsDateTime
        else if not cds.FieldByName('vstdate').IsNull then
          dtArrived := cds.FieldByName('vstdate').AsDateTime
        else
          dtArrived := Now;

        if not cds.FieldByName('vsttime').IsNull then
          dtArrived := Trunc(dtArrived) + Frac(cds.FieldByName('vsttime').AsDateTime);

        sArrived := ISO8601(dtArrived);
        payload.arrivedAt := sArrived;
      end;
    end;

    SIMain.LogMessage(Format('%s Referral Update: refNo=%s from=%s to=%s vn=%s status=%s action=%s reason="%s" transport=%s arrivedAt=%s',
      [LOG_TAG, sReferralId, sFromHosp, hc, ReferinVN, Status, Action,
       TruncFor(Reason, 80), TransportMode, sArrived]));
    Result := PostWebhook(payload, apiKey,
      Format('referral_update:%s:%s', [Status, sReferralId]));
  finally
    cds.Free;
  end;
end;

end.
