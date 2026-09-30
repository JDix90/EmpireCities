// ============================================================
// Team victory — a side wins together
// ============================================================
//
// checkVictory's reading of a team game (state/teams.ts). A side is judged as
// one player would be:
//   • Last standing: every player still in the game is on one side.
//   • Domination and threshold count the side's territories together.
//   • Capital: the side holds every living player's capital.
//   • The conditions one player completes (Lane Sovereignty, whose corridors
//     count the side's gateways; Lunar Hegemony; a secret mission;
//     Transcendence) win for the side when any living member completes one.
//   • The turn limit, and every human being out of the game, credit the
//     leading side: most territories, then most units.
// Every member of a winning side wins, an eliminated one included. The living
// members are listed first, in seat order, so `winner_id` (the first) names a
// player still on the board.

import type { GameMap, GameState, PlayerState, VictoryConditionKey } from '../../types';
import { getMaxEraIndex } from '../eraAdvancement/spines';
import { getAllowedVictoryConditions, normalizeGameSettings } from '../state/gameSettings';
import { hasCompletedHegemony } from '../state/lunarHegemony';
import { hasLaneSovereignty } from './laneSovereignty';
import { isMissionComplete } from './missions';

export interface TeamVictoryResult {
  winnerIds: string[];
  condition: VictoryConditionKey;
}

/**
 * Every side, in seat order of its first member: each team, and any player the
 * teams leave out on their own (a team board deals every seat, so none do).
 */
export function sidesOf(state: Pick<GameState, 'teams' | 'players'>): string[][] {
  const seated = new Set<string>();
  const sides: string[][] = [];
  for (const team of state.teams ?? []) {
    const members = team.player_ids.filter((id) => state.players.some((p) => p.player_id === id));
    if (members.length === 0) continue;
    members.forEach((id) => seated.add(id));
    sides.push(members);
  }
  for (const p of state.players) if (!seated.has(p.player_id)) sides.push([p.player_id]);
  const seatOf = (id: string) => state.players.findIndex((p) => p.player_id === id);
  return sides
    .map((side) => [...side].sort((a, b) => seatOf(a) - seatOf(b)))
    .sort((a, b) => seatOf(a[0]!) - seatOf(b[0]!));
}

/** The territories a side holds between them. */
export function sideTerritoryCount(state: Pick<GameState, 'players'>, side: readonly string[]): number {
  return state.players.reduce((n, p) => (side.includes(p.player_id) ? n + p.territory_count : n), 0);
}

function sideUnits(state: GameState, side: readonly string[]): number {
  let n = 0;
  for (const t of Object.values(state.territories)) {
    if (t.owner_id && side.includes(t.owner_id)) n += t.unit_count ?? 0;
  }
  return n;
}

/** The leading side: most territories, then most units, then the first seated. */
function leadingSide(state: GameState, sides: string[][]): string[] {
  return [...sides].sort(
    (a, b) => sideTerritoryCount(state, b) - sideTerritoryCount(state, a) || sideUnits(state, b) - sideUnits(state, a),
  )[0]!;
}

function sideHoldsEveryCapital(state: GameState, side: readonly string[]): boolean {
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    if (!p.capital_territory_id) return false;
    const holder = state.territories[p.capital_territory_id]?.owner_id;
    if (!holder || !side.includes(holder)) return false;
  }
  return true;
}

function holdsWonder(state: GameState, playerId: string): boolean {
  return Object.values(state.territories).some(
    (t) => t.owner_id === playerId && (t.buildings ?? []).some((b) => b.startsWith('wonder_')),
  );
}

/**
 * The winning side of a team game, or null while no side has won. Called by
 * checkVictory for every game with `teams`; a free-for-all game never reaches it.
 */
