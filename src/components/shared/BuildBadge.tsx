// Tiny fixed-position badge showing the deployed build's git SHA + time.
// Lets you verify "did the new build actually go out?" at a glance without
// opening DevTools — especially useful behind a CDN/proxy that may serve
// stale HTML. Values are injected by `next.config.ts` at build time as
// NEXT_PUBLIC_BUILD_ID + NEXT_PUBLIC_BUILD_TIME.
//
// Hover to see the full build timestamp; otherwise renders as a faint
// monospace pill in the bottom-right that doesn't compete with content.
'use client';

import { APP_VERSION_LABEL } from '@/lib/app-version';

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';

export function BuildBadge() {
  // Format the build time compactly: drop the milliseconds + timezone offset
  // so "2026-04-29T03:55:12.345Z" → "2026-04-29 03:55Z" for the visible label.
  // Full ISO stays in the tooltip for precision when debugging.
  let shortTime = '';
  if (BUILD_TIME) {
    const m = BUILD_TIME.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    shortTime = m ? `${m[1]} ${m[2]}Z` : BUILD_TIME;
  }

  return (
    <div
      title={BUILD_TIME ? `Built ${BUILD_TIME}` : 'Build time unknown'}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 9999,
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
        fontSize: 10,
        lineHeight: 1,
        padding: '3px 7px',
        borderRadius: 4,
        background: 'rgba(15, 23, 42, 0.55)',
        color: 'rgba(226, 232, 240, 0.7)',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        pointerEvents: 'auto',
        userSelect: 'all',
      }}
    >
      <span style={{ opacity: 0.95 }}>{APP_VERSION_LABEL}</span>
      {' · '}
      <span style={{ opacity: 0.55 }}>build</span>{' '}
      <span style={{ opacity: 0.95 }}>{BUILD_ID}</span>
      {shortTime && (
        <>
          {' · '}
          <span style={{ opacity: 0.55 }}>{shortTime}</span>
        </>
      )}
    </div>
  );
}
