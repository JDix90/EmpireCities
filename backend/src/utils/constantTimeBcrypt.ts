import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from '../config';

/**
 * A throwaway hash generated at module load. When `compareWithDummy` is called
 * with a missing user (i.e. `hashOrNull === null`), we still run bcrypt against
 * this dummy so the request takes roughly the same amount of CPU as a real
 * comparison. This closes the email-enumeration timing oracle on /login.
 *
 * The dummy is per-process and never matches anything, so even though the
 * compare returns true, we discard that result via the explicit
 * `hashOrNull !== null` guard.
 */
const DUMMY_HASH = bcrypt.hashSync(`cc-dummy-${randomUUID()}`, config.bcryptRounds);

/**
 * Compare a plaintext password against an optional bcrypt hash, in constant
 * (or near-constant) time relative to whether the user exists.
 *
 * Returns true only when both:
 *   1. `hashOrNull` is non-null, AND
 *   2. `bcrypt.compare(password, hashOrNull)` returns true.
 *
 * If `hashOrNull` is null, we compare against `DUMMY_HASH` to burn an
 * equivalent amount of CPU, but always return false.
 */
export async function compareWithDummy(
  password: string,
  hashOrNull: string | null | undefined,
): Promise<boolean> {
  const target = hashOrNull ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, target);
  return Boolean(hashOrNull) && ok;
}
