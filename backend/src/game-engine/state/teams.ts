// ============================================================
// Teams — allies who never fight, see together and win together
// ============================================================
//
// A team game deals every seat to a side (`state.teams`). The rules are the
// same whichever board deals them (the Galactic Age's Allied houses and 2v2,
// state/galaxyTeams.ts):
//   • No friendly fire. Nothing a player can aim at another player's ground (an
//     attack, a blitz, a Fleet Attack, a strike, a bomb, a Drop Assault,
//     Influence) may be aimed at an ally's: the server refuses it, and the AI
//     never plans it.
//   • An opening ceasefire. Until every seat has had its first turn, no side
//     may aim any of that at another (inOpeningCeasefire).
//   • Shared regions. A region the side holds whole pays its bonus once, to
//     the member holding the most of it (regionBonusHolder).
//   • Shared vision. Under fog a player sees whatever any ally sees.
//   • Shared victory. A side wins together, on the team reading of every
//     condition (victory/teamVictory.ts), and an eliminated member shares it.
// A game without `teams` plays free-for-all, and every helper here answers as
// if nobody had an ally, so the rest of the engine plays as it always has.

import type { GameState, GameTeam } from '../../types';

type TeamsView = Pick<GameState, 'teams'>;

/**
 * Team play's switches. ⚠ Balance: measured in backend/scripts/GALAXY-BALANCE.md
 * §9; the sim's SIM_CEASEFIRE=0 patches this object to measure the game without
 * the opening ceasefire.
 */
export const TEAM_TUNING = { openingCeasefire: true };

/** True when this game is played in teams. */
export function isTeamGame(state: TeamsView): boolean {
  return (state.teams?.length ?? 0) > 0;
}

/** The side a player is on, or null in a free-for-all game. */
export function teamOf(state: TeamsView, playerId: string | null | undefined): GameTeam | null {
  if (!playerId || !state.teams) return null;
  return state.teams.find((t) => t.player_ids.includes(playerId)) ?? null;
}

/** True when two different players are on the same side. */
export function areAllies(
  state: TeamsView,
  playerIdA: string | null | undefined,
  playerIdB: string | null | undefined,
): boolean {
  if (!playerIdA || !playerIdB || playerIdA === playerIdB || !state.teams) return false;
  return teamOf(state, playerIdA)?.player_ids.includes(playerIdB) ?? false;
}

/**
 * True when ground held by `ownerId` is friendly to `playerId`: their own, or
 * an ally's. Neutral ground (no owner) is not.
 */
export function isFriendlyOwner(
  state: TeamsView,
  playerId: string,
  ownerId: string | null | undefined,
): boolean {
  return !!ownerId && (ownerId === playerId || areAllies(state, playerId, ownerId));
}

/**
 * The opening ceasefire of a team game: until every seat has had its first
 * turn, no side may attack another (neutral ground stays open). Without it,
 * moving first decided too many team games: the side that moved first won 65%
 * of 2v2 games, because the other side's last seat was attacked twice before it
 * had moved at all (backend/scripts/GALAXY-BALANCE.md §9). The first round is
 * counted from the starting seat. The turn counter rolls over at seat 0, so a
 * game that starts at another seat is still in its first round early in turn 2.
 */
export function inOpeningCeasefire(
  state: Pick<GameState, 'teams' | 'turn_number' | 'current_player_index' | 'starting_player_index'>,
): boolean {
  if (!isTeamGame(state) || !TEAM_TUNING.openingCeasefire) return false;
  const start = state.starting_player_index ?? 0;
  return state.turn_number === 1 || (state.turn_number === 2 && state.current_player_index < start);
}

/**
 * True when `playerId` may aim nothing at ground `ownerId` holds: an ally's,
 * always, and any other player's during the opening ceasefire. Neutral ground
 * and the player's own never count. Every hostile path checks this: the socket
 * handlers, the engine's own guards, and the AI's target choice.
 */
export function isShieldedFrom(
  state: Pick<GameState, 'teams' | 'turn_number' | 'current_player_index' | 'starting_player_index'>,
  playerId: string,
  ownerId: string | null | undefined,
): boolean {
  if (!ownerId || ownerId === playerId) return false;
  return areAllies(state, playerId, ownerId) || inOpeningCeasefire(state);
}

/** A player's allies (never the player), in seat order. */
export function allyIdsOf(state: TeamsView, playerId: string): string[] {
  return teamOf(state, playerId)?.player_ids.filter((id) => id !== playerId) ?? [];
}

/** Everyone on a player's side, the player included: just them in a free-for-all game. */
export function sideOf(state: TeamsView, playerId: string): string[] {
  return teamOf(state, playerId)?.player_ids ?? [playerId];
}

/**
 * Who collects a region's bonus, given the owner of each of its territories:
 * the owner, when one player holds it all; in a team game, when one side holds
 * it all between its members, the member holding the most of it (ties go to the
 * earlier seat), so a region split between allies still pays, and pays once.
 * Null when nobody holds it whole.
 */
export function regionBonusHolder(
  state: Pick<GameState, 'teams'>,
  owners: ReadonlyArray<string | null | undefined>,
): string | null {
  const first = owners[0];
  if (!first) return null;
  if (owners.every((o) => o === first)) return first;
  const team = teamOf(state, first);
  if (!team || !owners.every((o) => !!o && team.player_ids.includes(o))) return null;
  const held = new Map<string, number>();
  for (const o of owners) held.set(o!, (held.get(o!) ?? 0) + 1);
  let holder: string | null = null;
  for (const id of team.player_ids) {
    const n = held.get(id) ?? 0;
    if (n > 0 && (holder === null || n > held.get(holder)!)) holder = id;
  }
  return holder;
}

/** Why a shielded target is refused, for the error a player sees. */
export function shieldedTargetError(
  state: TeamsView,
  playerId: string,
  ownerId: string | null | undefined,
): string {
  return areAllies(state, playerId, ownerId)
    ? 'You cannot attack an ally'
    : 'The opening ceasefire holds until every player has had a turn';
}
