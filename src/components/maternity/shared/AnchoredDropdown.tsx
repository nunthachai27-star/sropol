// Portal-based dropdown anchored under a trigger element. Use when the
// dropdown needs to escape an ancestor with `overflow: hidden` (e.g., a
// rounded table wrapper) — the previous absolute-positioned variant was
// clipped inside ComplicationsTab / MedicationsTab / StageMedTab edit rows.
//
// Implementation:
//   * `createPortal(children, document.body)` renders the dropdown outside
//     any clipping ancestor.
//   * Positioned with `position: fixed` using the trigger's
//     getBoundingClientRect() — re-measured on window scroll, resize, and
//     whenever the `open` prop transitions from false → true.
'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface AnchoredDropdownProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  /** Called when a click lands outside the trigger AND the dropdown.
   *  Caller is expected to set `open=false`. */
  onDismiss: () => void;
  /** Tailwind class applied to the dropdown's outer <div>. The default
   *  matches the existing v2 dropdown style across maternity tabs. */
  className?: string;
  children: ReactNode;
}

export function AnchoredDropdown({
  open,
  anchorRef,
  onDismiss,
  className,
  children,
}: AnchoredDropdownProps) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Layout effect runs synchronously after DOM mutation but before paint —
  // avoids a flash of the dropdown at (0,0) on first open.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      // No sync setState here (react-hooks/set-state-in-effect): the render
      // guard `if (!open || !pos) return null` hides the closed dropdown, and
      // reopening re-measures below before paint, so stale pos never shows.
      return;
    }
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const a = anchorRef.current;
      const d = dropdownRef.current;
      const t = e.target as Node | null;
      if (!t) return;
      if (a && a.contains(t)) return;
      if (d && d.contains(t)) return;
      onDismiss();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, anchorRef, onDismiss]);

  if (!open || !pos) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 50,
      }}
      className={
        className ??
        'max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg'
      }
    >
      {children}
    </div>,
    document.body,
  );
}
