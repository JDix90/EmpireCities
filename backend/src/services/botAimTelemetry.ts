/**
 * Where bots aim: of the territories bots take from other players, how many
 * were a human's, the leading rival's and the weakest rival's. The live game
 * counts each bot capture against the standings as that bot's turn began
 * (sockets/gameSocket.ts processAiTurn), `game_finished` carries the counts,
 * and Admin's "Solo games by bot level" adds them up by the game's bot level
 * (services/analyticsQueries.ts getSoloGamesByLevel). Data only: nothing here
 * changes how a bot plays.
 *
 * Standings are territories held, as the arena's targets line reads them
 * (scripts/simAiArena.ts weakestRivals): a bot's rivals are the living players
 * outside its team, and its leading and weakest rivals are those holding the
 * most and the fewest, ties included. With one rival left, that rival is both.
 */
import type { GameState, PlayerState } from '../types';
import { areAllies } from '../game-engine/state/teams';

export interface BotAimStandings {
  /** The bot's rivals holding the most territories. */
  leaders: ReadonlySet<string>;
  /** The bot's rivals holding the fewest. */
  weakest: ReadonlySet<string>;
}

export interface BotAimCounts {
  /** Territories bots took from other players; a neutral tile is not counted. */
  from_players: number;
  from_humans: number;
  from_leader: number;
  from_weakest: number;
}

export function emptyBotAimCounts(): BotAimCounts {
  return { from_players: 0, from_humans: 0, from_leader: 0, from_weakest: 0 };
}

/** The leading and weakest rivals of `botId` on the board `state` shows. */
export function botAimStandings(state: GameState, botId: string): BotAimStandings {
  const held = new Map<string, number>();
  for (const t of Object.values(state.territories)) {
    if (t.owner_id) held.set(t.owner_id, (held.get(t.owner_id) ?? 0) + 1);
  }
  const rivals = state.players.filter(
    (p) => !p.is_eliminated && p.player_id !== botId && !areAllies(state, botId, p.player_id),
  );
  if (rivals.length === 0) return { leaders: new Set(), weakest: new Set() };
  const counts = rivals.map((p) => held.get(p.player_id) ?? 0);
  const most = Math.max(...counts);
  const fewest = Math.min(...counts);
  return {
    leaders: new Set(rivals.filter((_, i) => counts[i] === most).map((p) => p.player_id)),
    weakest: new Set(rivals.filter((_, i) => counts[i] === fewest).map((p) => p.player_id)),
  };
}

/** Count one territory a bot took from `defender`, against the standings as its turn began. */
export function countBotCapture(
  counts: BotAimCounts,
  standings: BotAimStandings,
  defender: Pick<PlayerState, 'player_id' | 'is_ai'>,
): void {
  counts.from_players += 1;
  if (!defender.is_ai) counts.from_humans += 1;
  if (standings.leaders.has(defender.player_id)) counts.from_leader += 1;
  if (standings.weakest.has(defender.player_id)) counts.from_weakest += 1;
}

/** The counts as `game_finished` properties: zeros for a game whose bots took nothing. */
export function botAimProperties(counts: BotAimCounts | undefined): Record<string, number> {
  const c = counts ?? emptyBotAimCounts();
  return {
    ai_captures_from_players: c.from_players,
    ai_captures_from_humans: c.from_humans,
    ai_captures_from_leader: c.from_leader,
    ai_captures_from_weakest: c.from_weakest,
  };
}
