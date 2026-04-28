// Hospital maternity-ward kiosk page (Task 25). Renders the room-grouped
// WardLayoutView for the first ward returned by the BMS Session API, with a
// header summary (ward name, total/occupied/free counts) and a manual refresh
// button. Task 40 wires the PatientDrawer: clicking a bed opens the drawer
// with the matching occupant; closing resets selection.
'use client';
import { useEffect, useState } from 'react';
import { useBmsSession } from '@/hooks/useBmsSession';
import { useMaternityWardState } from '@/hooks/useMaternityWardState';
import { useOnboardHosxpWebhook } from '@/hooks/useOnboardHosxpWebhook';
import {
  WardLayoutView,
  type BedMovePayload,
} from '@/components/maternity/WardLayoutView';
import { PatientDrawer } from '@/components/maternity/PatientDrawer';
import {
  getBedMoveReasons,
  movePatientBed,
} from '@/services/maternity-ward';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  RefreshCw,
  Bed,
  UserCheck,
  BedDouble,
  Lock,
  Activity,
} from 'lucide-react';

// Inline skeleton primitive — single-purpose, used only by this page so it
// stays inline rather than getting promoted to a shared component (DRY: rule
// of three not yet hit).
function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200/70 ${className}`}
      aria-hidden="true"
    />
  );
}

// Skeleton substitute for the room-grouped bed grid while wards / beds /
// occupancy are loading. Rough proportions match WardLayoutView's actual
// 32x32 (8rem) tiles so the layout doesn't reflow once data arrives.
function BedGridSkeleton() {
  return (
    <div className="space-y-6" data-testid="bed-grid-skeleton" aria-busy="true">
      {[0, 1].map((row) => (
        <section
          key={row}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="mb-3 flex items-baseline justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="flex flex-wrap gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-32" />
            ))}
          </div>
        </section>
      ))}
      <span className="sr-only">กำลังโหลด…</span>
    </div>
  );
}

export default function HospitalMaternityWardPage() {
  const { isReady, error: sessionError, config, userInfo } = useBmsSession();
  // Auto-provisions HOSxP's webhook_setting row on first kiosk landing (same
  // flow as the provincial dashboard). No-op when already confirmed. Error
  // surfaces via the red banner below so the kiosk operator can act on it
  // without opening DevTools.
  const { state: onboardingState } = useOnboardHosxpWebhook();
  const [onboardingErrorDismissed, setOnboardingErrorDismissed] = useState(false);
  const showOnboardingError =
    !!onboardingState?.error && !onboardingErrorDismissed;
  const { wards, ward, beds, occupancy, isLoading, error, mutateBeds, mutateOccupancy } =
    useMaternityWardState();
  const [selectedAn, setSelectedAn] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);

  // Live "now" tick — drives hours-in-labor + last-observation relative time
  // so the grid stays honest between SWR revalidations. Updating every 60s is
  // plenty for hour-granularity displays. Pulled up here (instead of into
  // BedTile) so all tiles share a single render cadence.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Lazy-load the reason list once a session is available. Failures fall back
  // to an empty list — the modal Confirm button stays disabled in that case.
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

  if (error) {
    return (
      <div
        role="alert"
        className="mx-auto mt-12 flex max-w-xl flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center"
      >
        <AlertCircle className="h-10 w-10 text-red-500" aria-hidden />
        <p className="text-base font-semibold text-red-700">
          ไม่สามารถโหลดข้อมูลห้องคลอด
        </p>
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

  // No wards → either none configured or all filtered out by is_maternity_ward.
  // Distinct from "still loading" so we can give the user an actionable hint.
  if (!isLoading && wards.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
        <p className="text-base font-semibold text-slate-700">
          ไม่มีห้องคลอดที่ใช้งานได้
        </p>
        <p className="mt-2 text-sm text-slate-500">
          กรุณาตรวจสอบ <code className="font-mono">ward.is_maternity_ward = &apos;Y&apos;</code> ใน HOSxP
        </p>
      </div>
    );
  }

  if (isLoading || !ward) {
    return (
      <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-24" />
        </header>
        <BedGridSkeleton />
        <span className="sr-only">กำลังโหลด…</span>
      </div>
    );
  }

  // Filter occupancy to the currently selected ward only. The BMS query can
  // return admissions for other wards when joins are loose; stats and the grid
  // must reflect only what's actually displayed.
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

  const handleRefresh = () => {
    void mutateBeds();
    void mutateOccupancy();
  };

  const handleBedMove = async (payload: BedMovePayload) => {
    if (!config || !userInfo) return;
    try {
      await movePatientBed(config, userInfo, userInfo.hospcode, {
        an: payload.an,
        oldWard: ward!,
        oldBedno: payload.oldBedno,
        newWard: ward!,
        newBedno: payload.newBedno,
        newRoomno: payload.newRoomno,
        reason: payload.reason,
      });
      await Promise.all([mutateBeds(), mutateOccupancy()]);
    } catch (e) {
      // TODO: replace with the shared toast component when available.
      console.error('[bed-move] movePatientBed failed:', e);
    }
  };

  const handleMoveRejected = (reason: 'locked' | 'occupied' | 'no-op') => {
    const msg =
      reason === 'locked'
        ? 'เตียงถูกล็อก'
        : reason === 'occupied'
          ? 'เตียงไม่ว่าง'
          : 'เตียงเดิม — ไม่ต้องย้าย';
    // TODO: replace with the shared toast component when available.
    console.warn(`[bed-move] rejected: ${msg}`);
  };

  // Severity roll-ups — keep the summary bar honest without re-running the
  // per-tile severity logic. Mirrors the thresholds in BedTile.classifySeverity.
  // Uses the `now` tick (not Date.now()) to stay pure-during-render.
  const critical = wardOccupancy.filter((o) => {
    const admitMs = Date.parse(`${o.regdate}T${o.regtime ?? '00:00:00'}`);
    const hrs = Number.isFinite(admitMs) ? (now - admitMs) / 3_600_000 : 0;
    const cx = o.last_cervix_cm;
    return hrs >= 12 && (cx === null || cx < 4);
  }).length;

  const onboardingBanner = showOnboardingError ? (
    <div
      role="alert"
      className="mb-3 flex items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-sm"
      style={{ borderColor: '#dc2626' }}
    >
      <div
        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white"
        style={{ background: '#dc2626' }}
      >
        HOSxP WEBHOOK
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900">
          ไม่สามารถอัปเดต webhook_setting บน HOSxP
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-600">
          {onboardingState?.error}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOnboardingErrorDismissed(true)}
        className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-600 hover:bg-slate-50"
      >
        ซ่อน
      </button>
    </div>
  ) : null;

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6">
      {onboardingBanner}
      {/* Summary bar — sticky under the navbar so ward context stays visible while scrolling the grid. */}
      <header className="sticky top-14 z-10 mb-4 rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:px-5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight text-slate-900 lg:text-xl">
              {wardName}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  error
                    ? 'bg-rose-500'
                    : 'bg-emerald-500 animate-pulse motion-reduce:animate-none',
                )}
                aria-hidden
              />
              <span>อัปเดตอัตโนมัติทุก 20 วินาที</span>
            </p>
            {/* Screen-reader-only summary — also satisfies tests that assert the
                classic "N เตียง · ใช้งาน X · ว่าง Y" string as a single text node. */}
            <span className="sr-only">
              {`${totalBeds} เตียง · ใช้งาน ${occupiedCount} · ว่าง ${freeCount}`}
            </span>
          </div>

          {/* KPI chips — pre-attentive scan of ward state. */}
          <div className="flex flex-wrap items-center gap-2">
            <KpiChip
              icon={<Bed className="h-3.5 w-3.5" />}
              label="ทั้งหมด"
              value={totalBeds}
              tone="neutral"
            />
            <KpiChip
              icon={<UserCheck className="h-3.5 w-3.5" />}
              label="ใช้งาน"
              value={occupiedCount}
              tone="emerald"
            />
            <KpiChip
              icon={<BedDouble className="h-3.5 w-3.5" />}
              label="เตียงว่าง"
              value={freeCount}
              tone="sky"
            />
            {lockedCount > 0 && (
              <KpiChip
                icon={<Lock className="h-3.5 w-3.5" />}
                label="ล็อก"
                value={lockedCount}
                tone="slate"
              />
            )}
            {critical > 0 && (
              <KpiChip
                icon={<Activity className="h-3.5 w-3.5" />}
                label="เสี่ยงสูง"
                value={critical}
                tone="rose"
              />
            )}
          </div>

          <button
            onClick={handleRefresh}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-emerald-400 hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">รีเฟรช</span>
          </button>
        </div>
      </header>

      <WardLayoutView
        beds={beds}
        occupancy={wardOccupancy}
        now={now}
        onBedClick={setSelectedAn}
        onBedMove={(p) => void handleBedMove(p)}
        onMoveRejected={handleMoveRejected}
        reasons={reasons}
      />
      <PatientDrawer
        open={selectedAn !== null}
        occupant={selectedOccupant}
        onClose={() => setSelectedAn(null)}
      />
    </div>
  );
}

type KpiTone = 'neutral' | 'emerald' | 'sky' | 'slate' | 'rose';

const KPI_TONES: Record<KpiTone, { chip: string; value: string; icon: string }> = {
  neutral: { chip: 'bg-slate-50 ring-slate-200',   value: 'text-slate-900',   icon: 'text-slate-500'   },
  emerald: { chip: 'bg-emerald-50 ring-emerald-200', value: 'text-emerald-800', icon: 'text-emerald-600' },
  sky:     { chip: 'bg-sky-50 ring-sky-200',         value: 'text-sky-800',     icon: 'text-sky-600'     },
  slate:   { chip: 'bg-slate-50 ring-slate-200',     value: 'text-slate-700',   icon: 'text-slate-500'   },
  rose:    { chip: 'bg-rose-50 ring-rose-200',       value: 'text-rose-800',    icon: 'text-rose-600'    },
};

function KpiChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: KpiTone;
}) {
  const t = KPI_TONES[tone];
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ring-1',
        t.chip,
      )}
    >
      <span className={t.icon} aria-hidden>
        {icon}
      </span>
      <span className="text-slate-500">{label}</span>
      <span className={cn('font-semibold tabular-nums', t.value)}>{value}</span>
    </div>
  );
}
