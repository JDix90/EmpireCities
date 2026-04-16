import { query, queryOne } from '../../db/postgres';
import { pgPool } from '../../db/postgres';
import { generateReferralCode } from './progressionService';

const REFERRER_GOLD = 50;
const REFEREE_GOLD = 25;
const REFERRAL_COMPLETION_GAMES = 3; // referee must play 3 games to qualify

// ── Ensure user has a referral code ─────────────────────────────────────

export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await queryOne<{ referral_code: string | null }>(
    'SELECT referral_code FROM users WHERE user_id = $1',
    [userId],
  );
  if (user?.referral_code) return user.referral_code;

  // Generate unique code with retry
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      await query(
        'UPDATE users SET referral_code = $1 WHERE user_id = $2 AND referral_code IS NULL',
        [code, userId],
      );
      const check = await queryOne<{ referral_code: string }>(
        'SELECT referral_code FROM users WHERE user_id = $1',
        [userId],
      );
      if (check?.referral_code) return check.referral_code;
    } catch {
      // Unique constraint violation, retry with new code
    }
  }
  throw new Error('Failed to generate unique referral code');
}

// ── Redeem a referral code (called by new user) ─────────────────────────

export async function redeemReferralCode(
  refereeId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  // Find the referrer
  const referrer = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM users WHERE referral_code = $1',
    [code.toUpperCase()],
  );
  if (!referrer) return { success: false, error: 'Invalid referral code' };
  if (referrer.user_id === refereeId) return { success: false, error: 'Cannot use your own referral code' };

  // Check if referee already has a referral
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM referrals WHERE referee_id = $1',
    [refereeId],
  );
  if (existing) return { success: false, error: 'You have already used a referral code' };

  // Create referral in pending state
  await query(
    `INSERT INTO referrals (referrer_id, referee_id, status, referrer_gold, referee_gold)
     VALUES ($1, $2, 'pending', $3, $4)`,
    [referrer.user_id, refereeId, REFERRER_GOLD, REFEREE_GOLD],
  );

  // Immediately give referee their join bonus
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2',
      [REFEREE_GOLD, refereeId],
    );
    await client.query(
      'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
      [refereeId, REFEREE_GOLD, 'Referral welcome bonus'],
    );
    await client.query(
      `UPDATE referrals SET referee_gold = $1 WHERE referee_id = $2`,
      [REFEREE_GOLD, refereeId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Referral] Failed to award referee gold:', err);
  } finally {
    client.release();
  }

  return { success: true };
}

// ── Check if referral should complete (after game) ──────────────────────

export async function checkReferralCompletion(userId: string): Promise<void> {
  const referral = await queryOne<{ id: string; referrer_id: string; status: string }>(
    `SELECT id, referrer_id, status FROM referrals WHERE referee_id = $1 AND status = 'pending'`,
    [userId],
  );
  if (!referral) return;

  // Count completed games for the referee
  const result = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM game_players gp
     JOIN games g ON g.game_id = gp.game_id
     WHERE gp.user_id = $1 AND g.status = 'completed'`,
    [userId],
  );
  const gamesPlayed = parseInt(result?.cnt ?? '0', 10);
  if (gamesPlayed < REFERRAL_COMPLETION_GAMES) return;

  // Complete referral and award referrer
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE referrals SET status = 'completed', completed_at = NOW(), reward_claimed = true
       WHERE id = $1`,
      [referral.id],
    );

    await client.query(
      'UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2',
      [REFERRER_GOLD, referral.referrer_id],
    );
    await client.query(
      'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
      [referral.referrer_id, REFERRER_GOLD, 'Referral reward'],
    );

    // Grant pioneer badge to referrer
    await client.query(
      `INSERT INTO user_cosmetics (user_id, cosmetic_id)
       VALUES ($1, 'badge_pioneer') ON CONFLICT DO NOTHING`,
      [referral.referrer_id],
    );

    await client.query('COMMIT');
    console.log(`[Referral] Completed: referrer=${referral.referrer_id}, referee=${userId}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Referral] Completion failed:', err);
  } finally {
    client.release();
  }
}

// ── Get referral stats for a user ──────────────────────────────────────

export async function getReferralStats(userId: string): Promise<{
  referral_code: string;
  total_referrals: number;
  completed_referrals: number;
  total_gold_earned: number;
  referrals: Array<{
    referee_username: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>;
}> {
  const code = await ensureReferralCode(userId);

  const referrals = await query<{
    status: string;
    created_at: string;
    completed_at: string | null;
    username: string;
  }>(
    `SELECT r.status, r.created_at, r.completed_at, u.username
     FROM referrals r
     JOIN users u ON u.user_id = r.referee_id
     WHERE r.referrer_id = $1
     ORDER BY r.created_at DESC`,
    [userId],
  );

  const completed = referrals.filter((r) => r.status === 'completed');

  return {
    referral_code: code,
    total_referrals: referrals.length,
    completed_referrals: completed.length,
    total_gold_earned: completed.length * REFERRER_GOLD,
    referrals: referrals.map((r) => ({
      referee_username: r.username,
      status: r.status,
      created_at: r.created_at,
      completed_at: r.completed_at,
    })),
  };
}
