import type { PoolClient } from 'pg';
import type { GameState } from '../../types';
import { withTransaction } from '../../db/postgres';
import { computeLevel } from '../state/statsManager';
import type { AchievementId } from './achievementIds';

/** A transaction's client, or the pool for a single statement. */
type Queryable = Pick<PoolClient, 'query'>;

type GameType = 'solo' | 'multiplayer' | 'hybrid';

export interface AchievementContext {
  userId: string;
  gameId: string;
  gameState: GameState;
  winnerId: string;
  rank: number;
  totalPlayers: number;
  gameType: GameType;
  isRanked: boolean;
  /** The player's rating after this game (ranked games: their ranked rating). */
  playerMu: number;
  /** The player's rating before this game, and the highest an opponent had (Underdog Victory). */
  playerMuBefore: number;
  strongestOpponentMuBefore: number;
}

/** SQL predicate on `games g`: the row is not a tutorial game (same test the profile stats use). */
const NOT_TUTORIAL_GAME = "COALESCE(g.settings_json::jsonb->>'tutorial', 'false') <> 'true'";

/** The medal each achievement brings (the cosmetics are defined in migrations 051 and 053). */
export const ACHIEVEMENT_COSMETIC_MAP: Partial<Record<AchievementId, string>> = {
  first_blood: 'frame_bronze',
  conqueror: 'frame_gold',
  comeback_king: 'marker_crown',
  speed_demon: 'marker_skull',
  ten_streak: 'frame_champion',
  ranked_warlord: 'frame_warlord',
  perfect_campaign: 'marker_emperor',
};

