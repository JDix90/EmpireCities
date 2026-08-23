/**
 * Regression test for the diagnostic that cost hours of a real outage.
 *
 * A deploy recreated the backend container with a POSTGRES_USER that had never
 * existed in the Postgres data volume. The only symptom was:
 *
 *     error: password authentication failed for user "chronouser"
 *
 * which sends you looking for a wrong password. Postgres returns 28P01 for a
 * *nonexistent* role as well, deliberately, so clients can't enumerate valid
 * usernames — the role simply wasn't there. The decisive extra fact is that
 * POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB only apply when the data
 * directory is first initialised, so editing them later leaves the running
 * cluster untouched and the two silently disagree forever.
 *
 * These assertions pin the parts of the message that carry that information.
 */

import { describe, it, expect } from 'vitest';
import { pgConnectionHint } from './index';

describe('pgConnectionHint', () => {
  it('tells you to check POSTGRES_USER on 28P01, not just the password', () => {
    const hint = pgConnectionHint({ code: '28P01' });
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/POSTGRES_USER/);
    expect(hint).toMatch(/POSTGRES_PASSWORD/);
    // The load-bearing sentence: the error does not distinguish a bad password
    // from a role that was never created.
    expect(hint).toMatch(/does not exist/i);
    // And why the env var can disagree with reality at all.
    expect(hint).toMatch(/first/i);
  });

  it('names POSTGRES_DB when the database is missing (3D000)', () => {
    const hint = pgConnectionHint({ code: '3D000' });
    expect(hint).toMatch(/POSTGRES_DB/);
  });

  it('points at host/port settings for network-level failures', () => {
    expect(pgConnectionHint({ code: 'ECONNREFUSED' })).toMatch(/POSTGRES_HOST/);
    expect(pgConnectionHint({ code: 'ENOTFOUND' })).toMatch(/POSTGRES_HOST/);
    expect(pgConnectionHint({ code: 'EAI_AGAIN' })).toMatch(/POSTGRES_HOST/);
  });

  it('never leaks the password into the hint', () => {
    for (const code of ['28P01', '3D000', '28000', 'ECONNREFUSED', 'ENOTFOUND']) {
      const hint = pgConnectionHint({ code }) ?? '';
      // config falls back to the compose default when unset; whatever the
      // configured password is, it must not be echoed into logs.
      expect(hint).not.toMatch(/chronopass/);
      expect(hint.toLowerCase()).not.toContain('password=');
    }
  });

  it('returns null for codes it has nothing useful to add to', () => {
    expect(pgConnectionHint({ code: '42P01' })).toBeNull();
    expect(pgConnectionHint(undefined)).toBeNull();
    expect(pgConnectionHint(null)).toBeNull();
    expect(pgConnectionHint(new Error('boom'))).toBeNull();
  });
});
