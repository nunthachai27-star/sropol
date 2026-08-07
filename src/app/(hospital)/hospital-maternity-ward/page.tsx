// Hospital maternity-ward page — clinical-density redesign (Direction A v5
// "Information Architect · Clinical Hospital").
//
// Consolidates what used to be two routes: the lite tile + DnD bed-move
// surface formerly at this path, and the dense BedTileFull / WardLayoutViewFull
// formerly at /hospital-maternity-ward/v2. After visual sign-off the dense
// tile became the single canonical view; the v2 subroute is gone.
//
// Data: WARD_BEDS_OCCUPANCY_FULL via useMaternityWardStateFull. Joins are
// PK-resolution lookups so the query stays inside the constitution VI 2-second
// SQL budget for a 12-bed ward.
//
// Vital-sign source split (per project memory):
//   * BP / T / P / RR / SpO2 / pain  → ipd_nurse_note (latest by note_date+time)
//   * Cx / Stn / FHR / contractions / oxytocin / IV / amniotic
//                                    → ipt_labour_partograph (latest by observe_datetime)
'use client';
import { useEffect, useState } from 'react';
import { useBmsSession } from '@/hooks/useBmsSession';
import { useMaternityWardStateFull } from '@/hooks/useMaternityWardStateFull';
import { useOnboardHosxpWebhook } from '@/hooks/useOnboardHosxpWebhook';
import { useOnboardHosxpSync } from '@/hooks/useOnboardHosxpSync';
import { useBrowserPoll } from '@/hooks/useBrowserPoll';
import { useMaternalScreenSummaries } from '@/hooks/useMaternalScreenSummaries';
import { WardLayoutViewFull, type BedMovePayload } from '@/components/maternity/WardLayoutViewFull';
import { PatientDrawer } from '@/components/maternity/PatientDrawer';
import { getBedMoveReasons, movePatientBed } from '@/services/maternity-ward';
import { AlertCircle, RefreshCw } from 'lucide-react';

