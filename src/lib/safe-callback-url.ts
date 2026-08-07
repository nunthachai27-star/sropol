/**
 * Open-redirect guard for post-login `callbackUrl` values.
 *
 * Only same-origin relative paths are safe redirect targets. Anything absolute
 * (`http://evil.com`), protocol-relative (`//evil.com`, `/\evil.com`), or using
 * a dangerous scheme (`javascript:`, `data:`) falls back to the site root.
 *
 * Shared by the ProviderID OAuth start/callback routes and the
 * `/provider/complete` client page so the rule cannot drift between call sites.
 */
export function sanitizeCallbackUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/')) return '/';
  // Reject protocol-relative URLs. Browsers normalise backslashes to forward
  // slashes, so "/\evil.com" is treated as "//evil.com" — block both forms.
  if (url.startsWith('//') || url.startsWith('/\\')) return '/';
  return url;
}
