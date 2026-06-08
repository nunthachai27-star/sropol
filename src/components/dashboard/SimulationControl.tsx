// Dev-only simulation control — button + config dialog + live status panel.
// The button + whole component tree only render when process.env.NODE_ENV !==
// 'production'. The backing API routes are also guarded server-side.
'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, Play, Square, AlertCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/base-path';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useSimulation } from '@/hooks/useSimulation';
import { KK_HOSPITALS } from '@/config/hospitals';
import type { SimEventType, SimulationConfig } from '@/services/dev-simulation/types';

interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  scenario?: string;
  eventTypes: SimEventType[];
  ratePerHospitalPerMin: number;
  durationMin: number;
}

const PRESETS: ScenarioPreset[] = [
  {
    id: 'normal',
    label: 'Normal shift',
    description: 'Baseline flow — all 5 event types. ANC patients graduate to Labor via shared CID; partographs follow admissions.',
    eventTypes: ['labor', 'anc', 'referral', 'referral_update', 'partograph'],
    ratePerHospitalPerMin: 0.5,
    durationMin: 15,
  },
  {
    id: 'busy',
    label: 'Busy shift',
    description: '3× the normal rate; stresses every dashboard surface at peak density.',
    eventTypes: ['labor', 'anc', 'referral', 'referral_update', 'partograph'],
    ratePerHospitalPerMin: 1.5,
    durationMin: 10,
  },
  {
    id: 'pph',
    label: 'PPH outbreak',
    description:
      'HIGH-risk labor + urgent referrals + partograph CRITICAL alerts to exercise glow/alert paths.',
    scenario: 'PPH (postpartum hemorrhage) outbreak in several community hospitals; escalate urgencies.',
    eventTypes: ['labor', 'referral', 'partograph'],
    ratePerHospitalPerMin: 1.2,
    durationMin: 10,
  },
  {
    id: 'anc',
    label: 'ANC only',
    description: 'Exercises the pregnancy continuum without changing the labor pool.',
    eventTypes: ['anc'],
    ratePerHospitalPerMin: 1,
    durationMin: 10,
  },
  {
    id: 'referral-flow',
    label: 'Referral flow',
    description: 'Creates referrals + advances their status (ACCEPTED → IN_TRANSIT → ARRIVED). Good for the referrals page.',
    eventTypes: ['referral', 'referral_update'],
    ratePerHospitalPerMin: 0.8,
    durationMin: 10,
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Define your own prompt / event types / rate.',
    eventTypes: ['labor'],
    ratePerHospitalPerMin: 0.5,
    durationMin: 10,
  },
];

const ALL_EVENT_TYPES: Array<{ key: SimEventType; label: string }> = [
  { key: 'labor', label: 'Labor admission' },
  { key: 'anc', label: 'ANC visit' },
  { key: 'referral', label: 'Referral create' },
  { key: 'referral_update', label: 'Referral update' },
  { key: 'partograph', label: 'Partograph obs.' },
];

