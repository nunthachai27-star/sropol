// BedTileFull — clinical-density bed tile (Direction A v5, "Information
// Architect · Clinical Hospital"). Each card is a self-contained patient
// dossier showing identity / vitals / labour progress / contractions /
// FHR · EFM / interventions / chronology, with semantic categorical colour
// per data domain.
//
// Color token rationale (clinical hospital palette):
//   * red                 = critical / alarm — RESERVED for crit bed
//   * blue (system)       = patient identity, brand
//   * cyan (vitals)       = nurse-note observations
//   * indigo (labour)     = partograph progress (Cx/Eff/Stn/Memb)
//   * violet (contr)      = contractions
//   * rose (FHR/heart)    = fetal heart rate + EFM
//   * emerald (interv)    = IV / Oxytocin / Epidural
//   * sky (PP) / amber (infant) / teal (care) — postpartum tile only
//
// Severity logic mirrors classifyOccupantSeverity (kept inline to keep this
// component self-contained until the rule of three triggers extraction).
'use client';

import type { BedOccupancyFull } from '@/types/maternity-ward';
import type { ConnectionConfig } from '@/types/bms-browser';
import type { MaternalScreenSummaryItem } from '@/types/api';
import { maskName } from '@/lib/pii-mask';
import { PatientPhoto } from '@/components/shared/PatientPhoto';
import {
  MATERNAL_SCREEN_TIER_LABEL_TH,
  MATERNAL_SCREEN_TIER_COLOR,
  EMERGENCY_ACUITY_LABEL_TH,
  EMERGENCY_ACUITY_COLOR,
  MATERNAL_SCREEN_FALLBACK_COLOR,
} from '@/config/maternal-screen-display';

export interface BedTileFullProps {
  bedno: string;
  bedLock: 'Y' | 'N' | null;
  occupant: BedOccupancyFull | null;
  /** Live "now" (ms since epoch) — drives hours-since-admit + crit
   *  classification so every tile in the ward shares a single render cadence.
   *  Required (no fallback to Date.now()) so the component stays render-pure
   *  under react-hooks/purity. */
  now: number;
  onClick?: (an: string) => void;
  /** Active BMS connection — enables the patient face photo (fetched by HN).
   *  Optional so the tile still renders (with a placeholder) in tests/contexts
   *  without a live session. */
  config?: ConnectionConfig | null;
  marketplaceToken?: string | null;
  /**
   * Cross-source maternal-screen summary for THIS occupant (Phase 6 Task H4,
   * docs/superpowers/plans/2026-07-17-maternal-screening-hosxp.md GC-H3/GC-H4).
   * Resolved by the caller (WardLayoutViewFull, keyed by `occupant.an`) from
   * the central-DB `useMaternalScreenSummaries` fetch — this tile never
   * fetches on its own. `undefined`/`null`, or a summary with both axes
   * null, renders zero DOM here: a missing/failed central fetch must degrade
   * to "no chips", never an error tile (GC-H4).
   */
  maternalScreenSummary?: MaternalScreenSummaryItem | null;
}

// Categorical clinical colors — kept as constants so the JSX inline `style`
// blocks read declaratively. Tailwind classes can't easily express these
// custom hues + tinted backgrounds without a config extension, so inline is
// the pragmatic choice for v1.
const C = {
  // Neutrals
  ink: '#0F172A',
  inkSoft: '#1E293B',
  paperCard: '#FFFFFF',
  paperSoft: '#F1F5F9',
  rule: '#E2E8F0',
  ruleSoft: '#EEF2F6',
  mute: '#64748B',
  // Status / accent
  accent: '#1565C0',
  ok: '#059669',
  warn: '#D97706',
  crit: '#DC2626',
  // Categorical
  cVitals: '#0891B2',
  cVitalsBg: '#ECFEFF',
  cLabour: '#4338CA',
  cLabourBg: '#EEF2FF',
  cCont: '#7C3AED',
  cContBg: '#F5F3FF',
  cFhr: '#E11D48',
  cFhrBg: '#FFF1F2',
  cInterv: '#059669',
  cIntervBg: '#ECFDF5',
  // Status pill fill
  pActive: '#059669',
  pLatent: '#2563EB',
  pTrans: '#D97706',
  pCrit: '#DC2626',
} as const;