const LIVE_GREEN = '#059669';
const LIVE_AMBER = '#D97706';
const SLATE_INK = '#0F172A';
const SLATE_MUTE = '#64748B';
const ACCENT_BLUE = '#1565C0';
const CRIT_RED = '#DC2626';
const FONT_MONO = "'IBM Plex Mono', 'SF Mono', Consolas, monospace";

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-slate-200/70 ${className}`} aria-hidden="true" />
  );
}

// Shared dismissible alert strip. Both the HOSxP-webhook onboarding error and
// the bed-move write-failure surface use it so the two never drift apart in
// style (constitution III — extract the pattern once it appears twice).
function AlertBanner({
  badge,
  title,
  detail,
  onDismiss,
}: {
  badge: string;
  title: string;
  detail?: string | null;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-sm"
      style={{ borderColor: CRIT_RED }}
    >
      <div
        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white"
        style={{ background: CRIT_RED }}
      >
        {badge}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900">{title}</div>
        {detail && <div className="mt-0.5 break-words text-xs text-slate-600">{detail}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-600 hover:bg-slate-50"
      >
        ซ่อน
      </button>
    </div>
  );
}

export default function HospitalMaternityWardPage() {
  const { isReady, error: sessionError, config, userInfo, marketplaceToken } = useBmsSession();
  const { state: onboardingState } = useOnboardHosxpWebhook();
  // Provision the polling pipeline alongside the webhook. Without this,
  // a nurse who only ever lands on /hospital-maternity-ward never gets
  // their hospital onto the 30s server-side poll rotation, so the
  // provincial dashboard, cached_patients, and the new "Sync Log" tab
  // stay empty for that hospital. Same gate as the provincial dashboard
  // (`/`) — runs at most once per tab and only with a marketplace_token.
  useOnboardHosxpSync();
  // Browser-side HOSxP poll — same skip-conditions and 60s cadence as the
  // provincial dashboard. Without this, the nurse's tab would never push
  // ipt_labour / partograph updates to the central cache after server-side
  // polling was disabled.
  useBrowserPoll();
  // Cross-source maternal-screen summaries (Phase 6 Task H4, GC-H4) — a
  // SEPARATE central-DB fetch, independent of the live HOSxP feed above. A
  // failed/slow fetch here degrades `byAn` to an empty map (see the hook),
  // so every bed tile renders exactly as it does today; it can never block
  // or error the ward board.
  const { byAn: maternalScreenSummaries } = useMaternalScreenSummaries(userInfo?.hospcode ?? null);
  const [onboardingErrorDismissed, setOnboardingErrorDismissed] = useState(false);
  const showOnboardingError = !!onboardingState?.error && !onboardingErrorDismissed;

  const {
    wards,
    ward,
    selectedWard,
    setSelectedWard,
    beds,
    occupancy,
    isLoading,
    error,
    health,
    mutateBeds,
    mutateOccupancy,
  } = useMaternityWardStateFull();
  const [selectedAn, setSelectedAn] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  // Write-failure strip (bed move + rejected move). No shared toast system
  // exists yet, so this local banner is how write errors reach the nurse.
  const [writeError, setWriteError] = useState<{ message: string; detail?: string } | null>(null);

  // 60s tick — drives hours-since-admit + crit severity classification.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Lazy-load bed-move reasons once a session is available. Empty array
  // disables the Confirm button on the reason modal.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    getBedMoveReasons(config)
      .then((rs) => {
        if (!cancelled) setReasons(rs);
      })
      .catch(() => {
        if (!cancelled) setReasons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  if (sessionError) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-red-600">เกิดข้อผิดพลาด: {sessionError}</p>
      </div>
    );
  }
  if (!isReady) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-slate-500">
        เปิดหน้านี้จาก HOSxP เพื่อใช้งาน
        <br />
        <span className="text-xs">(ไม่พบ BMS Session — กรุณาเข้าผ่าน HOSxP)</span>
      </div>
    );
  }
  // Full-page takeover only for an initial-load failure (no ward resolved yet).
  // Once a ward is on screen, a transient beds/occupancy refresh error keeps the
  // cached board visible and degrades to the masthead LIVE badge instead — the
  // nurse never loses the board over a blip (constitution VI: show cached data).
  if (error && !ward) {
    return (
      <div
        role="alert"
        className="mx-auto mt-12 flex max-w-xl flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center"
      >
        <AlertCircle className="h-10 w-10 text-red-500" aria-hidden />
        <p className="text-base font-semibold text-red-700">ไม่สามารถโหลดข้อมูลห้องคลอด</p>
        <p className="text-sm text-red-600">{error.message}</p>
        <button
          type="button"
          onClick={() => {
            void mutateBeds();
            void mutateOccupancy();
          }}
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="h-4 w-4" /> ลองอีกครั้ง
        </button>
      </div>
    );
  }
  if (!isLoading && wards.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
        <p className="text-base font-semibold text-slate-700">ไม่มีห้องคลอดที่ใช้งานได้</p>
        <p className="mt-2 text-sm text-slate-500">
          กรุณาตรวจสอบ <code className="font-mono">ward.is_maternity_ward = &apos;Y&apos;</code> ใน
          HOSxP
        </p>
      </div>
    );
  }
  if (isLoading || !ward) {
    return (
      <div className="mx-auto max-w-[1760px] p-7">
        <Skeleton className="h-9 w-64 mb-3" />
        <Skeleton className="h-4 w-80 mb-8" />
        <div className="grid grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[300px] rounded-md" />
          ))}
        </div>
        <span className="sr-only">กำลังโหลด…</span>
      </div>
    );
  }

  // Filter occupancy to current ward's beds (defensive against loose joins).
  const bednoSet = new Set(beds.map((b) => b.bedno));
  const wardOccupancy = occupancy.filter((o) => bednoSet.has(o.bedno));
  const lockedCount = beds.filter((b) => b.bed_lock === 'Y').length;
  const occupiedCount = wardOccupancy.length;
  const totalBeds = beds.length;
  const freeCount = Math.max(0, totalBeds - occupiedCount - lockedCount);
  const wardName = wards.find((w) => w.ward === ward)?.name ?? `ward ${ward}`;
  const selectedOccupant = selectedAn
    ? (wardOccupancy.find((o) => o.an === selectedAn) ?? null)
    : null;

  // Critical count — same heuristic as BedTileFull.classify (mirrors page-level
  // KPI "high-risk" with the per-tile pill so the two never disagree).
  const critical = wardOccupancy.filter((o) => {
    const ts = Date.parse(`${o.regdate}T${o.regtime ?? '00:00:00'}`);
    const hrs = Number.isFinite(ts) ? (now - ts) / 3_600_000 : 0;
    const cx = o.last_cervix_cm;
    return hrs >= 12 && (cx === null || cx < 4);
  }).length;

  const handleRefresh = () => {
    void mutateBeds();
    void mutateOccupancy();
  };

  const handleBedMove = async (payload: BedMovePayload) => {
    if (!config || !userInfo) return;
    try {
      await movePatientBed(config, userInfo, userInfo.hospcode, {
        an: payload.an,
        oldWard: ward,
        oldBedno: payload.oldBedno,
        newWard: ward,
        newBedno: payload.newBedno,
        newRoomno: payload.newRoomno,
        reason: payload.reason,
      });
      setWriteError(null);
      await Promise.all([mutateBeds(), mutateOccupancy()]);
    } catch (e) {
      console.error('[bed-move] movePatientBed failed:', e);
      // movePatientBed is a non-atomic two-step write (iptadm bedno/roomno
      // update, THEN the iptbedmove audit insert) that surfaces a single opaque
      // error — timeouts/connection failures at either step carry no table
      // identity, so we cannot tell from here whether iptadm already changed.
      // Warn that the move may have applied without a complete audit record and
      // resnap the board to server truth so the tile reflects reality.
      const detail = e instanceof Error ? e.message : String(e);
      setWriteError({
        message:
          'ย้ายเตียงไม่สำเร็จ — เตียงอาจถูกย้ายแล้วแต่บันทึกประวัติไม่ครบ กรุณาตรวจสอบสถานะเตียงใน HOSxP แล้วรีเฟรชก่อนลองใหม่',
        detail,
      });
      void mutateOccupancy();
    }
  };

  const handleMoveRejected = (reason: 'locked' | 'occupied' | 'no-op') => {
    // 'no-op' = dropped back on the same bed. Benign — clear any stale strip and
    // stay quiet rather than nag the nurse. No server write happened in any of
    // these branches, so the board never changed and needs no resnap.
    if (reason === 'no-op') {
      setWriteError(null);
      console.warn('[bed-move] rejected: เตียงเดิม — ไม่ต้องย้าย');
      return;
    }
    const banner =
      reason === 'locked'
        ? {
            message: 'ย้ายเตียงไม่ได้ — เตียงปลายทางถูกล็อก',
            detail: 'ปลดล็อกเตียงใน HOSxP ก่อน หรือเลือกเตียงว่างอื่น',
          }
        : {
            message: 'ย้ายเตียงไม่ได้ — เตียงปลายทางไม่ว่าง',
            detail: 'เลือกเตียงที่ว่างและไม่ถูกล็อก แล้วลองอีกครั้ง',
          };
    console.warn(`[bed-move] rejected: ${banner.message}`);
    setWriteError(banner);
  };

  // Masthead LIVE badge, driven by real feed health from the hook. The error
  // message rides along in a title attr when offline so a nurse can hover for
  // the underlying cause without leaving the board.
  const liveBadge =
    health === 'reconnecting'
      ? { color: LIVE_AMBER, label: 'BMS · RECONNECTING', title: error?.message }
      : health === 'error'
        ? { color: CRIT_RED, label: 'BMS · OFFLINE', title: error?.message }
        : { color: LIVE_GREEN, label: 'LIVE · BMS SESSION API', title: undefined };

  return (
    <div
      className="mx-auto max-w-[1760px]"
      style={{ padding: '0 28px 80px', background: '#F4F7FB', minHeight: '100vh' }}
    >
      {showOnboardingError && (
        <AlertBanner
          badge="HOSxP WEBHOOK"
          title="ไม่สามารถอัปเดต webhook_setting บน HOSxP"
          detail={onboardingState?.error}
          onDismiss={() => setOnboardingErrorDismissed(true)}
        />
      )}

      {writeError && (
        <AlertBanner
          badge="ย้ายเตียง"
          title={writeError.message}
          detail={writeError.detail}
          onDismiss={() => setWriteError(null)}
        />
      )}

      {/* Masthead */}
      <header
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          alignItems: 'end',
          gap: 32,
          padding: '28px 0 16px',
          borderBottom: `2px solid ${SLATE_INK}`,
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              fontSize: 11,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: SLATE_MUTE,
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            <span
              style={{ display: 'inline-block', width: 28, height: 5, background: ACCENT_BLUE }}
            />
            <span style={{ color: SLATE_INK, fontWeight: 800, letterSpacing: '0.24em' }}>
              SR-LRMS / OneLR
            </span>
            <span>· จังหวัดสุรินทร์ · Provincial Maternity Network</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap' }}>
            <h1
              style={{
                fontSize: 38,
                fontWeight: 800,
                letterSpacing: '-0.005em',
                margin: 0,
                lineHeight: 1,
                color: SLATE_INK,
              }}
            >
              ห้องคลอด<span style={{ color: ACCENT_BLUE }}>.</span>
            </h1>
            <span style={{ fontSize: 14, color: '#1E293B', fontWeight: 600 }}>{wardName}</span>
            {wards.length > 1 && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: SLATE_MUTE,
                  fontWeight: 600,
                }}
              >
                วอร์ด:
                <select
                  value={selectedWard ?? ''}
                  onChange={(e) => setSelectedWard(e.target.value)}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 12,
                    fontWeight: 600,
                    color: SLATE_INK,
                    border: `1px solid ${SLATE_INK}`,
                    background: 'white',
                    padding: '4px 8px',
                    borderRadius: 2,
                    cursor: 'pointer',
                  }}
                >
                  {wards.map((w) => (
                    <option key={w.ward} value={w.ward}>
                      {w.name} ({w.ward})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 4,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: SLATE_MUTE,
            textAlign: 'right',
            fontWeight: 600,
          }}
        >
          <div
            role="status"
            aria-live="polite"
            title={liveBadge.title}
            style={{
              color: liveBadge.color,
              fontWeight: 700,
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              className={health === 'ok' ? undefined : 'animate-pulse'}
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                background: liveBadge.color,
                borderRadius: '50%',
              }}
            />
            {liveBadge.label}
          </div>
          <div>อัปเดตอัตโนมัติทุก 20 วินาที</div>
        </div>
        <button
          onClick={handleRefresh}
          style={{
            border: `2px solid ${ACCENT_BLUE}`,
            background: ACCENT_BLUE,
            color: 'white',
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            padding: '10px 18px',
            cursor: 'pointer',
            borderRadius: 2,
          }}
          type="button"
        >
          Refresh ↻
        </button>
      </header>

      {/* KPI bar */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          borderBottom: `2px solid ${SLATE_INK}`,
          background: 'white',
        }}
      >
        {(
          [
            { label: 'Total Beds', value: totalBeds, delta: '', accent: SLATE_INK },
            {
              label: 'Occupied',
              value: occupiedCount,
              delta: totalBeds > 0 ? `${Math.round((occupiedCount / totalBeds) * 100)}%` : '',
              accent: LIVE_GREEN,
            },
            { label: 'Available', value: freeCount, delta: '', accent: ACCENT_BLUE },
            { label: 'Locked', value: lockedCount, delta: '', accent: SLATE_MUTE },
            {
              label: 'High-risk',
              value: critical,
              delta: critical > 0 ? 'ACTION LINE' : '',
              accent: CRIT_RED,
            },
          ] as const
        ).map((k, i) => (
          <div
            key={k.label}
            style={{
              padding: '18px 18px 16px',
              borderLeft: i === 0 ? 'none' : '1px solid #E2E8F0',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: 3,
                background: k.accent,
              }}
            />
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: SLATE_MUTE,
                margin: '8px 0',
                fontWeight: 700,
              }}
            >
              {k.label}
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 38,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                color: k.accent,
              }}
            >
              {String(k.value).padStart(2, '0')}
            </div>
            {k.delta && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: SLATE_MUTE,
                  marginTop: 8,
                  fontWeight: 600,
                }}
              >
                {k.delta}
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Ward layout — DnD-enabled bed grid */}
      <div style={{ paddingTop: 28 }}>
        <WardLayoutViewFull
          beds={beds}
          occupancy={wardOccupancy}
          now={now}
          onBedClick={setSelectedAn}
          onBedMove={(p) => void handleBedMove(p)}
          onMoveRejected={handleMoveRejected}
          reasons={reasons}
          config={config}
          marketplaceToken={marketplaceToken}
          maternalScreenSummaries={maternalScreenSummaries}
        />
      </div>

      <PatientDrawer
        open={selectedAn !== null}
        occupant={selectedOccupant}
        onClose={() => setSelectedAn(null)}
      />
    </div>
  );
}
