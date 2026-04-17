import type { PoolClient } from 'pg';
import { query, queryOne } from '../../db/postgres';
import { getTier, getSeasonTierCosmetic } from '../rating/ratingService';
import { ONBOARDING_QUESTS } from '@erasofempire/shared';

// ── Gold award helpers (non-transactional convenience wrappers) ────────

export async function awardGold(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  await client.query('UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2', [amount, userId]);
  await client.query(
    'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
    [userId, amount, reason],
  );
}

// ── Win streak tracking ─────────────────────────────────────────────────

export async function updateWinStreak(
  client: PoolClient,
  userId: string,
  won: boolean,
): Promise<number> {
  if (won) {
    const row = await client.query<{ win_streak: number }>(
      'UPDATE users SET win_streak = win_streak + 1 WHERE user_id = $1 RETURNING win_streak',
      [userId],
    );
    return row.rows[0]?.win_streak ?? 1;
  }
  await client.query('UPDATE users SET win_streak = 0 WHERE user_id = $1', [userId]);
  return 0;
}

// ── Daily streak tracking ───────────────────────────────────────────────

export async function updateDailyStreak(
  client: PoolClient,
  userId: string,
): Promise<{ streak: number; milestone: number | null }> {
  const row = await client.query<{ daily_streak: number; last_played_date: string | null }>(
    'SELECT daily_streak, last_played_date::text AS last_played_date FROM users WHERE user_id = $1',
    [userId],
  );
  const current = row.rows[0];
  if (!current) return { streak: 0, milestone: null };

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  let newStreak: number;

  if (current.last_played_date === today) {
    return { streak: current.daily_streak, milestone: null };
  } else if (current.last_played_date === yesterday) {
    newStreak = current.daily_streak + 1;
  } else {
    newStreak = 1;
  }

  await client.query(
    'UPDATE users SET daily_streak = $1, last_played_date = $2 WHERE user_id = $3',
    [newStreak, today, userId],
  );

  // Check milestones
  const milestones: Record<number, { gold: number; cosmetic?: string }> = {
    3:  { gold: 25 },
    7:  { gold: 75, cosmetic: 'frame_week_master' },
    14: { gold: 150 },
    28: { gold: 300, cosmetic: 'frame_month_master' },
  };

  const milestone = milestones[newStreak];
  if (milestone) {
    await awardGold(client, userId, milestone.gold, `Daily streak ${newStreak}-day milestone`);
    if (milestone.cosmetic) {
      await client.query(
        `INSERT INTO user_cosmetics (user_id, cosmetic_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, milestone.cosmetic],
      );
    }
  }

  return { streak: newStreak, milestone: milestone ? newStreak : null };
}

// ── Gold award on game win ──────────────────────────────────────────────

const GOLD_PER_WIN = 20;

export async function awardWinGold(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await awardGold(client, userId, GOLD_PER_WIN, 'Game win');
}

// ── Season tier tracking ────────────────────────────────────────────────

export async function updateSeasonTier(
  client: PoolClient,
  userId: string,
  mu: number,
): Promise<void> {
  const tier = getTier(mu);

  // Get current season
  const season = await client.query<{ season_id: string }>(
    `SELECT season_id FROM seasons WHERE NOW() BETWEEN started_at AND ended_at LIMIT 1`,
  );
  if (season.rows.length === 0) return;
  const seasonId = season.rows[0].season_id;

  const tierOrder: Record<string, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3, diamond: 4 };

  // Upsert, only raise tier
  const existing = await client.query<{ highest_tier: string }>(
    'SELECT highest_tier FROM season_rewards WHERE season_id = $1 AND user_id = $2',
    [seasonId, userId],
  );

  if (existing.rows.length === 0) {
    await client.query(
      `INSERT INTO season_rewards (season_id, user_id, highest_tier, games_played)
       VALUES ($1, $2, $3, 1)`,
      [seasonId, userId, tier],
    );
  } else {
    const updates: string[] = ['games_played = games_played + 1'];
    const params: (string | number)[] = [];
    if (tierOrder[tier] > tierOrder[existing.rows[0].highest_tier]) {
      params.push(tier);
      updates.push(`highest_tier = $${params.length}`);
    }
    params.push(seasonId, userId);
    await client.query(
      `UPDATE season_rewards SET ${updates.join(', ')} WHERE season_id = $${params.length - 1} AND user_id = $${params.length}`,
      params,
    );
  }
}

// ── Level-up cosmetic check ─────────────────────────────────────────────

const LEVEL_COSMETICS: Record<number, string> = {
  10: 'frame_level_10',
  20: 'frame_level_20',
  30: 'frame_level_30',
  40: 'frame_level_40',
  50: 'frame_level_50',
};

export async function checkLevelCosmetic(
  client: PoolClient,
  userId: string,
  oldLevel: number,
  newLevel: number,
): Promise<string | null> {
  for (const [lvl, cosmeticId] of Object.entries(LEVEL_COSMETICS)) {
    const threshold = Number(lvl);
    if (oldLevel < threshold && newLevel >= threshold) {
      await client.query(
        `INSERT INTO user_cosmetics (user_id, cosmetic_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, cosmeticId],
      );
      return cosmeticId;
    }
  }
  return null;
}