const FONT_SANS = "'Sarabun', system-ui, -apple-system, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'SF Mono', Consolas, monospace";

// ─── helpers ──────────────────────────────────────────────────────────────

function fmt(v: unknown, suffix = ''): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${v}${suffix}`;
}

function fmtBp(sys: number | null, dia: number | null): string {
  if (sys === null && dia === null) return '—';
  return `${sys ?? '—'}/${dia ?? '—'}`;
}

function fmtTemp(t: number | null): string {
  if (t === null || t === undefined) return '—';
  return t.toFixed(1);
}

function fmtDecimal(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(digits).replace(/\.0+$/, '');
}

function fmtBodyMetrics(o: BedOccupancyFull): string {
  const weight = o.last_weight ?? o.admit_bw_kg;
  const height = o.last_height ?? o.patient_height;
  const items = [
    weight !== null && weight !== undefined ? `BW ${fmtDecimal(weight)} kg` : null,
    height !== null && height !== undefined ? `Ht ${Math.round(height)} cm` : null,
    o.last_bsa !== null && o.last_bsa !== undefined ? `BSA ${fmtDecimal(o.last_bsa, 2)}` : null,
  ].filter(Boolean);
  return items.length > 0 ? items.join(' · ') : '—';
}

// Short relative age ("5m" / "2h" / "3d") for the maternal-screen pill
// tooltip, driven by the tile's `now` prop rather than src/lib/relative-time.ts's
// formatRelativeAge (which calls Date.now() internally) — the tile's
// render-purity contract (see the `now` prop doc above) forbids that.
function fmtScreenAge(assessedAt: string | null, now: number): string | null {
  if (!assessedAt) return null;
  const ms = Date.parse(assessedAt);
  if (!Number.isFinite(ms)) return null;
  const diffMin = Math.floor(Math.max(0, now - ms) / 60_000);
  if (diffMin < 60) return `${Math.max(1, diffMin)}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

