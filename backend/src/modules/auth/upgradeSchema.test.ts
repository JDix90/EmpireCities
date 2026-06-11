import { describe, it, expect } from 'vitest';
import { UpgradeSchema } from './auth.routes';

/**
 * The upgrade body shares register's identity rules; the extra refinement
 * blocks `@guest.local` emails — that domain is reserved for synthetic guest
 * rows and is excluded from login's email resolution, so an upgraded account
 * using one could never sign in by email.
 */
describe('UpgradeSchema', () => {
  const valid = { username: 'Commander_1', email: 'cmd@example.com', password: 'a-long-password' };

  it('accepts a valid payload', () => {
    expect(UpgradeSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects @guest.local emails (any case)', () => {
    expect(UpgradeSchema.safeParse({ ...valid, email: 'foo@guest.local' }).success).toBe(false);
    expect(UpgradeSchema.safeParse({ ...valid, email: 'foo@GUEST.LOCAL' }).success).toBe(false);
  });

  it('rejects short and malformed usernames', () => {
    expect(UpgradeSchema.safeParse({ ...valid, username: 'ab' }).success).toBe(false);
    expect(UpgradeSchema.safeParse({ ...valid, username: 'has spaces' }).success).toBe(false);
    expect(UpgradeSchema.safeParse({ ...valid, username: 'emoji😀' }).success).toBe(false);
  });

  it('rejects out-of-bounds passwords', () => {
    expect(UpgradeSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(UpgradeSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success).toBe(false);
  });

  it('rejects invalid emails', () => {
    expect(UpgradeSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });
});
