/**
 * Whether `path` is a path on this site, safe to navigate to: it starts with a
 * single `/`, and holds no backslash or control character, which browsers
 * normalise when they parse a URL.
 */
export function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return false;
  }
  return true;
}

/**
 * Safe in-app redirect target after login/register (open redirect guard).
 */
export function sanitizePostAuthRedirect(raw: string | null): string {
  if (!raw || typeof raw !== 'string') return '/lobby';
  const t = raw.trim();
  return isSafeInternalPath(t) ? t : '/lobby';
}
