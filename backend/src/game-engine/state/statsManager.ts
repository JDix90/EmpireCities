import { pgPool } from '../../db/postgres';
import type { GameState, PlayerState } from '../../types';
import {
  glickoUpdate,
  placementScore,
  syntheticAiOpponent,
  INITIAL_MU,
  INITIAL_PHI,
} from '../rating/ratingService';

type GameType = 'solo' | 'multiplayer' | 'hybrid';

const XP_BASE = 50;
const XP_WIN_BONUS = 100;
const XP_PER_TERRITORY = 2;
const XP_MULTIPLIER: Record<GameType, number> = { solo: 0.5, multiplayer: 1, hybrid: 0.75 };

export function computeRanks(players: PlayerState[], winnerId: string): Map<string, number> {
  const ranks = new Map<string, number>();
  ranks.set(winnerId, 1);

  const eliminated = players
    .filter((p) => p.is_eliminated && p.player_id !== winnerId)
    .sort((a, b) => (b.territory_count ?? 0) - (a.territory_count ?? 0));

  let rank = 2;
  for (const p of eliminated) {
    ranks.set(p.player_id, rank++);
  }

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

  const divisor = Math.max(1, totalPlayers - 1);
  const placementRatio = Math.max(0, (totalPlayers - rank) / divisor);
  xp += Math.round(placementRatio * 40);

  return Math.round(xp * XP_MULTIPLIER[gameType]);
}

export function computeLevel(totalXp: number): number {
  return Math.floor(Math.sqrt(totalXp / 250)) + 1;
}

export interface GameResultContext {
  isRanked: boolean;
  ratingDeltas: Map<string, number>;
  /** XP awarded per human player_id (for UI). */
  xpEarnedByPlayer: Record<string, number>;
}

export async function recordGameResults(
  gameId: string,
  state: GameState,
  winnerId: string,
): Promise<GameResultContext> {
  const ctx: GameResultContext = { isRanked: false, ratingDeltas: new Map(), xpEarnedByPlayer: {} };
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const gameRow = await client.query<{ game_type: GameType; is_ranked: boolean }>(
      'SELECT game_type, COALESCE(is_ranked, false) AS is_ranked FROM games WHERE game_id = $1',
      [gameId],
    );
    const gameType: GameType = gameRow.rows[0]?.game_type ?? 'solo';
    const isRanked = gameRow.rows[0]?.is_ranked ?? false;
    ctx.isRanked = isRanked;

    const ratingType = isRanked ? 'ranked' : 'solo';

    const ranks = computeRanks(state.players, winnerId);
    const humanPlayers = state.players.filter((p) => !p.is_ai);
    const totalPlayers = state.players.length;

    // Fetch current Glicko ratings for all humans
    const ratingRows = humanPlayers.length > 0
      ? (await client.query<{ user_id: string; mu: number; phi: number }>(
          `SELECT user_id, mu, phi FROM user_ratings
           WHERE user_id = ANY($1) AND rating_type = $2`,
          [humanPlayers.map((p) => p.player_id), ratingType],
        )).rows
      : [];
    const ratingMap = new Map(ratingRows.map((r) => [r.user_id, { mu: r.mu, phi: r.phi }]));

    // Build AI opponents for solo rating
    const aiPlayers = state.players.filter((p) => p.is_ai);

    for (const p of humanPlayers) {
      const rank = ranks.get(p.player_id) ?? totalPlayers;
      const xp = computeXp(p, rank, totalPlayers, gameType);

      const current = ratingMap.get(p.player_id) ?? { mu: INITIAL_MU, phi: INITIAL_PHI };

      // Build opponent list
      const opponents = [];
      for (const other of humanPlayers) {
        if (other.player_id === p.player_id) continue;
        const otherRating = ratingMap.get(other.player_id) ?? { mu: INITIAL_MU, phi: INITIAL_PHI };
        opponents.push({
          mu: otherRating.mu,
          phi: otherRating.phi,
          score: placementScore(rank, totalPlayers),
        });
      }
      // For solo/hybrid games, treat AI bots as synthetic opponents
      for (const ai of aiPlayers) {
        const aiOp = syntheticAiOpponent(ai.ai_difficulty ?? 'medium');
        opponents.push({
          mu: aiOp.mu,
          phi: aiOp.phi,
          score: placementScore(rank, totalPlayers),
        });
      }

      const updated = opponents.length > 0
        ? glickoUpdate(current.mu, current.phi, opponents)
        : current;

      const muDelta = Math.round(updated.mu - current.mu);
      ctx.ratingDeltas.set(p.player_id, muDelta);

      // Write Glicko rating
      await client.query(
        `INSERT INTO user_ratings (user_id, rating_type, mu, phi, last_rated)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, rating_type) DO UPDATE
         SET mu = $3, phi = $4, last_rated = NOW()`,
        [p.player_id, ratingType, updated.mu, updated.phi],
      );

      await client.query(
        `UPDATE game_players
         SET final_rank = $1, xp_earned = $2, mmr_change = $3
         WHERE game_id = $4 AND user_id = $5`,
        [rank, xp, muDelta, gameId, p.player_id],
      );
      ctx.xpEarnedByPlayer[p.player_id] = xp;

      const userRow = await client.query<{ xp: number; mmr: number }>(
        'SELECT xp, mmr FROM users WHERE user_id = $1',
        [p.player_id],
      );
      const currentXp = userRow.rows[0]?.xp ?? 0;
      const newXp = currentXp + xp;
      const newLevel = computeLevel(newXp);
      // Keep legacy mmr in sync (mu-500 mapped back to old 1000-base scale)
      const legacyMmr = Math.max(0, Math.round(updated.mu - 500));

      await client.query(
        'UPDATE users SET xp = $1, mmr = $2, level = $3 WHERE user_id = $4',
        [newXp, legacyMmr, newLevel, p.player_id],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[StatsManager] Failed to record game results:', err);
  } finally {
    client.release();
  }
  return ctx;
}
