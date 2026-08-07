// FlagChip — bordered mono chip for clinical flags (LBW, APGAR<7, TEEN, AMA…).
// Extracted from identical local copies on the outcomes and pregnancies
// boards; the patient detail page is the third consumer.
import type { ReactNode } from 'react';

export function FlagChip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-block border px-1 py-px font-mono text-[12px] font-semibold tracking-[0.04em]"
      style={{ color, borderColor: color, background: 'transparent' }}
    >
      {children}
    </span>
  );
}
