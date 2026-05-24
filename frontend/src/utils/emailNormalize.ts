/**
 * Client-side input normalization used before submitting auth forms. Keeping
 * trimming + case logic on the client gives users immediate feedback (no more
 * "incorrect password" because of a trailing space copied from a confirmation
 * email) and reduces wasted network round-trips. The backend still
 * canonicalizes on its own — this is purely a UX layer.
 */

/**
 * Lowercase + trim an email. We deliberately *only* normalize whitespace and
 * letter casing — splitting on `+` aliases or stripping dots would break
 * legitimate accounts at providers that treat them as significant.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Trim an arbitrary identifier. Used by the "email or username" login field
 * so we don't lowercase a username (which may be case-sensitive on the
 * server) but we do strip whitespace.
 */
export function normalizeIdentifier(raw: string): string {
  return raw.trim();
}
