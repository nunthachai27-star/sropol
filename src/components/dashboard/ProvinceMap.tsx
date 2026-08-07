// ProvinceMap — public entry. Dynamically imports the Leaflet implementation
// so Next.js SSR doesn't try to evaluate `window`-dependent code on the
// server, and the ~200KB Leaflet bundle only ships when the map is rendered.
'use client';

import dynamic from 'next/dynamic';
import type { DashboardHospital } from '@/types/api';

export interface ProvinceMapProps {
  hospitals: DashboardHospital[];
  selected?: string | null;
  onSelect?: (hcode: string | null) => void;
  mode?: 'light' | 'kiosk';
  /** Visual density. 'mini' (default) = thinner boundary lines + smaller markers
   *  for inline dashboard use; 'full' = heavier strokes for a fullscreen dialog. */
  size?: 'mini' | 'full';
}

// System-reserved hcodes never belong on the GIS map even after they get
// auto-registered for onboarding/sandbox purposes (see
// /api/onboarding/webhook-key + EXEMPT_HCODES in lib/hospital-access-guard).
// Mirrors that set deliberately — keep in sync if it ever expands. Filtered
// here at the wrapper so every map consumer (dashboard, admin, kiosk) gets
// the exclusion automatically without each having to remember.
const MAP_EXCLUDED_HCODES: ReadonlySet<string> = new Set(['00000', '99999']);

const ProvinceMapLeaflet = dynamic(() => import('./ProvinceMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-full w-full place-items-center"
      style={{ background: 'var(--surface-cool)' }}
    >
      <span className="font-mono text-[12px] tracking-[0.18em] text-[var(--ink-navy-muted)]">
        LOADING MAP…
      </span>
    </div>
  ),
});

export function ProvinceMap(props: ProvinceMapProps) {
  const hospitals = props.hospitals.filter((h) => !MAP_EXCLUDED_HCODES.has(h.hcode));
  return <ProvinceMapLeaflet {...props} hospitals={hospitals} />;
}
