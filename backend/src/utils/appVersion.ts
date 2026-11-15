/**
 * Native app versions (`1.4.0`, the iOS CFBundleShortVersionString), for the
 * minimum-version gate (middleware/minAppVersion.ts).
 *
 * One to three dot-separated numbers. Anything else is not a version: a
 * minimum that cannot be parsed must read as "no minimum", and a client
 * version that cannot be parsed must never be turned away, because the cost
 * of a mistake here is every player of the app locked out of it.
 */
const VERSION_RE = /^\d{1,6}(\.\d{1,6}){0,2}$/;

/** `[major, minor, patch]`, missing parts as 0, or null when `raw` is not a version. */
export function parseAppVersion(raw: unknown): [number, number, number] | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!VERSION_RE.test(text)) return null;
  const parts = text.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Negative when `a` is older than `b`, 0 when equal (`1.2` equals `1.2.0`), positive when newer. */
export function compareAppVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Whether `version` is older than `minimum`. False whenever either is missing
 * or is not a version: only a comparison that can actually be made blocks.
 */
export function isBelowMinimumVersion(version: unknown, minimum: unknown): boolean {
  const v = parseAppVersion(version);
  const m = parseAppVersion(minimum);
  if (!v || !m) return false;
  return compareAppVersions(v, m) < 0;
}
