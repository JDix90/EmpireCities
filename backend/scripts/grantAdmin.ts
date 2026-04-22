/**
 * Grant admin to a user by email (requires migration 023_admin.sql).
 * Usage: pnpm -C backend run grant-admin -- you@example.com
 */
import 'dotenv/config';
import { connectPostgres, query, pgPool } from '../src/db/postgres/index';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: tsx scripts/grantAdmin.ts <email>');
    process.exit(1);
  }
  await connectPostgres();
  const rows = await query<{ user_id: string; username: string }>(
    `UPDATE users SET is_admin = TRUE WHERE LOWER(email) = LOWER($1)
     RETURNING user_id, username`,
    [email],
  );
  if (rows.length === 0) {
    console.error(`[grant-admin] No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`[grant-admin] ${rows[0].username} (${rows[0].user_id}) is now admin`);
  await pgPool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[grant-admin] Failed:', err);
  process.exit(1);
});
