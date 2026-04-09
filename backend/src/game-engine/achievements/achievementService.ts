import type { PoolClient } from 'pg';
import type { GameState } from '../../types';
import { computeLevel } from '../state/statsManager';

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
  playerMu: number;
  opponentAvgMu: number;
}

const ACHIEVEMENT_COSMETIC_MAP: Record<string, string> = {
  first_blood: 'frame_bronze',
  conqueror: 'frame_gold',
  comeback_king: 'marker_crown',
  speed_demon: 'marker_skull',
  ten_streak: 'frame_champion',
};

export async function checkAndUnlockAchievements(
  client: PoolClient,
  ctx: AchievementContext,
): Promise<string[]> {
  const unlocked: string[] = [];
  const { userId, gameId, gameState, winnerId, rank, totalPlayers, isRanked, playerMu, opponentAvgMu } = ctx;
  const isWinner = rank === 1;

  // first_blood: first ever win
  if (isWinner) {
    const prior = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND gp.final_rank = 1 AND g.game_id != $2 AND g.status = 'completed'`,
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

  // comeback_king: win after having lowest probability at some point
  if (isWinner && gameState.win_probability_history && gameState.win_probability_history.length > 2) {
    const wasLowest = gameState.win_probability_history.some((snap) => {
      const probs = Object.entries(snap.probabilities);
      if (probs.length < 2) return false;
      const myProb = snap.probabilities[userId] ?? 0;
      return probs.every(([pid, p]) => pid === userId || p >= myProb) && myProb < 0.5;
    });
    if (wasLowest) unlocked.push('comeback_king');
  }

  // perfect_defense: win and probability never decreased after step 3
  if (isWinner && gameState.win_probability_history && gameState.win_probability_history.length > 3) {
    let perfect = true;
    let prevProb = 0;
    for (let i = 3; i < gameState.win_probability_history.length; i++) {
      const p = gameState.win_probability_history[i].probabilities[userId] ?? 0;
      if (i > 3 && p < prevProb - 0.01) { perfect = false; break; }
      prevProb = p;
    }
    if (perfect) unlocked.push('perfect_defense');
  }

  // underdog: win ranked against higher-rated opponent
  if (isWinner && isRanked && opponentAvgMu - playerMu >= 200) {
    unlocked.push('underdog');
  }

  // first_ranked_win
  if (isWinner && isRanked) {
    const priorRanked = await client.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM game_players gp
       JOIN games g ON g.game_id = gp.game_id
       WHERE gp.user_id = $1 AND gp.final_rank = 1 AND g.is_ranked = true
         AND g.game_id != $2 AND g.status = 'completed'`,
      [userId, gameId],
    );
    if (parseInt(priorRanked.rows[0]?.cnt ?? '0', 10) === 0) {
      unlocked.push('first_ranked_win');
    }
  }

  // tutorial_complete: finish the tutorial game
  if (gameState.settings.tutorial) {
    unlocked.push('tutorial_complete');
  }

  // card_shark: redeem 5+ card sets in a single game
  const playerForCards = gameState.players.find((p) => p.player_id === userId);
  if ((playerForCards?.cards_redeemed_count ?? 0) >= 5) {
    unlocked.push('card_shark');
  }

  // blitzkrieg: capture 10+ territories in a single turn
  const playerForBlitz = gameState.players.find((p) => p.player_id === userId);
  if ((playerForBlitz?.territories_captured_turn_max ?? 0) >= 10) {
    unlocked.push('blitzkrieg');
  }

  // diplomat: establish a truce with every other human player in a single game
  if (gameState.settings.diplomacy_enabled) {
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
    const eraAchievements: Record<string, string> = {
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

  // ten_streak
  const recentGames = await client.query<{ won: boolean }>(
    `SELECT (gp.final_rank = 1) AS won
     FROM game_players gp
     JOIN games g ON g.game_id = gp.game_id
     WHERE gp.user_id = $1 AND g.status = 'completed'
     ORDER BY g.ended_at DESC
     LIMIT 10`,
    [userId],
  );
  if (recentGames.rows.length >= 10 && recentGames.rows.every((r) => r.won)) {
    unlocked.push('ten_streak');
  }

  // veteran: 50+ games
  const totalGames = await client.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM game_players gp
     JOIN games g ON g.game_id = gp.game_id
     WHERE gp.user_id = $1 AND g.status = 'completed'`,
    [userId],
  );
  if (parseInt(totalGames.rows[0]?.cnt ?? '0', 10) >= 50) {
    unlocked.push('veteran');
  }

  // strategist: ranked mu >= 1500 (check in context)
  if (isRanked && playerMu >= 1500) {
    unlocked.push('strategist');
  }

  // Persist unlocks
  const newlyUnlocked: string[] = [];
  for (const achId of unlocked) {
    const result = await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING achievement_id`,
      [userId, achId],
    );
    if (result.rowCount && result.rowCount > 0) {
      newlyUnlocked.push(achId);

      // Grant XP from achievement
      const achRow = await client.query<{ xp_reward: number }>(
        'SELECT xp_reward FROM achievements WHERE achievement_id = $1',
        [achId],
      );
      if (achRow.rows[0]) {
        const userRow = await client.query<{ xp: number }>(
          'SELECT xp FROM users WHERE user_id = $1',
          [userId],
        );
        const newXp = (userRow.rows[0]?.xp ?? 0) + achRow.rows[0].xp_reward;
        await client.query(
          'UPDATE users SET xp = $1, level = $2 WHERE user_id = $3',
          [newXp, computeLevel(newXp), userId],
        );
      }

      // Grant linked cosmetic
      const cosmeticId = ACHIEVEMENT_COSMETIC_MAP[achId];
      if (cosmeticId) {
        await client.query(
          `INSERT INTO user_cosmetics (user_id, cosmetic_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
          [userId, cosmeticId],
        );
      }
    }
  }

  // Rating milestone cosmetic: frame_silver at ranked 1600+
  if (isRanked && playerMu >= 1600) {
    await client.query(
      `INSERT INTO user_cosmetics (user_id, cosmetic_id)
       VALUES ($1, 'frame_silver')
       ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
      [userId],
    );
  }

  return newlyUnlocked;
}