// ── Onboarding quest checker ────────────────────────────────────────────

export async function checkOnboardingQuests(
  userId: string,
  trigger: 'game_complete' | 'build' | 'research' | 'ranked_join' | 'friend_accept',
): Promise<{ quest_id: string; title: string; reward_gold: number; reward_xp: number } | null> {
  // Find the next incomplete quest
  const completed = await query<{ quest_id: string }>(
    'SELECT quest_id FROM user_quests WHERE user_id = $1',
    [userId],
  );
  const completedIds = new Set(completed.map((r) => r.quest_id));

  for (const quest of ONBOARDING_QUESTS) {
    if (completedIds.has(quest.quest_id)) continue;

    // Check if trigger matches this quest
    let matched = false;
    switch (quest.quest_id) {
      case 'first_win':
        if (trigger === 'game_complete') {
          const wins = await queryOne<{ cnt: string }>(
            `SELECT COUNT(*) AS cnt FROM game_players gp JOIN games g ON g.game_id = gp.game_id
             WHERE gp.user_id = $1 AND gp.final_rank = 1 AND g.status = 'completed'`,
            [userId],
          );
          matched = parseInt(wins?.cnt ?? '0', 10) >= 1;
        }
        break;
      case 'first_building':
        matched = trigger === 'build';
        break;
      case 'first_tech':
        matched = trigger === 'research';
        break;
      case 'first_ranked':
        matched = trigger === 'ranked_join';
        break;
      case 'first_friend':
        matched = trigger === 'friend_accept';
        break;
    }

    if (matched) {
      await query(
        `INSERT INTO user_quests (user_id, quest_id, completed_at)
         VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
        [userId, quest.quest_id],
      );
      // Award rewards
      if (quest.reward_gold > 0) {
        await query(
          'UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2',
          [quest.reward_gold, userId],
        );
        await query(
          'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
          [userId, quest.reward_gold, `Quest: ${quest.title}`],
        );
      }
      if (quest.reward_xp > 0) {
        await query(
          'UPDATE users SET xp = xp + $1 WHERE user_id = $2',
          [quest.reward_xp, userId],
        );
      }
      return quest;
    }
    // Quests are sequential — stop at first incomplete
    break;
  }

  return null;
}

// ── Daily login gold ────────────────────────────────────────────────────

const DAILY_LOGIN_GOLD = 10;

export async function claimDailyLogin(userId: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const row = await queryOne<{ last_login_date: string | null }>(
    'SELECT last_login_date::text AS last_login_date FROM users WHERE user_id = $1',
    [userId],
  );
  if (row?.last_login_date === today) return false;

  await query('UPDATE users SET last_login_date = $1 WHERE user_id = $2', [today, userId]);
  await query(
    'UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2',
    [DAILY_LOGIN_GOLD, userId],
  );
  await query(
    'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
    [userId, DAILY_LOGIN_GOLD, 'Daily login'],
  );
  return true;
}

// ── Referral code generation ────────────────────────────────────────────

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