// Hours-since-admit, formatted HH:MM. Used both for severity and the tile
// chronology footer.
function fmtHours(regdate: string, regtime: string | null, now: number): string {
  const ts = `${regdate}T${regtime ?? '00:00:00'}`;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '—';
  const diff = Math.max(0, now - ms);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Stage / severity classification — drives the status pill text + color.
// Mirrors page-level classifyOccupantSeverity exactly so the dashboard KPI
// "high-risk" count and the tile pill never disagree.
type Stage =
  | { kind: 'crit'; label: string }
  | { kind: 'transition'; label: string }
  | { kind: 'active'; label: string }
  | { kind: 'latent'; label: string };

function classify(o: BedOccupancyFull, now: number): Stage {
  const cx = o.last_cervix_cm;
  const ts = Date.parse(`${o.regdate}T${o.regtime ?? '00:00:00'}`);
  const hrs = Number.isFinite(ts) ? (now - ts) / 3_600_000 : 0;
  // Prolonged latent (Friedman-curve-ish) — 12+h with cervix unknown or <4cm
  if (hrs >= 12 && (cx === null || cx < 4)) {
    return { kind: 'crit', label: 'Action · Partogram +2h' };
  }
  if (cx !== null && cx >= 7) return { kind: 'transition', label: 'Stage I · Transition' };
  if (cx !== null && cx >= 4) return { kind: 'active', label: 'Stage I · Active' };
  return { kind: 'latent', label: 'Stage I · Latent' };
}

function thaiName(o: BedOccupancyFull): string {
  const raw = [o.pname, o.fname, o.lname].filter(Boolean).join(' ').trim();
  if (!raw) return 'ไม่ระบุชื่อ';
  return maskName(raw);
}

function calcAge(birthday: string | null, now: number): number | null {
  if (!birthday) return null;
  const bd = Date.parse(birthday);
  if (!Number.isFinite(bd)) return null;
  const ageMs = now - bd;
  if (ageMs < 0) return null;
  return Math.floor(ageMs / (365.25 * 24 * 3_600_000));
}

function fmtAssessTime(date: string | null, time: string | null): string {
  if (!date && !time) return '—';
  const t = time ? time.slice(0, 5) : '—';
  return t;
}

function cervixFillPercent(cx: number | null): number {
  if (cx === null) return 0;
  return Math.min(100, Math.max(0, (cx / 10) * 100));
}

function cervixFillColor(cx: number | null): string {
  if (cx === null) return C.cLabour;
  if (cx >= 7) return C.warn;
  if (cx < 4) return C.crit;
  return C.cLabour;
}

// ─── empty / locked variants ──────────────────────────────────────────────

function EmptyTile({ bedno }: { bedno: string }) {
  return (
    <article
      data-testid={`bed-${bedno}`}
      style={{
        background: '#F4F7FB',
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent 0 8px, ' + C.paperSoft + ' 8px 9px)',
        border: `1.5px dashed #CBD5E1`,
        borderRadius: 6,
        minHeight: 280,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT_SANS,
        cursor: 'default',
      }}
    >
      <div style={tileHeadStyle('#F8FAFC')}>
        <div style={bedNoStyle}>
          <span style={bedNoPreStyle}>BED</span>
          {bedno}
        </div>
        <div style={statusPillOutlineStyle}>Available</div>
      </div>
      <div style={emptyBodyStyle}>
        <div style={emptyBodyBigStyle('var(--c-labour, ' + C.cLabour + ')')}>ว่าง</div>
        <div>Ready for admission</div>
      </div>
    </article>
  );
}

function LockedTile({ bedno }: { bedno: string }) {
  return (
    <article
      data-testid={`bed-${bedno}`}
      style={{
        background: '#F4F7FB',
        backgroundImage:
          'repeating-linear-gradient(-45deg, transparent 0 6px, rgba(15, 23, 42, 0.05) 6px 7px)',
        border: '1.5px dashed #CBD5E1',
        borderRadius: 6,
        minHeight: 280,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT_SANS,
        cursor: 'not-allowed',
      }}
    >
      <div style={tileHeadStyle('#F8FAFC')}>
        <div style={bedNoStyle}>
          <span style={bedNoPreStyle}>BED</span>
          {bedno}
        </div>
        <div style={statusPillOutlineStyle}>Locked · Maintenance</div>
      </div>
      <div style={emptyBodyStyle}>
        <div style={emptyBodyBigStyle(C.mute)}>ปิดบำรุง</div>
        <div>Maintenance</div>
      </div>
    </article>
  );
}

// ─── shared inline-style helpers ──────────────────────────────────────────

const bedNoStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 19,
  fontWeight: 800,
  letterSpacing: '-0.01em',
  color: C.ink,
  lineHeight: 1,
};

const bedNoPreStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.24em',
  color: C.mute,
  textTransform: 'uppercase',
  fontWeight: 700,
  marginRight: 6,
  verticalAlign: 4,
};

const statusPillOutlineStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  fontWeight: 700,
  color: C.mute,
  border: `1.5px dashed ${C.mute}`,
  padding: '4px 9px',
  borderRadius: 2,
  whiteSpace: 'nowrap',
};

function tileHeadStyle(bg: string): React.CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 14px 7px',
    background: bg,
    borderBottom: `1.5px solid ${C.rule}`,
  };
}

const emptyBodyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: C.mute,
  fontWeight: 700,
  padding: '32px 16px',
  textAlign: 'center',
};

function emptyBodyBigStyle(color: string): React.CSSProperties {
  return {
    fontSize: 22,
    letterSpacing: '0.32em',
    fontWeight: 800,
    color,
    fontFamily: FONT_SANS,
  };
}

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 8.5,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  fontWeight: 800,
  marginBottom: 3,
};