export async function checkAndUnlockAchievements(
  client: PoolClient,
  ctx: AchievementContext,
): Promise<string[]> {
  const unlocked: AchievementId[] = [];
  const { userId, gameId, gameState, rank, isRanked, playerMu, playerMuBefore, strongestOpponentMuBefore } = ctx;
  // The tutorial is a lesson: it unlocks tutorial_complete and nothing else.
  // Its guaranteed win used to grant First Blood, Conqueror, Speed Demon and
  // the era mastery badge while the profile's stats and the First Victory
  // quest (both of which skip tutorial games) said no game had been won yet
  // (playtest PT-008). Prior-game counts below skip tutorial games the same
  // way the profile does, so the first real win is still "first".
  const isTutorial = !!gameState.settings.tutorial;
  const isWinner = rank === 1 && !isTutorial;

  // first_blood: first ever win
  if (isWinner) {
    const prior = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND gp.final_rank = 1 AND g.game_id != $2 AND g.status = 'completed'
         AND ${NOT_TUTORIAL_GAME}`,
      [userId, gameId],
    );
    if (parseInt(prior.rows[0]?.cnt ?? '0', 10) === 0) {
      unlocked.push('first_blood');
    }
  }

  // conqueror: own every territory
  if (isWinner) {
    const allOwned = Object.values(gameState.territories).every((t) => t.owner_id === userId);
    if (allOwned) unlocked.push('conqueror');
  }

  // speed_demon: win in 8 turns or fewer
  if (isWinner && gameState.turn_number <= 8) {
    unlocked.push('speed_demon');
  }

  // comeback_king and perfect_defense, from the tallies kept during play
  // (achievementTally.ts). A game that never got past turn 3 shows no defence.
  const me = gameState.players.find((p) => p.player_id === userId);
  if (isWinner && me?.held_fewest_territories) {
    unlocked.push('comeback_king');
  }
  if (isWinner && gameState.turn_number > 3 && me?.territories_lost_after_turn_3 === 0) {
    unlocked.push('perfect_defense');
  }

  // underdog: a ranked win over an opponent rated 200+ above you, both as the game began
  if (isWinner && isRanked && strongestOpponentMuBefore - playerMuBefore >= 200) {
    unlocked.push('underdog');
  }

  // first_ranked_win, and ranked_warlord: the fiftieth ranked win, at 1800+
  if (isWinner && isRanked) {
    const priorRanked = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND gp.final_rank = 1 AND g.is_ranked = true
         AND g.game_id != $2 AND g.status = 'completed'`,
      [userId, gameId],
    );
    const priorRankedWins = parseInt(priorRanked.rows[0]?.cnt ?? '0', 10);
    if (priorRankedWins === 0) {
      unlocked.push('first_ranked_win');
    }
    if (priorRankedWins + 1 >= 50 && playerMu >= 1800) {
      unlocked.push('ranked_warlord');
    }
  }

  // tutorial_complete: win the tutorial game. A lesson left from its last
  // card abandons the game instead, and is granted when the client records
  // the core lesson done (POST /api/users/me/tutorial-modules/core).
  if (isTutorial && rank === 1) {
    unlocked.push('tutorial_complete');
  }

  // card_shark: redeem 5+ card sets in a single game
  const playerForCards = gameState.players.find((p) => p.player_id === userId);
  if (!isTutorial && (playerForCards?.cards_redeemed_count ?? 0) >= 5) {
    unlocked.push('card_shark');
  }

  // blitzkrieg: capture 10+ territories in a single turn
  const playerForBlitz = gameState.players.find((p) => p.player_id === userId);
  if (!isTutorial && (playerForBlitz?.territories_captured_turn_max ?? 0) >= 10) {
    unlocked.push('blitzkrieg');
  }

  // diplomat: establish a truce with every other human player in a single game
  if (!isTutorial && gameState.settings.diplomacy_enabled) {
    const playerForDiplomacy = gameState.players.find((p) => p.player_id === userId);
    const otherHumanIds = gameState.players
      .filter((p) => p.player_id !== userId && !p.is_ai)
      .map((p) => p.player_id);
    if (
      otherHumanIds.length > 0 &&
      otherHumanIds.every((id) => (playerForDiplomacy?.truces_established ?? []).includes(id))
    ) {
      unlocked.push('diplomat');
    }
  }

  // fog_master: win with fog of war
  if (isWinner && gameState.settings.fog_of_war) {
    unlocked.push('fog_master');
  }

  // era-specific wins
  if (isWinner) {
    const eraAchievements: Record<string, AchievementId> = {
      ancient: 'ancient_master',
      medieval: 'medieval_lord',
      discovery: 'age_of_sail',
      ww2: 'iron_cross',
      coldwar: 'cold_warrior',
      acw: 'iron_brigade',
    };
    const achId = eraAchievements[gameState.era];
    if (achId) unlocked.push(achId);
  }

  // ten_streak and immortal_streak: the latest 10 (25) games all won
  const streak = isTutorial ? 0 : await currentWinStreak(client, userId);
  if (streak >= 10) unlocked.push('ten_streak');
  if (streak >= 25) unlocked.push('immortal_streak');

  // veteran: 50+ games
  const totalGames = isTutorial ? { rows: [] as { cnt: string }[] } : await client.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM game_players gp
     JOIN games g ON g.game_id = gp.game_id
     WHERE gp.user_id = $1 AND g.status = 'completed' AND ${NOT_TUTORIAL_GAME}`,
    [userId],
  );
  if (parseInt(totalGames.rows[0]?.cnt ?? '0', 10) >= 50) {
    unlocked.push('veteran');
  }

  // strategist: a ranked rating of 1700 or more. At 1500, where every player
  // starts, a first ranked win earned it.
  if (!isTutorial && isRanked && playerMu >= 1700) {
    unlocked.push('strategist');
  }

  const newlyUnlocked = await grantAchievements(client, userId, unlocked);

  // Rating milestone cosmetic: frame_silver at ranked 1600+
  if (isRanked && playerMu >= 1600) {
    await grantCosmetic(client, userId, 'frame_silver');
  }

  return newlyUnlocked;
}

/** The longest streak an achievement asks for (Immortal Streak). */
const LONGEST_STREAK = 25;

/**
 * The player's win streak as the streak achievements count it: their latest
 * finished games, tutorials aside, that they won, up to 25. The profile's
 * progress bars read the same number, so a full bar means the achievement is
 * unlocked. (`users.win_streak`, which they used to read, counts credited
 * team wins and is kept by the gold multiplier, so the two could disagree.)
 */
export async function currentWinStreak(db: Queryable, userId: string): Promise<number> {
  const recent = await db.query<{ won: boolean }>(
    `SELECT (gp.final_rank = 1) AS won
     FROM game_players gp
     JOIN games g ON g.game_id = gp.game_id
     WHERE gp.user_id = $1 AND g.status = 'completed' AND ${NOT_TUTORIAL_GAME}
     ORDER BY g.ended_at DESC
     LIMIT ${LONGEST_STREAK}`,
    [userId],
  );
  const firstLoss = recent.rows.findIndex((r) => !r.won);
  return firstLoss === -1 ? recent.rows.length : firstLoss;
}

/**
 * Record achievements as unlocked, each with its XP and linked cosmetic, and
 * return the ones that are new to the player. Used at the end of a game and
 * wherever an achievement is earned outside one (the tutorial's lesson, a map
 * approved for the hub, a campaign finished).
 *
 * An id with no row in `achievements` is logged and skipped rather than
 * inserted: user_achievements references that table, and the insert failing
 * would abort the caller's transaction, and every unlock written in it.
 */
export async function grantAchievements(
  db: Queryable,
  userId: string,
  ids: readonly AchievementId[],
): Promise<AchievementId[]> {
  if (ids.length === 0) return [];
  const defs = await db.query<{ achievement_id: string; xp_reward: number }>(
    'SELECT achievement_id, xp_reward FROM achievements WHERE achievement_id = ANY($1)',
    [ids],
  );
  const xpRewards = new Map(defs.rows.map((r) => [r.achievement_id, r.xp_reward]));

  const newlyUnlocked: AchievementId[] = [];
  for (const achId of ids) {
    const xpReward = xpRewards.get(achId);
    if (xpReward === undefined) {
      console.warn(`[Achievements] "${achId}" has no row in achievements; not recorded`);
      continue;
    }
    const result = await db.query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING achievement_id`,
      [userId, achId],
    );
    if (!result.rowCount) continue;
    newlyUnlocked.push(achId);

    // Grant XP from achievement
    const userRow = await db.query<{ xp: number }>(
      'SELECT xp FROM users WHERE user_id = $1',
      [userId],
    );
    const newXp = (userRow.rows[0]?.xp ?? 0) + xpReward;
    await db.query(
      'UPDATE users SET xp = $1, level = $2 WHERE user_id = $3',
      [newXp, computeLevel(newXp), userId],
    );

    // Grant linked cosmetic
    const cosmeticId = ACHIEVEMENT_COSMETIC_MAP[achId];
    if (cosmeticId) await grantCosmetic(db, userId, cosmeticId);
  }
  return newlyUnlocked;
}

/**
 * Give a player a medal. Inserted only if the cosmetic is defined: like an
 * achievement, a missing row would otherwise fail the foreign key and abort
 * the transaction holding the unlock that brought it.
 */
async function grantCosmetic(db: Queryable, userId: string, cosmeticId: string): Promise<void> {
  await db.query(
    `INSERT INTO user_cosmetics (user_id, cosmetic_id)
     SELECT $1, cosmetic_id FROM cosmetics WHERE cosmetic_id = $2
     ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
    [userId, cosmeticId],
  );
}

/**
 * Grant achievements earned away from the end of a game, in a transaction of
 * their own. Never throws: an achievement must not fail the action that earned
 * it (finishing the tutorial, an approval, a game starting).
 */
export async function grantAchievementsOutsideGame(
  userId: string,
  ids: readonly AchievementId[],
): Promise<AchievementId[]> {
  try {
    return await withTransaction((client) => grantAchievements(client, userId, ids));
  } catch (err) {
    console.error(`[Achievements] Could not grant ${ids.join(', ')}:`, err);
    return [];
  }
}
