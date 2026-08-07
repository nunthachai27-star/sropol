// Test helper: shared "no green anywhere" DOM scan for maternal-screening UI
// (GC-W1/GC-U1 regression lock — Phase 6 review finding M1).
//
// The underlying rule set is PROVISIONAL_UNAPPROVED: nothing in
// MaternalScreenCell, BedTileFull's maternal-screen pills, or
// MaternalScreeningCard may ever render green, including the kiosk
// palette's `--kiosk-low` and the "stable/no local match" muted states.
//
// jsdom (via the `cssstyle` library backing its CSSStyleDeclaration) rewrites
// inline hex colors set through React's `style` prop into rgb(...) form —
// `style={{ color: '#22c55e' }}` round-trips through the DOM as
// `color: rgb(34, 197, 94);`, NOT the original hex string. A scan that only
// greps the serialized style attribute for the hex literal is therefore
// blind to exactly the regression it exists to catch: this was proven by
// mutation — hardcoding `#22c55e` as BedTileFull's pill color still passed
// the old (hex-only) scan. The pattern list below carries BOTH the
// hex/var() forms (defense in depth, and to catch non-inline-style
// occurrences) AND the jsdom-normalized rgb() form of every banned hex
// value, so no representation of a banned green can slip through.
import { expect } from 'vitest';

/** Forbidden green tokens/colors — hex, CSS var, and jsdom-normalized rgb() forms. */
export const GREEN_PATTERNS: readonly RegExp[] = [
  /var\(--risk-low\)/i,
  /var\(--kiosk-low\)/i,
  /#22c55e/i,
  /#16a34a/i,
  /#dcfce7/i,
  /rgb\(\s*34,\s*197,\s*94\s*\)/i, // #22c55e
  /rgb\(\s*22,\s*163,\s*74\s*\)/i, // #16a34a
  /rgb\(\s*220,\s*252,\s*231\s*\)/i, // #dcfce7
  /\bgreen\b/i,
];

/**
 * Scans every element under `container` for a banned green token/color, in
 * either its inline `style` attribute or its `class` attribute (utility
 * classes like `text-green-500`/`bg-green-50` would smuggle green in even
 * though this codebase styles these components with inline colors today).
 * Fails the current test via `expect` on the first match found, with the
 * offending style/class string in the assertion message.
 */
export function assertNoGreenInTree(container: HTMLElement): void {
  const all = container.querySelectorAll<HTMLElement>('*');
  for (const el of Array.from(all)) {
    const style = el.getAttribute('style') ?? '';
    for (const pattern of GREEN_PATTERNS) {
      expect(pattern.test(style), `element style="${style}" must not match ${pattern}`).toBe(false);
    }
    // `getAttribute('class')` (not `.className`) because SVG elements expose
    // `className` as an SVGAnimatedString, not a plain string.
    const classAttr = el.getAttribute('class');
    if (classAttr !== null) {
      expect(classAttr, `element class="${classAttr}" must not match /green/i`).not.toMatch(
        /green/i,
      );
    }
  }
}
