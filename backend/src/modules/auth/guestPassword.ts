import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { config } from '../../config';

/**
 * The password hash a new guest row is created with.
 *
 * `users.password_hash` is NOT NULL, but a guest has no password: nothing ever
 * checks this hash. Login and password reset refuse the `@guest.local`
 * addresses every guest row carries, and saving the account (POST /upgrade)
 * replaces the hash, with the player's new password or a fresh random one for
 * an email-only save.
 *
 * It used to be a fresh bcrypt hash of a random UUID per guest, at the full
 * account cost. That was most of POST /auth/guest's time, the first request
 * of every Play Free Now (p95 673 ms in production), and bcryptjs computes it
 * on the main thread, holding up every other request meanwhile. One hash of a
 * random secret, made once per process and then thrown away, does the same
 * job: no one can produce a password that matches it, and a guest row is
 * already marked as one (`is_guest`, its email domain), so a shared hash
 * reveals nothing new.
 */
let placeholder: Promise<string> | null = null;

export function guestPasswordHash(): Promise<string> {
  if (!placeholder) {
    const pending = bcrypt.hash(randomUUID(), config.bcryptRounds);
    placeholder = pending;
    // A failed hash is retried on the next call rather than cached.
    pending.catch(() => {
      if (placeholder === pending) placeholder = null;
    });
  }
  return placeholder;
}
