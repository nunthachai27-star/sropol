// LookupAutocomplete — generic typeahead with debounced search + portal
// dropdown. One primitive used by every "search master by name" picker
// in the refer-out dialog (hospital / doctor / spclty / ICD10) and by
// the discharge tab's dch_doctor input.
//
// Bug fix from the previous HospitalPicker (this revision): the parent
// re-seeding useEffect updated lastPickedRef.current on every value
// change. The search effect's "skip if query equals lastPicked" guard
// then short-circuited every keystroke (because the parent's onChange
// echoed the typed text into `value`, which seeded lastPicked to the
// same string). Now lastPickedRef updates ONLY when:
//   1. The component mounts (initial seed).
//   2. The user explicitly picks an item.
//   3. The parent provides a *different* committed value the picker
//      hasn't seen (e.g., loading an existing record).
'use client';

import { useEffect, useRef, useState } from 'react';
import { AnchoredDropdown } from './AnchoredDropdown';

export interface LookupItem {
  /** Stored value (committed to the form / DB). */
  value: string;
  /** Display label shown as the visible search-input text after pick
   *  AND as the primary line in the dropdown. */
  primary: string;
  /** Optional small caption (e.g. the code, when primary is the name). */
  secondary?: string;
}

export interface LookupAutocompleteProps {
  ariaLabel: string;
  placeholder?: string;
  /** The currently-committed value (e.g. draft.refer_hospcode). */
  value: string;
  /** Display label paired with `value`. When present, the input shows
   *  this text on mount; the actual value travels via onPick. Used when
   *  loading an existing record (we have the code, may not have the name).
   *  Empty string is fine when fresh. */
  valueLabel?: string;
  /** Async fetcher invoked after 300ms debounce; returns up to N results. */
  fetch: (query: string) => Promise<LookupItem[]>;
  /** Called when the operator picks an item from the dropdown — commit the
   *  selected value to your form state here. */
  onPick: (item: LookupItem) => void;
  /** Optional: invoked on every keystroke with the raw text. Useful when
   *  the parent wants to allow free-text entry as a fallback for codes
   *  not in the master (rare; the discharge tab does this). */
  onChange?: (raw: string) => void;
  /** Tailwind class override for the input. */
  className?: string;
}

const DEFAULT_INPUT_CLS =
  'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-[14px] text-slate-900 shadow-sm transition-colors hover:border-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20';

export function LookupAutocomplete({
  ariaLabel,
  placeholder,
  value,
  valueLabel,
  fetch,
  onPick,
  onChange,
  className,
}: LookupAutocompleteProps) {
  const [query, setQuery] = useState(valueLabel || value);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // lastPicked tracks "what string represents an already-resolved pick".
  // Search stays inactive while query equals this — so re-rendering with
  // the picked text doesn't fire another search. CRITICAL: only updated
  // on pick or via the render-phase re-seed below (which itself gates on
  // actual value change).
  const [lastPicked, setLastPicked] = useState(valueLabel || value);
  // committed tracks the parent's committed value the picker has observed.
  // Lets the render-phase re-seed below fire only when a genuinely new
  // value arrives (not when the parent echoes our own onChange back).
  const [committed, setCommitted] = useState(value);

  // Render-phase adjust (react.dev "you might not need an effect"): re-seed
  // from parent only when the committed value changes to something new
  // (e.g., dialog opens with an existing referout row). Plain echo of the
  // user's typing is filtered out because `committed` is only updated here.
  if (value !== committed) {
    setCommitted(value);
    const seed = valueLabel || value;
    setQuery(seed);
    setLastPicked(seed);
  }

  // Derived visible list — search is "active" only when there's a trimmed
  // query that doesn't equal the last picked / parent-seeded value; when
  // inactive the dropdown shows nothing, no effect-driven clear needed.
  const trimmed = query.trim();
  const searchActive = trimmed.length > 0 && trimmed !== lastPicked;
  const visibleItems = searchActive ? items : [];

  // Debounced search effect — only runs while search is active.
  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(trimmed)
        .then((rows) => {
          if (!cancelled) setItems(rows);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, searchActive, fetch]);

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          if (onChange) onChange(v);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className ?? DEFAULT_INPUT_CLS}
      />
      <AnchoredDropdown
        open={open && (visibleItems.length > 0 || loading)}
        anchorRef={inputRef}
        onDismiss={() => setOpen(false)}
      >
        {loading && visibleItems.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-slate-500">กำลังค้นหา…</div>
        )}
        {visibleItems.map((it) => (
          <button
            key={`${it.value}-${it.primary}`}
            type="button"
            onClick={() => {
              onPick(it);
              setQuery(it.primary);
              setLastPicked(it.primary);
              setCommitted(it.value);
              setOpen(false);
              setItems([]);
            }}
            className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-cyan-50/60"
          >
            <span className="text-[14px] font-semibold text-slate-900">{it.primary}</span>
            {it.secondary && (
              <span className="font-mono text-[11px] text-slate-500">{it.secondary}</span>
            )}
          </button>
        ))}
      </AnchoredDropdown>
    </>
  );
}