export function SimulationControl() {
  const [open, setOpen] = useState(false);
  const { status, start, stop, clear } = useSimulation();
  const [models, setModels] = useState<Array<{ id: string }>>([{ id: 'gemma4' }]);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  // Fresh-start option + destructive-clear confirm state.
  const [startFresh, setStartFresh] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);
  const [clearResult, setClearResult] = useState<Record<string, number> | null>(null);
  // Reset-onboarding (admin-side wipe) — separate destructive action that
  // deactivates registered hospitals + drops BMS configs + revokes webhook
  // keys. Distinct from clear-patient-data so each can be triggered alone.
  const [confirmResetOnboarding, setConfirmResetOnboarding] = useState<boolean>(false);
  const [resettingOnboarding, setResettingOnboarding] = useState<boolean>(false);
  const [resetOnboardingResult, setResetOnboardingResult] = useState<Record<string, number> | null>(null);

  // Form state
  const [presetId, setPresetId] = useState<string>('normal');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const [selectedHospitals, setSelectedHospitals] = useState<Set<string>>(
    new Set(KK_HOSPITALS.map((h) => h.hcode)),
  );
  const [eventTypes, setEventTypes] = useState<Set<SimEventType>>(new Set(preset.eventTypes));
  const [rate, setRate] = useState<number>(preset.ratePerHospitalPerMin);
  const [durationMin, setDurationMin] = useState<number>(preset.durationMin);
  const [model, setModel] = useState<string>('gemma4');
  const [scenario, setScenario] = useState<string>(preset.scenario ?? '');

  // Re-apply preset defaults when preset changes (but not when user tweaks individual fields).
  useEffect(() => {
    setEventTypes(new Set(preset.eventTypes));
    setRate(preset.ratePerHospitalPerMin);
    setDurationMin(preset.durationMin);
    setScenario(preset.scenario ?? '');
  }, [presetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch available models once the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(withBasePath('/api/dev/simulate/models'))
      .then((r) => r.json())
      .then((body: { models?: Array<{ id: string }>; error?: string }) => {
        if (cancelled) return;
        if (body.models && body.models.length) {
          setModels(body.models);
          if (!body.models.some((m) => m.id === model)) {
            setModel(body.models[0].id);
          }
        }
        if (body.error) setModelsErr(body.error);
      })
      .catch((e) => !cancelled && setModelsErr(String(e)));
    return () => {
      cancelled = true;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleHospital = (hcode: string) => {
    setSelectedHospitals((prev) => {
      const next = new Set(prev);
      if (next.has(hcode)) next.delete(hcode);
      else next.add(hcode);
      return next;
    });
  };

  const toggleEventType = (t: SimEventType) => {
    setEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const onStart = async () => {
    setSubmitErr(null);
    setSubmitting(true);
    try {
      // If "Start fresh" is ticked, wipe the DB before launching the workers.
      if (startFresh) {
        const res = await clear();
        setClearResult(res.cleared);
      }
      const config: SimulationConfig = {
        hospitals: selectedHospitals.size === KK_HOSPITALS.length ? [] : Array.from(selectedHospitals),
        eventTypes: Array.from(eventTypes),
        ratePerHospitalPerMin: rate,
        durationMin,
        model,
        scenario: scenario || undefined,
      };
      await start(config);
      setOpen(false);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onStop = async () => {
    try {
      await stop();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    }
  };

  const onClear = async () => {
    setSubmitErr(null);
    setClearing(true);
    try {
      const res = await clear();
      setClearResult(res.cleared);
      setConfirmClear(false);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  };

  const onResetOnboarding = async () => {
    setSubmitErr(null);
    setResettingOnboarding(true);
    try {
      const res = await fetch(withBasePath('/api/dev/simulate/reset-onboarding'), { method: 'POST' });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; cleared?: Record<string, number>; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `reset-onboarding failed (${res.status})`);
      }
      setResetOnboardingResult(body.cleared ?? {});
      setConfirmResetOnboarding(false);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setResettingOnboarding(false);
    }
  };

  const totalEvents = status.hospitals.reduce(
    (acc, h) => acc + h.eventsSucceeded + h.eventsFailed,
    0,
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] transition-colors',
          status.running
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'border border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100',
        )}
        title="Dev simulation (visible in development only)"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {status.running ? `SIM · ${totalEvents}` : 'SIMULATE'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="!max-w-[960px] w-[95vw] max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[960px]"
          style={{ background: '#fffdfa' }}
        >
          <DialogHeader
            className="flex flex-row items-center justify-between gap-4 border-b px-5 py-3"
            style={{ borderColor: 'var(--rule-strong)', background: '#f59e0b' }}
          >
            <div>
              <DialogTitle className="flex items-center gap-2 text-[16px] font-semibold uppercase tracking-[0.06em] text-white">
                <FlaskConical className="h-4 w-4" /> Dev simulation
              </DialogTitle>
              <DialogDescription className="font-mono text-[11px] tracking-[0.1em] text-white/85">
                Synthetic events generated by Gemma-4 · writes to local DB · DEV ONLY
              </DialogDescription>
            </div>
            {status.running && (
              <span className="rounded-sm bg-white px-2 py-1 font-mono text-[11px] font-semibold text-amber-700">
                RUNNING · {totalEvents} events
              </span>
            )}
          </DialogHeader>

          <div className="grid h-full overflow-hidden" style={{ gridTemplateColumns: '1fr 360px' }}>
            {/* LEFT — config form */}
            <div className="overflow-auto px-5 py-4" style={{ maxHeight: '78vh' }}>
              {/* Preset */}
              <section>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                  01 · Scenario preset
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPresetId(p.id)}
                      className={cn(
                        'rounded-sm border px-3 py-2 text-left transition-colors',
                        presetId === p.id
                          ? 'border-amber-500 bg-amber-50'
                          : 'border-[var(--rule-strong)] bg-white hover:bg-[var(--accent-navy-soft)]',
                      )}
                    >
                      <div className="text-[13px] font-semibold text-[var(--ink-navy)]">{p.label}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--ink-navy-muted)]">
                        {p.description}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Event types */}
              <section className="mt-5">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                  02 · Event types
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ALL_EVENT_TYPES.map((et) => (
                    <label
                      key={et.key}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px]',
                        eventTypes.has(et.key)
                          ? 'border-amber-500 bg-amber-50 text-amber-800'
                          : 'border-[var(--rule-strong)] bg-white text-[var(--ink-navy-dim)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={eventTypes.has(et.key)}
                        onChange={() => toggleEventType(et.key)}
                        className="sr-only"
                      />
                      {et.label}
                    </label>
                  ))}
                </div>
              </section>

              {/* Rate + duration */}
              <section className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                    03 · Rate · events/min/hospital
                  </h3>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="range"
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={rate}
                      onChange={(e) => setRate(parseFloat(e.target.value))}
                      className="flex-1 accent-amber-500"
                    />
                    <span className="font-mono text-sm tabular-nums">{rate.toFixed(1)}</span>
                  </div>
                </div>
                <div>
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                    04 · Duration · minutes
                  </h3>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={60}
                      step={1}
                      value={durationMin}
                      onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}
                      className="flex-1 accent-amber-500"
                    />
                    <span className="font-mono text-sm tabular-nums">{durationMin}m</span>
                  </div>
                </div>
              </section>

              {/* Scenario prompt */}
              {presetId === 'custom' || scenario ? (
                <section className="mt-5">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                    05 · Scenario prompt (optional — steers LLM narrative)
                  </h3>
                  <textarea
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                    rows={3}
                    placeholder="e.g. Heavy rains — many referrals from ชุมแพ + สีชมพู to the regional hospital"
                    className="mt-2 w-full rounded-sm border border-[var(--rule-strong)] bg-white px-3 py-2 text-[13px] focus:border-amber-500 focus:outline-none"
                  />
                </section>
              ) : null}

              {/* Model */}
              <section className="mt-5">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                  06 · LLM model
                </h3>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-2 w-full rounded-sm border border-[var(--rule-strong)] bg-white px-3 py-1.5 text-[13px] focus:border-amber-500 focus:outline-none"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
                {modelsErr && (
                  <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-amber-700">
                    <AlertCircle className="h-3 w-3" /> {modelsErr}
                  </div>
                )}
              </section>

              {/* Hospitals */}
              <section className="mt-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                    07 · Hospitals ({selectedHospitals.size}/{KK_HOSPITALS.length})
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedHospitals(new Set(KK_HOSPITALS.map((h) => h.hcode)))}
                      className="font-mono text-[10px] tracking-[0.1em] text-[var(--accent-navy)] hover:underline"
                    >
                      ALL
                    </button>
                    <button
                      onClick={() => setSelectedHospitals(new Set())}
                      className="font-mono text-[10px] tracking-[0.1em] text-[var(--accent-navy)] hover:underline"
                    >
                      NONE
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {KK_HOSPITALS.map((h) => (
                    <label
                      key={h.hcode}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1 text-[12px] transition-colors',
                        selectedHospitals.has(h.hcode)
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-[var(--rule-hair)] bg-white hover:bg-[var(--accent-navy-soft)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedHospitals.has(h.hcode)}
                        onChange={() => toggleHospital(h.hcode)}
                        className="accent-amber-500"
                      />
                      <span className="truncate text-[var(--ink-navy-dim)]">{h.name}</span>
                      <span className="ml-auto font-mono text-[9px] text-[var(--ink-navy-muted)]">
                        {h.hcode}
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              {/* Data management — destructive zone */}
              <section className="mt-5 rounded-sm border border-red-200 bg-red-50/60 p-3">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-700">
                  08 · Data management
                </h3>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <label
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[12px]',
                      startFresh
                        ? 'border-red-400 bg-white text-red-700'
                        : 'border-[var(--rule-hair)] bg-white text-[var(--ink-navy-dim)]',
                    )}
                    title="Wipe patient/journey/labor data only — registered hospitals and API keys are preserved."
                  >
                    <input
                      type="checkbox"
                      checked={startFresh}
                      onChange={(e) => setStartFresh(e.target.checked)}
                      className="accent-red-500"
                      disabled={status.running}
                    />
                    <Trash2 className="h-3.5 w-3.5" />
                    Start fresh — clear patient data before starting
                  </label>
                  {!confirmClear ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmClear(true);
                        setClearResult(null);
                      }}
                      disabled={status.running || clearing}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-red-400 bg-white px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-red-600 hover:bg-red-100 disabled:opacity-40"
                      title={
                        status.running
                          ? 'Stop the running simulation first'
                          : 'Wipe patient/journey/labor data only — registered hospitals and webhook API keys are preserved (dev only)'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear patient data
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-red-700">
                        ยืนยันการลบข้อมูลผู้ป่วย/journey/labor? (โรงพยาบาลที่ลงทะเบียนและ API key จะไม่ถูกลบ)
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ink-navy-dim)]">
                        Patient/journey/labor data only — registered hospitals and API keys preserved.
                      </span>
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmClear(false)}
                          disabled={clearing}
                          className="rounded-sm border border-[var(--rule-strong)] bg-white px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] text-[var(--ink-navy-dim)] hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={onClear}
                          disabled={clearing}
                          className="inline-flex items-center gap-1 rounded-sm bg-red-600 px-3 py-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          <Trash2 className="h-3 w-3" />
                          {clearing ? 'Clearing…' : 'Clear patient data'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {clearResult && (
                  <div className="mt-2 font-mono text-[10px] text-[var(--ink-navy-dim)]">
                    <span className="font-semibold text-red-700">Cleared:</span>{' '}
                    {Object.entries(clearResult)
                      .filter(([, n]) => n > 0)
                      .map(([t, n]) => `${t}=${n}`)
                      .join(' · ') || 'already empty'}
                  </div>
                )}

                {/* Reset onboarding — NUCLEAR. Hard-deletes hospitals + every
                    FK-dependent row (cached_*, journey, BMS config, webhook
                    keys). Distinct from "Clear patient data" — that one
                    preserves the hospital registry; this one wipes it too. */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-red-200 pt-3">
                  <div className="text-[11px] leading-snug text-[var(--ink-navy-dim)]">
                    <strong className="text-red-700">Reset onboarding</strong> · NUCLEAR &mdash;
                    ลบโรงพยาบาลที่ลงทะเบียน + BMS config + webhook keys + ข้อมูลผู้ป่วย/journey
                    ที่ link กับ รพ. ทั้งหมด (FK constraints)
                  </div>
                  {!confirmResetOnboarding ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmResetOnboarding(true);
                        setResetOnboardingResult(null);
                      }}
                      disabled={status.running || resettingOnboarding || clearing}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-red-500 bg-white px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-red-700 hover:bg-red-100 disabled:opacity-40"
                      title={
                        status.running
                          ? 'Stop the running simulation first'
                          : 'Hard-delete ALL hospitals + cached patient/journey data + BMS configs + webhook keys (dev only, irreversible)'
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Reset onboarding
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] font-semibold text-red-800">
                        ยืนยัน Reset onboarding? ทุกอย่างที่ link กับ รพ. จะถูกลบหมด —
                        registry, BMS config, webhook keys, patient/journey/partograph caches
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ink-navy-dim)]">
                        Hard-delete; irreversible. Re-add hospitals via /admin → โรงพยาบาล tab.
                      </span>
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmResetOnboarding(false)}
                          disabled={resettingOnboarding}
                          className="rounded-sm border border-[var(--rule-strong)] bg-white px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] text-[var(--ink-navy-dim)] hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={onResetOnboarding}
                          disabled={resettingOnboarding}
                          className="inline-flex items-center gap-1 rounded-sm bg-red-700 px-3 py-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-white hover:bg-red-800 disabled:opacity-60"
                        >
                          <Trash2 className="h-3 w-3" />
                          {resettingOnboarding ? 'Resetting…' : 'Reset onboarding'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {resetOnboardingResult && (
                  <div className="mt-2 font-mono text-[10px] text-[var(--ink-navy-dim)]">
                    <span className="font-semibold text-red-700">Onboarding reset:</span>{' '}
                    {Object.entries(resetOnboardingResult)
                      .filter(([, n]) => n > 0)
                      .map(([t, n]) => `${t}=${n}`)
                      .join(' · ') || 'already empty'}
                  </div>
                )}
              </section>

              {/* Actions */}
              <section className="mt-6 flex items-center justify-between gap-3 border-t pt-4"
                       style={{ borderColor: 'var(--rule-strong)' }}>
                <div className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                  {submitErr && (
                    <span className="text-red-600">
                      <AlertCircle className="mr-1 inline h-3 w-3" />
                      {submitErr}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-sm border border-[var(--rule-strong)] bg-white px-4 py-1.5 font-mono text-[11px] tracking-[0.06em] text-[var(--ink-navy-dim)] hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  {status.running ? (
                    <button
                      onClick={onStop}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-red-500 px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-white hover:bg-red-600"
                    >
                      <Square className="h-3.5 w-3.5" /> Stop simulation
                    </button>
                  ) : (
                    <button
                      onClick={onStart}
                      disabled={submitting || eventTypes.size === 0 || selectedHospitals.size === 0}
                      className="inline-flex items-center gap-1.5 rounded-sm bg-amber-500 px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {submitting
                        ? startFresh ? 'Clearing + starting…' : 'Starting…'
                        : startFresh ? 'Clear + start simulation' : 'Start simulation'}
                    </button>
                  )}
                </div>
              </section>
            </div>

            {/* RIGHT — live status panel */}
            <aside
              className="border-l bg-[var(--surface-cool)] overflow-hidden"
              style={{ borderColor: 'var(--rule-strong)', maxHeight: '78vh' }}
            >
              <div className="border-b p-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]"
                   style={{ borderColor: 'var(--rule-strong)' }}>
                Live status
              </div>
              {!status.running && status.hospitals.length === 0 ? (
                <div className="p-6 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]">
                  Idle — start a simulation to see per-hospital progress here.
                </div>
              ) : (
                <div className="flex h-full flex-col overflow-hidden">
                  <div className="flex-shrink-0 border-b p-3"
                       style={{ borderColor: 'var(--rule-strong)' }}>
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-semibold">Active hospitals</span>
                      <span className="font-mono">
                        {status.hospitals.filter((h) => h.running).length} /
                        {status.hospitals.length}
                      </span>
                    </div>
                    {status.stoppingAt && (
                      <div className="mt-1 font-mono text-[10px] text-[var(--ink-navy-muted)]">
                        auto-stop {new Date(status.stoppingAt).toLocaleTimeString('th-TH')}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto">
                    {status.hospitals
                      .slice()
                      .sort((a, b) => b.eventsSucceeded + b.eventsFailed - (a.eventsSucceeded + a.eventsFailed))
                      .map((h) => (
                        <div
                          key={h.hcode}
                          className="border-b px-3 py-2 text-[11px]"
                          style={{ borderColor: 'var(--rule-hair)' }}
                        >
                          <div className="flex items-baseline justify-between">
                            <span className="truncate">{h.hospitalName}</span>
                            <span className="font-mono font-semibold text-[var(--accent-navy)]">
                              {h.eventsSucceeded}
                            </span>
                          </div>
                          {h.eventsFailed > 0 && (
                            <div className="font-mono text-[10px] text-red-600">
                              {h.eventsFailed} failed
                            </div>
                          )}
                          {h.lastError && (
                            <div className="truncate font-mono text-[9px] text-red-500" title={h.lastError}>
                              {h.lastError}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                  <div className="flex-shrink-0 border-t p-3"
                       style={{ borderColor: 'var(--rule-strong)' }}>
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
                      Recent events
                    </div>
                    <div className="mt-2 max-h-40 overflow-auto font-mono text-[10px]">
                      {status.recentEvents.slice().reverse().map((e, i) => (
                        <div
                          key={i}
                          className={cn(
                            'truncate py-0.5',
                            e.ok ? 'text-[var(--ink-navy-dim)]' : 'text-red-600',
                          )}
                          title={e.error || e.summary}
                        >
                          {new Date(e.at).toLocaleTimeString('th-TH')} · {e.hcode} · {e.summary}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
