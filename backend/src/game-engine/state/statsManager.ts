import { pgPool } from '../../db/postgres';
import type { GameState, PlayerState } from '../../types';
import {
  glickoUpdate,
  scoreVsOpponent,
  syntheticAiOpponent,
  getInitialRatings,
  displayRating,
} from '../rating/ratingService';
import { getXpConfig } from '../../services/adminConfig';

type GameType = 'solo' | 'multiplayer' | 'hybrid';

export function resolveXpConfig(state: GameState) {
  const fallback = getXpConfig();
  const snapshot = state.settings.xp_snapshot;
  return {
    base: snapshot?.base ?? fallback.base,
    win_bonus: snapshot?.win_bonus ?? fallback.win_bonus,
    per_territory: snapshot?.per_territory ?? fallback.per_territory,
    placement_bonus_max: snapshot?.placement_bonus_max ?? fallback.placement_bonus_max,
    multipliers: {
      solo: snapshot?.multipliers?.solo ?? fallback.multipliers.solo,
      multiplayer: snapshot?.multipliers?.multiplayer ?? fallback.multipliers.multiplayer,
      hybrid: snapshot?.multipliers?.hybrid ?? fallback.multipliers.hybrid,
    } as Record<GameType, number>,
  };
}

/**
 * Rank every player for stats/XP/rating. All winners share rank 1 —
 * alliance_victory produces two — then survivors by territory count, then
 * the eliminated (resigners last).
 */
export function computeRanks(players: PlayerState[], winnerIds: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  const winners = new Set(winnerIds);
  for (const id of winnerIds) ranks.set(id, 1);

  // Survivors (non-eliminated, non-winner) outrank the eliminated.
  const survivors = players
    .filter((p) => !p.is_eliminated && !winners.has(p.player_id))
    .sort((a, b) => (b.territory_count ?? 0) - (a.territory_count ?? 0));

  // Resigners always rank below players who fought until elimination,
  // regardless of how many territories they abandoned.
  const eliminated = players
    .filter((p) => p.is_eliminated && !winners.has(p.player_id))
    .sort((a, b) => {
      if (!!a.has_resigned !== !!b.has_resigned) return a.has_resigned ? 1 : -1;
      return (b.territory_count ?? 0) - (a.territory_count ?? 0);
    });

  let rank = Math.max(2, winnerIds.length + 1);
  for (const p of survivors) {
    ranks.set(p.player_id, rank++);
  }
  for (const p of eliminated) {
    ranks.set(p.player_id, rank++);
  }

  return ranks;
}

function computeXp(
  xpConfig: ReturnType<typeof resolveXpConfig>,
  player: PlayerState,
  rank: number,
  totalPlayers: number,
  gameType: GameType,
): number {
  let xp = xpConfig.base;
  xp += player.territory_count * xpConfig.per_territory;
  if (rank === 1) xp += xpConfig.win_bonus;

  const divisor = Math.max(1, totalPlayers - 1);
  const placementRatio = Math.max(0, (totalPlayers - rank) / divisor);
  xp += Math.round(placementRatio * xpConfig.placement_bonus_max);

  return Math.round(xp * xpConfig.multipliers[gameType]);
}

export function computeLevel(totalXp: number): number {
  return Math.floor(Math.sqrt(totalXp / 250)) + 1;
}

export interface GameResultContext {
  isRanked: boolean;
  ratingDeltas: Map<string, number>;
  /**
   * True while the player's rating is still calibrating (high RD): early
   * games swing by hundreds of points, and the UI should frame the delta as
   * provisional rather than presenting "-263" as a settled judgement.
   */
  ratingProvisional: Map<string, boolean>;
  /** XP awarded per human player_id (for UI). */
  xpEarnedByPlayer: Record<string, number>;
}

export async function recordGameResults(
  gameId: string,
  state: GameState,
  winnerIds: string[],
): Promise<GameResultContext> {
  const ctx: GameResultContext = {
    isRanked: false,
    ratingDeltas: new Map(),
    ratingProvisional: new Map(),
    xpEarnedByPlayer: {},
  };
  const xpConfig = resolveXpConfig(state);
  const initialRatings = getInitialRatings();
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

    const ranks = computeRanks(state.players, winnerIds);
    const winners = new Set(winnerIds);
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
      const xp = computeXp(xpConfig, p, rank, totalPlayers, gameType);

      const current = ratingMap.get(p.player_id) ?? { mu: initialRatings.mu, phi: initialRatings.phi };

      // Membership, not identity: alliance_victory has two winners and the
      // co-winner must not be scored as a loss against AI opponents.
      const isWinner = winners.has(p.player_id);

      // Build opponent list
      const opponents = [];
      for (const other of humanPlayers) {
        if (other.player_id === p.player_id) continue;
        const otherRating = ratingMap.get(other.player_id) ?? { mu: initialRatings.mu, phi: initialRatings.phi };
        opponents.push({
          mu: otherRating.mu,
          phi: otherRating.phi,
          score: scoreVsOpponent({ rank, totalPlayers, isWinner, opponentIsAi: false }),
        });
      }
      // For solo/hybrid games, treat AI bots as synthetic opponents.
      // Only a win scores against AI — losses and resignations cannot
      // farm rating from AI placement padding.
      for (const ai of aiPlayers) {
        const aiOp = syntheticAiOpponent(ai.ai_difficulty ?? 'medium');
        opponents.push({
          mu: aiOp.mu,
          phi: aiOp.phi,
          score: scoreVsOpponent({ rank, totalPlayers, isWinner, opponentIsAi: true }),
        });
      }

      const updated = opponents.length > 0
        ? glickoUpdate(current.mu, current.phi, opponents)
        : current;

      const muDelta = Math.round(updated.mu - current.mu);
      ctx.ratingDeltas.set(p.player_id, muDelta);
      ctx.ratingProvisional.set(p.player_id, displayRating(updated.mu, updated.phi).provisional);

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
