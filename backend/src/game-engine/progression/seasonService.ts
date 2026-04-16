import { query, queryOne } from '../../db/postgres';
import { pgPool } from '../../db/postgres';
import { getSeasonTierCosmetic, type RankedTier } from '../rating/ratingService';

// ── Season auto-creation + end-of-season reward distribution ───────────

const SEASON_DURATION_DAYS = 90; // 3 months per season

interface Season {
  season_id: string;
  name: string;
  started_at: string;
  ended_at: string;
}

/**
 * Ensure there is an active season. If the current season has ended,
 * distribute rewards and create the next one.
 * Called periodically from the cron sweep.
 */
export async function ensureActiveSeason(): Promise<void> {
  const active = await queryOne<Season>(
    `SELECT season_id, name, started_at, ended_at FROM seasons
     WHERE NOW() BETWEEN started_at AND ended_at LIMIT 1`,
  );

  if (active) return; // Already have an active season

  // Check if a season recently ended
  const ended = await queryOne<Season>(
    `SELECT season_id, name, started_at, ended_at FROM seasons
     WHERE ended_at < NOW()
     ORDER BY ended_at DESC LIMIT 1`,
  );

  if (ended) {
    // Distribute rewards for the ended season if not yet done
    await distributeSeasonRewards(ended.season_id);
  }

  // Create next season
  await createNextSeason();
}

async function distributeSeasonRewards(seasonId: string): Promise<void> {
  // Check if already distributed (at least one reward_cosmetic_id set)
  const alreadyDistributed = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM season_rewards
     WHERE season_id = $1 AND reward_cosmetic_id IS NOT NULL`,
    [seasonId],
  );
  if (parseInt(alreadyDistributed?.cnt ?? '0', 10) > 0) return;

  // Get all participants
  const participants = await query<{ user_id: string; highest_tier: string }>(
    'SELECT user_id, highest_tier FROM season_rewards WHERE season_id = $1',
    [seasonId],
  );

  for (const p of participants) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      const cosmeticId = getSeasonTierCosmetic(seasonId, p.highest_tier as RankedTier);
      if (cosmeticId) {
        // Grant cosmetic
        await client.query(
          `INSERT INTO user_cosmetics (user_id, cosmetic_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [p.user_id, cosmeticId],
        );

        // Record the reward
        await client.query(
          `UPDATE season_rewards
           SET reward_cosmetic_id = $1, claimed_at = NOW()
           WHERE season_id = $2 AND user_id = $3`,
          [cosmeticId, seasonId, p.user_id],
        );
      }

      // Store final mu for history
      const rating = await client.query<{ mu: number }>(
        "SELECT mu FROM user_ratings WHERE user_id = $1 AND rating_type = 'ranked'",
        [p.user_id],
      );
      if (rating.rows[0]) {
        await client.query(
          `UPDATE season_rewards SET final_mu = $1 WHERE season_id = $2 AND user_id = $3`,
          [rating.rows[0].mu, seasonId, p.user_id],
        );
      }

      // Gold reward based on tier
      const TIER_GOLD: Record<string, number> = {
        bronze: 50,
        silver: 100,
        gold: 200,
        platinum: 400,
        diamond: 750,
      };
      const goldAmount = TIER_GOLD[p.highest_tier] ?? 50;
      await client.query(
        'UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2',
        [goldAmount, p.user_id],
      );
      await client.query(
        'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
        [p.user_id, goldAmount, `Season ${seasonId} tier reward (${p.highest_tier})`],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[Season] Failed to distribute reward for ${p.user_id}:`, err);
    } finally {
      client.release();
    }
  }

  console.log(`[Season] Distributed rewards for season ${seasonId} to ${participants.length} players`);
}

async function createNextSeason(): Promise<void> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1); // First of current month
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + SEASON_DURATION_DAYS);

  // Generate season ID: YYYY_QN
  const quarter = Math.ceil((startDate.getMonth() + 1) / 3);
  const seasonId = `${startDate.getFullYear()}_Q${quarter}`;

  // Generate season name sequentially
  const count = await queryOne<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM seasons');
  const seasonNumber = parseInt(count?.cnt ?? '0', 10) + 1;

  const SEASON_THEMES = [
    'Rise of Empires',
    'Age of Conquest',
    'Dawn of Nations',
    'Imperial Ambitions',
    'Clash of Civilizations',
    'Tides of War',
    'Epoch of Power',
    'March of History',
  ];
  const name = `Season ${seasonNumber}: ${SEASON_THEMES[(seasonNumber - 1) % SEASON_THEMES.length]}`;

  // Featured eras: rotate through era sets
  const ERA_SETS = [
    ['era_ancient', 'era_medieval', 'era_discovery'],
    ['era_medieval', 'era_ww2', 'era_modern'],
    ['era_ancient', 'era_discovery', 'era_coldwar'],
    ['era_ww2', 'era_coldwar', 'era_modern'],
  ];
  const featured_eras = ERA_SETS[(seasonNumber - 1) % ERA_SETS.length];

  await query(
    `INSERT INTO seasons (season_id, name, featured_eras, started_at, ended_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (season_id) DO NOTHING`,
    [seasonId, name, featured_eras, startDate.toISOString(), endDate.toISOString()],
  );

  console.log(`[Season] Created new season: ${name} (${seasonId})`);
}

// ── Season history query ────────────────────────────────────────────────

export async function getSeasonHistory(userId: string): Promise<Array<{
  season_id: string;
  name: string;
  highest_tier: string;
  final_mu: number | null;
  games_played: number;
  reward_cosmetic_id: string | null;
  started_at: string;
  ended_at: string;
}>> {
  return query(
    `SELECT s.season_id, s.name, sr.highest_tier, sr.final_mu, sr.games_played,
            sr.reward_cosmetic_id, s.started_at, s.ended_at
     FROM season_rewards sr
     JOIN seasons s ON s.season_id = sr.season_id
     WHERE sr.user_id = $1
     ORDER BY s.started_at DESC`,
    [userId],
  );
}

// ── Cron sweep ─────────────────────────────────────────────────────────

let seasonInterval: ReturnType<typeof setInterval> | null = null;

export function startSeasonSweep(): void {
  if (seasonInterval) return;
  // Check every hour
  seasonInterval = setInterval(async () => {
    try {
      await ensureActiveSeason();
    } catch (err) {
      console.error('[Season] Sweep error:', err);
    }
  }, 60 * 60 * 1000);
  seasonInterval.unref();

  // Also run immediately on startup
  ensureActiveSeason().catch((err) => console.error('[Season] Initial check error:', err));
}

export function stopSeasonSweep(): void {
  if (seasonInterval) {
    clearInterval(seasonInterval);
    seasonInterval = null;
  }
}
