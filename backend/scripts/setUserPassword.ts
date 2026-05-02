/**
 * Set a user's password by email (bcrypt, same rounds as the API).
 * Intended for **local development** recovery when you cannot sign in.
 *
 * Usage:
 *   pnpm -C backend exec tsx scripts/setUserPassword.ts you@example.com 'new-password-here'
 *
 * Refuses to run when NODE_ENV=production unless FORCE_PASSWORD_RESET_SCRIPT=1.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectPostgres, query, pgPool } from '../src/db/postgres/index';
import { config } from '../src/config';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();
  const newPassword = process.argv[3];
  if (!email || !newPassword || newPassword.length < 8) {
    console.error('Usage: tsx scripts/setUserPassword.ts <email> <new-password (min 8 chars)>');
    process.exit(1);
  }
  if (config.nodeEnv === 'production' && process.env.FORCE_PASSWORD_RESET_SCRIPT !== '1') {
    console.error(
      '[set-password] Refusing to run in production. For emergency use only, set FORCE_PASSWORD_RESET_SCRIPT=1',
    );
    process.exit(1);
  }

  await connectPostgres();
  const password_hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  const rows = await query<{ user_id: string; username: string }>(
    `UPDATE users SET password_hash = $1
     WHERE LOWER(TRIM(BOTH FROM email)) = LOWER(TRIM(BOTH FROM $2))
       AND COALESCE(is_guest, false) = false
     RETURNING user_id, username`,
    [password_hash, email],
  );
  if (rows.length === 0) {
    console.error(`[set-password] No non-guest user found with email ${email}`);
    process.exit(1);
  }
  console.log(`[set-password] Updated password for ${rows[0].username} (${rows[0].user_id})`);
  await pgPool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[set-password] Failed:', err);
  process.exit(1);
});