function sectionStyle(bg: string, accent: string): React.CSSProperties {
  return {
    padding: '7px 14px 8px',
    borderBottom: `1px solid ${C.ruleSoft}`,
    position: 'relative',
    background: bg,
    borderLeft: `3px solid ${accent}`,
  };
}

const dataKeyStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 9,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const dataValueStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 13,
  fontWeight: 700,
  color: C.ink,
  fontVariantNumeric: 'tabular-nums',
};

const compactKeyStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 8.5,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  fontWeight: 800,
  color: C.mute,
  marginBottom: 1,
};

// Maternal-screen pill — same outlined-pill recipe as the blood_grp identity
// pill above (mono, 9px, 700 weight, 0.16em tracking, 2px 6px padding,
// uppercase, 1px radius, colored text + matching 1px border, no fill), but
// colored from the maternal-screen-display LIGHT tokens instead of a fixed
// C.* constant (GC-H3: this file's crit red stays reserved for the tile-level
// alarm; a pill may reuse that same red value for its own text/border only).
function screenPillStyle(color: string): React.CSSProperties {
  return {
    fontFamily: FONT_MONO,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.16em',
    padding: '2px 6px',
    textTransform: 'uppercase',
    borderRadius: 1,
    color,
    border: `1px solid ${color}`,
    whiteSpace: 'nowrap',
  };
}

