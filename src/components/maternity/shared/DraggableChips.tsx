// Shared chip primitives used across maternity entry dialogs and tab inputs.
// Extracted from VitalSignEntryDialog / PartographEntryDialog so every numeric
// helper chip behaves identically:
//   * tap to set the exact preset value
//   * click-and-drag horizontally to micro-adjust by ±step (1 for int,
//     0.1 for float)
//   * range-clamp the previewed value with an amber edge ring when the drag
//     hits a min/max boundary
//   * per-chip clinical tone (default cyan / ok green / warn amber / crit red
//     / severity-N pain ladder)
'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export const DRAG_PX_PER_STEP = 8;

export type ChipTone =
  | 'default'
  | 'ok'
  | 'warn'
  | 'crit'
  | 'severity-0'
  | 'severity-2'
  | 'severity-4'
  | 'severity-6'
  | 'severity-8'
  | 'severity-10';

export const CHIP_TONE_CLASSES: Record<ChipTone, { selected: string; unselected: string }> = {
  default: {
    selected: 'border-cyan-600 bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-600/20',
    unselected:
      'border-slate-200 bg-white text-slate-700 hover:border-cyan-400 hover:bg-cyan-50/60 hover:text-cyan-700',
  },
  ok: {
    selected: 'border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20',
    unselected:
      'border-emerald-300 bg-emerald-50/60 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50',
  },
  warn: {
    selected: 'border-amber-600 bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20',
    unselected:
      'border-amber-300 bg-amber-50/60 text-amber-700 hover:border-amber-500 hover:bg-amber-50',
  },
  crit: {
    selected: 'border-rose-600 bg-rose-600 text-white shadow-sm ring-2 ring-rose-600/20',
    unselected:
      'border-rose-300 bg-rose-50/60 text-rose-700 hover:border-rose-500 hover:bg-rose-50',
  },
  'severity-0': {
    selected: 'border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/20',
    unselected:
      'border-emerald-300 bg-emerald-50/60 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50',
  },
  'severity-2': {
    selected: 'border-lime-600 bg-lime-600 text-white shadow-sm ring-2 ring-lime-600/20',
    unselected:
      'border-lime-300 bg-lime-50/60 text-lime-700 hover:border-lime-500 hover:bg-lime-50',
  },
  'severity-4': {
    selected: 'border-yellow-600 bg-yellow-500 text-white shadow-sm ring-2 ring-yellow-600/20',
    unselected:
      'border-yellow-300 bg-yellow-50/60 text-yellow-700 hover:border-yellow-500 hover:bg-yellow-50',
  },
  'severity-6': {
    selected: 'border-amber-600 bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20',
    unselected:
      'border-amber-300 bg-amber-50/60 text-amber-700 hover:border-amber-500 hover:bg-amber-50',
  },
  'severity-8': {
    selected: 'border-orange-600 bg-orange-600 text-white shadow-sm ring-2 ring-orange-600/20',
    unselected:
      'border-orange-300 bg-orange-50/60 text-orange-700 hover:border-orange-500 hover:bg-orange-50',
  },
  'severity-10': {
    selected: 'border-red-700 bg-red-700 text-white shadow-sm ring-2 ring-red-700/20',
    unselected: 'border-red-400 bg-red-100/80 text-red-700 hover:border-red-600 hover:bg-red-100',
  },
};

export interface ChipOption {
  value: string;
  label: string;
  tone?: ChipTone;
}

interface DraggableChipProps {
  chip: ChipOption;
  selected: string;
  onPick: (v: string) => void;
  step: number;
  isFloat: boolean;
  range?: { min: number; max: number };
}

export function DraggableChip({
  chip,
  selected,
  onPick,
  step,
  isFloat,
  range,
}: DraggableChipProps) {
  const [drag, setDrag] = useState<{
    startX: number;
    startVal: number;
    preview: string;
    clamped: boolean;
    moved: boolean;
  } | null>(null);
  const movedRef = useRef(false);
  const fmt = (n: number): string => (isFloat ? n.toFixed(1) : String(Math.round(n)));
  const isSelected = drag ? selected === drag.preview : selected === chip.value;
  const displayLabel = drag ? drag.preview : chip.label;
  const toneClasses = CHIP_TONE_CLASSES[chip.tone ?? 'default'];

  return (
    <button
      type="button"
      onClick={(e) => {
        if (movedRef.current) {
          movedRef.current = false;
          e.preventDefault();
          return;
        }
        onPick(chip.value);
      }}
      onPointerDown={(e) => {
        const startVal = parseFloat(chip.value);
        if (!Number.isFinite(startVal)) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        movedRef.current = false;
        setDrag({ startX: e.clientX, startVal, preview: chip.value, clamped: false, moved: false });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const stepsCount = Math.round(dx / DRAG_PX_PER_STEP);
        if (stepsCount === 0) return;
        movedRef.current = true;
        const raw = drag.startVal + stepsCount * step;
        const clamped = range ? Math.max(range.min, Math.min(range.max, raw)) : raw;
        const wasClamped = clamped !== raw;
        const preview = fmt(clamped);
        if (preview !== drag.preview || wasClamped !== drag.clamped) {
          setDrag({ ...drag, preview, clamped: wasClamped, moved: true });
        }
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (movedRef.current) onPick(drag.preview);
        setDrag(null);
      }}
      onPointerCancel={() => {
        setDrag(null);
        movedRef.current = false;
      }}
      title={
        range
          ? `แตะเพื่อเลือก · ลากซ้าย/ขวาเพื่อปรับค่า (${range.min}–${range.max})`
          : 'แตะเพื่อเลือก · ลากซ้าย/ขวาเพื่อปรับค่า'
      }
      className={cn(
        'min-w-[48px] cursor-ew-resize touch-none select-none rounded-md border px-3 py-1.5 text-[13px] font-semibold tabular-nums transition-all',
        isSelected ? toneClasses.selected : toneClasses.unselected,
        drag && drag.moved && !drag.clamped && 'scale-110 shadow-lg ring-2 ring-cyan-400',
        drag &&
          drag.moved &&
          drag.clamped &&
          'scale-110 shadow-lg ring-2 ring-amber-400 cursor-not-allowed',
      )}
    >
      {displayLabel}
    </button>
  );
}

interface ChipRowProps {
  options: ReadonlyArray<ChipOption>;
  selected: string;
  onPick: (v: string) => void;
  ariaLabel?: string;
  step?: number;
  isFloat?: boolean;
  range?: { min: number; max: number };
}

export function ChipRow({
  options,
  selected,
  onPick,
  ariaLabel,
  step = 1,
  isFloat = false,
  range,
}: ChipRowProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <DraggableChip
          key={o.value}
          chip={o}
          selected={selected}
          onPick={onPick}
          step={step}
          isFloat={isFloat}
          range={range}
        />
      ))}
    </div>
  );
}

// SimpleChipRow — for non-numeric / categorical pickers (e.g., "ชาย/หญิง",
// "PRN", "1x3 oral"). No drag, no severity tone math — just tap to pick.
interface SimpleChipRowProps {
  options: ReadonlyArray<string | { label: string; value: string }>;
  selected: string;
  onPick: (v: string) => void;
  ariaLabel?: string;
}

export function SimpleChipRow({ options, selected, onPick, ariaLabel }: SimpleChipRowProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const value = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const isSelected = selected === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onPick(value)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-all',
              isSelected
                ? 'border-cyan-600 bg-cyan-600 text-white shadow-sm ring-2 ring-cyan-600/20'
                : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-400 hover:bg-cyan-50/60 hover:text-cyan-700',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
