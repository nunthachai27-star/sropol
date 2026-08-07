// IncompleteAssessmentMarker — amber "assessment incomplete" chip. Extracted
// from the journey detail page (WHO containment T6: an incomplete LOW
// assessment must never display as a bare confirmed-LOW chip) so the
// maternal labor-triage screening card (Phase 4 U2) can reuse the identical
// visual for its own `isComplete: false` state without duplicating markup.
'use client';

import { AlertTriangle } from 'lucide-react';

interface IncompleteAssessmentMarkerProps {
  missingCount: number;
  /** Overrides the default testid — lets a second consumer pick its own selector. */
  'data-testid'?: string;
}

export function IncompleteAssessmentMarker({
  missingCount,
  'data-testid': testId = 'anc-assessment-incomplete-marker',
}: IncompleteAssessmentMarkerProps) {
  return (
    <span
      className="inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.06em]"
      style={{
        color: 'var(--risk-medium)',
        borderColor: 'var(--risk-medium)',
        background: 'rgba(234, 179, 8, 0.08)',
      }}
      data-testid={testId}
    >
      <AlertTriangle className="h-3 w-3" />
      {`การประเมินความเสี่ยงไม่สมบูรณ์ (ขาดข้อมูล ${missingCount} รายการ)`}
    </span>
  );
}
