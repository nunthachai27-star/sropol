// PatientPhoto — reusable patient face-photo thumbnail. Fetches the JPEG from
// HOSxP's REST BLOB endpoint (keyed by HN) via getPatientPhoto and renders it
// in an <img>, degrading to a neutral person-silhouette placeholder while
// loading, when no photo is on file (404), or on any error. A patient photo is
// decorative, so failures never surface as an error — they just show the
// placeholder.
'use client';

import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import useSWR from 'swr';
import { getPatientPhoto, type PatientPhotoResponse } from '@/lib/bms-browser-client';
import type { ConnectionConfig } from '@/types/bms-browser';

interface PatientPhotoProps {
  /** Patient hospital number (HN) — the key the photo endpoint uses. */
  hn: string;
  /** Active BMS connection. When absent the placeholder shows and no fetch runs
   *  (keeps presentational parents render-pure in tests without a session). */
  config?: ConnectionConfig | null;
  /** Marketplace token paired with the session, if any. */
  marketplaceToken?: string | null;
  /** Rendered square size in px. Default 44. The photo is requested at 2× for
   *  retina sharpness. */
  size?: number;
  /** Patient name (already PII-masked upstream) for alt text + tooltip. */
  name?: string | null;
  className?: string;
}

export function PatientPhoto({
  hn,
  config,
  marketplaceToken,
  size = 44,
  name,
  className,
}: PatientPhotoProps) {
  const canFetch = Boolean(config && hn);

  const { data } = useSWR<PatientPhotoResponse>(
    canFetch ? ['patient-photo', config!.apiUrl, hn, size] : null,
    () => getPatientPhoto(config!, hn, { width: size * 2, height: size * 2, marketplaceToken }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Derive the object URL in render (deriving it in an effect would need a
  // synchronous setState); the effect below revokes it on change/unmount.
  const objectUrl = useMemo(() => (data?.ok ? URL.createObjectURL(data.blob) : null), [data]);
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const box: CSSProperties = {
    width: size,
    height: size,
    flex: '0 0 auto',
    borderRadius: 6,
    overflow: 'hidden',
    background: '#F1F5F9',
    border: '1px solid #E2E8F0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94A3B8',
  };

  if (objectUrl) {
    return (
      // next/image can't optimize a client-side blob: object URL — plain <img>.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="patient-photo"
        src={objectUrl}
        alt={name ? `รูปผู้ป่วย ${name}` : 'รูปผู้ป่วย'}
        width={size}
        height={size}
        className={className}
        style={{ ...box, objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      data-testid="patient-photo-placeholder"
      className={className}
      style={box}
      role="img"
      aria-label={name ? `ไม่มีรูปผู้ป่วย ${name}` : 'ไม่มีรูปผู้ป่วย'}
      title={name ?? undefined}
    >
      <PersonGlyph size={Math.round(size * 0.6)} />
    </div>
  );
}

function PersonGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v2h16v-2c0-3.31-3.58-6-8-6Z" />
    </svg>
  );
}
