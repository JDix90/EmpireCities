import { pgPool } from '../../db/postgres';
import type { GameState, PlayerState } from '../../types';

type GameType = 'solo' | 'multiplayer' | 'hybrid';

const XP_BASE = 50;
const XP_WIN_BONUS = 100;
const XP_PER_TERRITORY = 2;
const XP_PER_KILL = 25;
const XP_MULTIPLIER: Record<GameType, number> = { solo: 0.5, multiplayer: 1, hybrid: 0.75 };
const ELO_K = 32;

function computeRanks(players: PlayerState[], winnerId: string): Map<string, number> {
  const ranks = new Map<string, number>();
  ranks.set(winnerId, 1);

  const eliminated = players
    .filter((p) => p.is_eliminated && p.player_id !== winnerId)
    .sort((a, b) => {
      // Higher territory_count at death = eliminated later = lower rank number (better)
      return (b.territory_count ?? 0) - (a.territory_count ?? 0);
    });

  let rank = 2;
  for (const p of eliminated) {
    ranks.set(p.player_id, rank++);
  }

  // Survivors who aren't the winner (shouldn't normally happen, but handle gracefully)
  for (const p of players) {
    if (!ranks.has(p.player_id)) {
      ranks.set(p.player_id, rank++);
    }
  }

  return ranks;
}

function computeXp(
  player: PlayerState,
  rank: number,
  totalPlayers: number,
  gameType: GameType,
): number {
  let xp = XP_BASE;
  xp += player.territory_count * XP_PER_TERRITORY;
  if (rank === 1) xp += XP_WIN_BONUS;

  // Proportional placement bonus: 2nd of 6 players still gets some bonus
  const divisor = Math.max(1, totalPlayers - 1);
  const placementRatio = Math.max(0, (totalPlayers - rank) / divisor);
  xp += Math.round(placementRatio * 40);

  return Math.round(xp * XP_MULTIPLIER[gameType]);
}

function computeLevel(totalXp: number): number {
  return Math.floor(Math.sqrt(totalXp / 250)) + 1;
}

function computeMmrChange(
  playerMmr: number,
  rank: number,
  totalPlayers: number,
  avgMmr: number,
): number {
  const expected = 1 / (1 + Math.pow(10, (avgMmr - playerMmr) / 400));
  const divisor = Math.max(1, totalPlayers - 1);
  const actual = rank === 1 ? 1 : Math.max(0, (totalPlayers - rank) / divisor);
  return Math.round(ELO_K * (actual - expected));
}

/**
 * Record post-game stats for all human players.
 * Called from finalizeGame after the game state is saved.
 */
export async function recordGameResults(
  gameId: string,
  state: GameState,
  winnerId: string,
): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const gameRow = await client.query<{ game_type: GameType }>(
      'SELECT game_type FROM games WHERE game_id = $1',
      [gameId],
    );
    const gameType: GameType = gameRow.rows[0]?.game_type ?? 'solo';

    const ranks = computeRanks(state.players, winnerId);
    const humanPlayers = state.players.filter((p) => !p.is_ai);
    const totalPlayers = state.players.length;
    const avgMmr = humanPlayers.length > 0
      ? humanPlayers.reduce((s, p) => s + (p.mmr ?? 1000), 0) / humanPlayers.length
      : 1000;

    // Track eliminations per player (count of opponents they eliminated)
    const eliminationCounts = new Map<string, number>();
    for (const p of state.players) {
      eliminationCounts.set(p.player_id, 0);
    }

    for (const p of humanPlayers) {
      const rank = ranks.get(p.player_id) ?? totalPlayers;
      const xp = computeXp(p, rank, totalPlayers, gameType);
      const mmrDelta = gameType !== 'solo'
        ? computeMmrChange(p.mmr ?? 1000, rank, totalPlayers, avgMmr)
        : 0;

      await client.query(
        `UPDATE game_players
         SET final_rank = $1, xp_earned = $2, mmr_change = $3
         WHERE game_id = $4 AND user_id = $5`,
        [rank, xp, mmrDelta, gameId, p.player_id],
      );

      // Fetch current user XP to compute new level
      const userRow = await client.query<{ xp: number; mmr: number }>(
        'SELECT xp, mmr FROM users WHERE user_id = $1',
        [p.player_id],
      );
      const currentXp = userRow.rows[0]?.xp ?? 0;
      const currentMmr = userRow.rows[0]?.mmr ?? 1000;
      const newXp = currentXp + xp;
      const newMmr = Math.max(0, currentMmr + mmrDelta);
      const newLevel = computeLevel(newXp);

      await client.query(
        'UPDATE users SET xp = $1, mmr = $2, level = $3 WHERE user_id = $4',
        [newXp, newMmr, newLevel, p.player_id],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[StatsManager] Failed to record game results:', err);
  } finally {
    client.release();
  }
}