const compactValueStyle: React.CSSProperties = {
  fontFamily: FONT_SANS,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
  color: C.ink,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// ─── main component ───────────────────────────────────────────────────────

export function BedTileFull({
  bedno,
  bedLock,
  occupant,
  now,
  onClick,
  config,
  marketplaceToken,
  maternalScreenSummary,
}: BedTileFullProps) {
  if (bedLock === 'Y') return <LockedTile bedno={bedno} />;
  if (!occupant) return <EmptyTile bedno={bedno} />;

  const stage = classify(occupant, now);
  const isCrit = stage.kind === 'crit';
  const age = calcAge(occupant.birthday, now);

  // Cross-source maternal-screen pills (Task H4) — zero DOM unless at least
  // one axis is present (GC-H4: absent/both-null summary ⇒ tile renders
  // exactly as today).
  const screenTier = maternalScreenSummary?.localTier ?? null;
  const screenAcuity = maternalScreenSummary?.emergencyAcuity ?? null;
  const showScreenPills = screenTier !== null || screenAcuity !== null;
  const screenAgeLabel = showScreenPills
    ? fmtScreenAge(maternalScreenSummary?.assessedAt ?? null, now)
    : null;

  // Status pill background per stage
  const pillBg = isCrit
    ? C.pCrit
    : stage.kind === 'transition'
      ? C.pTrans
      : stage.kind === 'active'
        ? C.pActive
        : C.pLatent;

  // Card border + outer shadow (crit gets the alarm treatment)
  const cardBorder = isCrit ? `3px solid ${C.crit}` : '1.5px solid #CBD5E1';
  const cardShadow = isCrit
    ? '0 0 0 1px rgba(220, 38, 38, 0.15), 0 4px 16px rgba(220, 38, 38, 0.18)'
    : '0 1px 3px rgba(15, 23, 42, 0.06)';
  const cardBg = isCrit
    ? `linear-gradient(to right, rgba(220,38,38,0.08), ${C.paperCard} 60%)`
    : C.paperCard;

  const headBg = isCrit ? '#FEF2F2' : '#F8FAFC';
  const footBg = isCrit ? '#FECACA' : '#E2E8F0';
  const footColor = isCrit ? '#7F1D1D' : C.ink;
  const footKeyColor = isCrit ? '#B91C1C' : C.mute;

  return (
    <article
      data-testid={`bed-${bedno}`}
      onClick={() => onClick?.(occupant.an)}
      style={{
        background: cardBg,
        border: cardBorder,
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: cardShadow,
        fontFamily: FONT_SANS,
        transition: 'all 120ms ease',
      }}
    >
      {/* Head */}
      <div style={tileHeadStyle(headBg)}>
        <div style={bedNoStyle}>
          <span style={bedNoPreStyle}>BED</span>
          {bedno}
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '5px 10px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            color: 'white',
            background: pillBg,
            borderRadius: 2,
          }}
        >
          {stage.label}
        </div>
      </div>

      {/* Identity */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr auto',
          gap: 10,
          padding: '6px 14px',
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: C.mute,
          alignItems: 'center',
          borderBottom: `1px solid ${C.ruleSoft}`,
        }}
      >
        <div>
          <span
            style={{
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              marginRight: 6,
            }}
          >
            AN
          </span>
          <span style={{ color: C.ink, fontWeight: 700 }}>{occupant.an}</span>
        </div>
        <div>
          <span
            style={{
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              marginRight: 6,
            }}
          >
            HN
          </span>
          <span style={{ color: C.ink, fontWeight: 700 }}>{occupant.hn}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* Allergy flag — red filled when ≥1 opd_allergy row, green outlined NKDA otherwise.
              null allergy_count (query failed) is treated like NKDA visually but distinct in tooling. */}
          {(occupant.allergy_count ?? 0) > 0 ? (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.16em',
                padding: '2px 6px',
                textTransform: 'uppercase',
                borderRadius: 1,
                color: 'white',
                background: C.crit,
                border: `1px solid ${C.crit}`,
              }}
              title={`${occupant.allergy_count} known allergy record${occupant.allergy_count === 1 ? '' : 's'} on file`}
            >
              Allergy
            </span>
          ) : (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.16em',
                padding: '2px 6px',
                textTransform: 'uppercase',
                borderRadius: 1,
                color: C.ok,
                border: `1px solid ${C.ok}`,
              }}
              title="No known drug allergies on file"
            >
              NKDA
            </span>
          )}
          {/* Blood group — outlined pill, only when on file. */}
          {occupant.blood_grp && (
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.16em',
                padding: '2px 6px',
                textTransform: 'uppercase',
                borderRadius: 1,
                color: C.crit,
                border: `1px solid ${C.crit}`,
              }}
            >
              {occupant.blood_grp}
            </span>
          )}
          {/* Cross-source maternal-screen pills (Task H4, GC-H3/GC-H4) — shadow-mode,
              provisional/unapproved rule set. Zero DOM when no summary or both axes
              are null; NEVER alters tile-level border/shadow/background (that stays
              reserved for the crit bed alarm above). */}
          {showScreenPills && (
            <span
              data-testid="bed-maternal-screen"
              title="การคัดกรองท้องถิ่น (โหมดเงา — ยังไม่ได้รับการรับรอง)"
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {screenTier && (
                <span
                  data-testid="bed-maternal-screen-tier"
                  style={screenPillStyle(
                    MATERNAL_SCREEN_TIER_COLOR[screenTier] ?? MATERNAL_SCREEN_FALLBACK_COLOR,
                  )}
                >
                  {MATERNAL_SCREEN_TIER_LABEL_TH[screenTier]}
                </span>
              )}
              {screenAcuity && (
                <span
                  data-testid="bed-maternal-screen-acuity"
                  style={screenPillStyle(
                    EMERGENCY_ACUITY_COLOR[screenAcuity] ?? MATERNAL_SCREEN_FALLBACK_COLOR,
                  )}
                >
                  {EMERGENCY_ACUITY_LABEL_TH[screenAcuity]}
                </span>
              )}
              {screenAgeLabel && (
                <span
                  data-testid="bed-maternal-screen-age"
                  style={{ fontSize: 8.5, color: C.mute }}
                >
                  {screenAgeLabel}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Name */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '7px 14px 6px',
          borderBottom: `1px solid ${C.ruleSoft}`,
        }}
      >
        <PatientPhoto
          hn={occupant.hn}
          config={config}
          marketplaceToken={marketplaceToken}
          name={thaiName(occupant)}
          size={46}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              lineHeight: 1.2,
              color: C.ink,
              marginBottom: 2,
            }}
          >
            {thaiName(occupant)}
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: C.mute,
            }}
          >
            {age !== null && <b style={{ color: C.inkSoft, fontWeight: 700 }}>{age}Y</b>}
            {age !== null && occupant.gravida !== null && <> · </>}
            {occupant.gravida !== null && <>G{occupant.gravida}</>}
            {occupant.ga !== null && (
              <>
                {' '}
                · GA <b style={{ color: C.inkSoft, fontWeight: 700 }}>{occupant.ga}</b>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ADMIT CONTEXT — mirrors HOSxP's IPD admit header fields. */}
      <div
        style={{
          padding: '6px 14px 7px',
          borderBottom: `1px solid ${C.ruleSoft}`,
          background: '#FAFBFC',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.1fr', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={compactKeyStyle}>Doctor</div>
            <div style={compactValueStyle}>{fmt(occupant.incharge_doctor_name)}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={compactKeyStyle}>Coverage</div>
            <div style={compactValueStyle}>{fmt(occupant.pttype_name)}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={compactKeyStyle}>Body</div>
            <div style={{ ...compactValueStyle, fontFamily: FONT_MONO, fontSize: 10.5 }}>
              {fmtBodyMetrics(occupant)}
            </div>
          </div>
        </div>
        {occupant.prediag && (
          <div
            title={occupant.prediag}
            style={{
              marginTop: 5,
              paddingTop: 5,
              borderTop: `1px solid ${C.ruleSoft}`,
              display: 'grid',
              gridTemplateColumns: '72px minmax(0, 1fr)',
              gap: 8,
              alignItems: 'baseline',
            }}
          >
            <div style={{ ...compactKeyStyle, marginBottom: 0, color: C.warn }}>Prediag</div>
            <div style={compactValueStyle}>{occupant.prediag}</div>
          </div>
        )}
      </div>

      {/* VITALS — from ipd_nurse_note latest */}
      <div style={sectionStyle(C.cVitalsBg, C.cVitals)}>
        <div style={{ ...sectionLabelStyle, color: C.cVitals }}>Vitals</div>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1.35fr repeat(5, 1fr)', gap: '4px 8px' }}
        >
          <div>
            <div style={{ ...dataKeyStyle, color: C.cVitals }}>BP</div>
            <div style={dataValueStyle}>{fmtBp(occupant.last_bp_sys, occupant.last_bp_dia)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cVitals }}>T</div>
            <div style={dataValueStyle}>{fmtTemp(occupant.last_temp)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cVitals }}>P</div>
            <div style={dataValueStyle}>{fmt(occupant.last_pulse)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cVitals }}>R</div>
            <div style={dataValueStyle}>{fmt(occupant.last_rr)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cVitals }}>SpO₂ RA</div>
            <div style={dataValueStyle}>{fmt(occupant.last_spo2)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cVitals }}>O₂</div>
            <div style={dataValueStyle}>{fmt(occupant.last_spo2_o2)}</div>
          </div>
        </div>
      </div>

      {/* LABOUR PROGRESS — from ipt_labour_partograph latest */}
      <div style={sectionStyle(C.cLabourBg, C.cLabour)}>
        <div style={{ ...sectionLabelStyle, color: C.cLabour }}>Labour Progress</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 8px' }}>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cLabour }}>Cx</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <div
                style={{
                  width: 60,
                  height: 5,
                  background: 'rgba(15, 23, 42, 0.1)',
                  position: 'relative',
                  borderRadius: 1,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: '0 auto 0 0',
                    width: `${cervixFillPercent(occupant.last_cervix_cm)}%`,
                    background: cervixFillColor(occupant.last_cervix_cm),
                    borderRadius: 1,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 14,
                  fontWeight: 700,
                  color:
                    cervixFillColor(occupant.last_cervix_cm) === C.cLabour
                      ? C.ink
                      : cervixFillColor(occupant.last_cervix_cm),
                }}
              >
                {occupant.last_cervix_cm !== null
                  ? String(occupant.last_cervix_cm).padStart(2, '0')
                  : '—'}
              </span>
            </div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cLabour }}>Stn</div>
            <div style={dataValueStyle}>{fmt(occupant.last_station)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cLabour }}>Memb</div>
            <div style={dataValueStyle}>{fmt(occupant.last_amniotic)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cLabour }}>Pain</div>
            <div style={dataValueStyle}>
              {occupant.last_pain !== null ? `${occupant.last_pain}/10` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* CONTRACTIONS + FHR — split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr' }}>
        <div style={sectionStyle(C.cContBg, C.cCont)}>
          <div style={{ ...sectionLabelStyle, color: C.cCont }}>Contractions</div>
          <div style={{ ...dataValueStyle }}>
            {occupant.last_contr_freq !== null ||
            occupant.last_contr_duration !== null ||
            occupant.last_contr_strength !== null
              ? `${occupant.last_contr_freq !== null ? `${occupant.last_contr_freq}:10` : '—'} / ${
                  occupant.last_contr_duration !== null ? `${occupant.last_contr_duration}s` : '—'
                } / ${occupant.last_contr_strength ?? '—'}`
              : '—'}
          </div>
        </div>
        <div style={sectionStyle(C.cFhrBg, C.cFhr)}>
          <div style={{ ...sectionLabelStyle, color: C.cFhr, textAlign: 'right' }}>FHR · EFM</div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}
          >
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 22,
                fontWeight: 800,
                color: C.cFhr,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              {fmt(occupant.last_fhr)}
            </span>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: C.cFhr,
                animation: 'kk-heartbeat 0.85s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>

      {/* INTERVENTIONS */}
      <div style={sectionStyle(C.cIntervBg, C.cInterv)}>
        <div style={{ ...sectionLabelStyle, color: C.cInterv }}>Interventions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 8px' }}>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cInterv }}>IV</div>
            <div style={{ ...dataValueStyle, fontSize: 12 }}>{fmt(occupant.last_iv_fluids)}</div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cInterv }}>Oxytocin</div>
            <div style={{ ...dataValueStyle, fontSize: 12 }}>
              {occupant.last_oxytocin_uml !== null ? `${occupant.last_oxytocin_uml} mU/min` : '—'}
            </div>
          </div>
          <div>
            <div style={{ ...dataKeyStyle, color: C.cInterv }}>Drops</div>
            <div style={{ ...dataValueStyle, fontSize: 12 }}>
              {fmt(occupant.last_oxytocin_drops, '/min')}
            </div>
          </div>
        </div>
      </div>

      {/* Footer chronology */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
          padding: '6px 14px',
          background: footBg,
          color: footColor,
          borderTop: `1px solid ${isCrit ? 'rgba(220, 38, 38, 0.4)' : '#CBD5E1'}`,
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: '0.06em',
          fontWeight: 700,
        }}
      >
        <div>
          <span
            style={{
              color: footKeyColor,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginRight: 4,
              fontWeight: 600,
            }}
          >
            Admit
          </span>
          {(occupant.regtime ?? '').slice(0, 5) || '—'}
        </div>
        <div>
          <span
            style={{
              color: footKeyColor,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginRight: 4,
              fontWeight: 600,
            }}
          >
            Hrs
          </span>
          {fmtHours(occupant.regdate, occupant.regtime, now)}
        </div>
        <div>
          <span
            style={{
              color: footKeyColor,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginRight: 4,
              fontWeight: 600,
            }}
          >
            Last
          </span>
          {fmtAssessTime(occupant.last_assess_date, occupant.last_assess_time)}
          {occupant.last_assess_staff && ` · ${occupant.last_assess_staff}`}
        </div>
      </div>
    </article>
  );
}