export function checkTeamVictory(state: GameState, map: GameMap): TeamVictoryResult | null {
  const byId = new Map(state.players.map((p) => [p.player_id, p]));
  const isLive = (id: string) => byId.get(id)?.is_eliminated === false;
  const winnersOf = (side: readonly string[]) => [...side.filter(isLive), ...side.filter((id) => !isLive(id))];
  const live = sidesOf(state).filter((side) => side.some(isLive));
  if (live.length === 0) return null;
  if (live.length === 1) return { winnerIds: winnersOf(live[0]!), condition: 'last_standing' };

  // Every human's side is out: credit the leading side, as checkVictory credits
  // the leading AI. A human whose allies are still playing is still in the game,
  // eliminated or not, because their side can still win.
  const hasHumanSeat = state.players.some((p) => !p.is_ai);
  if (hasHumanSeat && !live.some((side) => side.some((id) => byId.get(id)?.is_ai === false))) {
    return { winnerIds: winnersOf(leadingSide(state, live)), condition: 'humans_eliminated' };
  }

  const settings = normalizeGameSettings(state.settings);
  const allowed = getAllowedVictoryConditions(settings);
  const totalTerritories = Object.keys(state.territories).length;
  const winners: Array<{ side: string[]; condition: VictoryConditionKey }> = [];

  for (const side of live) {
    const members = side.filter(isLive).map((id) => byId.get(id)!) as PlayerState[];
    const held = sideTerritoryCount(state, side);
    let condition: VictoryConditionKey | null = null;

    if (allowed.includes('domination') && held >= totalTerritories) condition = 'domination';
    if (condition == null && allowed.includes('threshold') && settings.victory_threshold != null) {
      const need = Math.ceil((totalTerritories * settings.victory_threshold) / 100);
      if (held >= need) condition = 'threshold';
    }
    if (condition == null && allowed.includes('lunar_hegemony')
      && members.some((p) => hasCompletedHegemony(state, p.player_id))) {
      condition = 'lunar_hegemony';
    }
    if (condition == null && allowed.includes('capital') && sideHoldsEveryCapital(state, side)) {
      condition = 'capital';
    }
    if (condition == null && allowed.includes('lane_sovereignty')
      && members.some((p) => hasLaneSovereignty(state, p.player_id))) {
      condition = 'lane_sovereignty';
    }
    if (condition == null && allowed.includes('secret_mission')
      && members.some((p) => p.secret_mission && p.secret_mission.kind !== 'alliance' && isMissionComplete(state, map, p))) {
      condition = 'secret_mission';
    }
    if (condition == null && allowed.includes('transcendence') && settings.era_advancement_enabled
      && members.some((p) => (p.current_era_index ?? 0) >= getMaxEraIndex(state) && holdsWonder(state, p.player_id))) {
      condition = 'transcendence';
    }
    if (condition != null) winners.push({ side, condition });
  }

  // Stalemate guard, as in checkVictory: past the turn cap with nobody through,
  // the leading side wins.
  const maxTurns = settings.max_turns;
  if (winners.length === 0 && typeof maxTurns === 'number' && maxTurns > 0 && state.turn_number > maxTurns) {
    return { winnerIds: winnersOf(leadingSide(state, live)), condition: 'turn_limit' };
  }
  if (winners.length === 0) return null;

  // Two sides through at once: the side on the move wins, else the one seated
  // first, as checkVictory breaks a tie between players.
  const current = state.players[state.current_player_index]?.player_id;
  const pick = winners.find((w) => !!current && w.side.includes(current)) ?? winners[0]!;
  return { winnerIds: winnersOf(pick.side), condition: pick.condition };
}

/**
 * Who is credited when the last human in a team game resigns past the grace
 * window: the leading side other than the resigner's, living members first. To
 * resign is to concede for your side, so a resignation never hands the resigner
 * a win. Null when no other side is still playing.
 */
export function concededTeamWinners(state: GameState, resignerId: string): string[] | null {
  const byId = new Map(state.players.map((p) => [p.player_id, p]));
  const isLive = (id: string) => byId.get(id)?.is_eliminated === false;
  const others = sidesOf(state).filter((side) => !side.includes(resignerId) && side.some(isLive));
  if (others.length === 0) return null;
  const side = leadingSide(state, others);
  return [...side.filter(isLive), ...side.filter((id) => !isLive(id))];
}
