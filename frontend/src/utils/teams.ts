import type { GameState, GameTeam } from '../store/gameStore';

/**
 * Team games (the Galactic Age's Allied houses and 2v2) deal every seat to a
 * side: allies never attack one another, share vision under fog and win
 * together. The server enforces all of it (backend state/teams.ts); these
 * mirror its reading so the client never offers an attack it would refuse. A
 * game without `teams` is free-for-all, and every helper answers as if nobody
 * had an ally.
 */
type TeamsView = Pick<GameState, 'teams'> | null | undefined;

/** The side a player is on, or null in a free-for-all game. */
export function teamOf(state: TeamsView, playerId: string | null | undefined): GameTeam | null {
  if (!playerId || !state?.teams) return null;
  return state.teams.find((t) => t.player_ids.includes(playerId)) ?? null;
}

/** True when two different players are on the same side. */
export function areAllies(
  state: TeamsView,
  playerIdA: string | null | undefined,
  playerIdB: string | null | undefined,
): boolean {
  if (!playerIdA || !playerIdB || playerIdA === playerIdB) return false;
  return teamOf(state, playerIdA)?.player_ids.includes(playerIdB) ?? false;
}

/**
 * Mirrors backend `inOpeningCeasefire`: in a team game no side attacks another
 * until every seat has had its first turn. The first round is counted from the
 * starting seat; the turn counter rolls over at seat 0, so a game that starts
 * at another seat is still in its first round early in turn 2.
 */
export function inOpeningCeasefire(
  state: Pick<GameState, 'teams' | 'turn_number' | 'current_player_index' | 'starting_player_index'> | null | undefined,
): boolean {
  if (!state?.teams?.length) return false;
  const start = state.starting_player_index ?? 0;
  return state.turn_number === 1 || (state.turn_number === 2 && state.current_player_index < start);
}

/**
 * Mirrors backend `isShieldedFrom`: nothing may be aimed at an ally's ground,
 * nor at another side's during the opening ceasefire.
 */
export function isShieldedFrom(
  state: Pick<GameState, 'teams' | 'turn_number' | 'current_player_index' | 'starting_player_index'> | null | undefined,
  playerId: string | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  if (!state || !playerId || !ownerId || ownerId === playerId) return false;
  return areAllies(state, playerId, ownerId) || inOpeningCeasefire(state);
}

/** A player's allies (never the player), in seat order. */
export function allyIdsOf(state: TeamsView, playerId: string | null | undefined): string[] {
  return teamOf(state, playerId)?.player_ids.filter((id) => id !== playerId) ?? [];
}

/** True when ground held by `ownerId` is the player's own or an ally's. */
export function isFriendlyOwner(state: TeamsView, playerId: string | null | undefined, ownerId: string | null | undefined): boolean {
  return !!ownerId && !!playerId && (ownerId === playerId || areAllies(state, playerId, ownerId));
}

/** Everyone on each side, by display name ("you" for the viewer), for the briefing and HUD. */
function memberNames(state: Pick<GameState, 'players'>, team: GameTeam, viewerId: string | null | undefined): string[] {
  return team.player_ids.map((id) =>
    id === viewerId ? 'you' : state.players.find((p) => p.player_id === id)?.username ?? 'an ally',
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The start briefing's Teams section: who is on the viewer's side, who they
 * face, and the three team rules. Empty in a free-for-all game.
 */
export function describeTeams(
  state: Pick<GameState, 'teams' | 'players' | 'settings'> | null | undefined,
  viewerId: string | null | undefined,
): string[] {
  const teams = state?.teams ?? [];
  if (!state || teams.length === 0) return [];
  const mine = teamOf(state, viewerId);
  const others = teams.filter((t) => t !== mine);
  const sideLine = (t: GameTeam) => `${t.name}: ${joinNames(memberNames(state, t, viewerId))}`;
  const lines: string[] = [];
  if (mine) {
    lines.push(`Your side, the ${sideLine(mine)}.`);
    lines.push(
      others.length === 1
        ? `Against the ${sideLine(others[0]!)}.`
        : `Against ${others.length} sides: ${others.map((t) => `the ${sideLine(t)}`).join('; ')}.`,
    );
  } else {
    lines.push(`${teams.length} sides: ${teams.map((t) => `the ${sideLine(t)}`).join('; ')}.`);
  }
  lines.push('Allies never attack each other, and a side wins together: a member knocked out still wins if the side does.');
  if (state.settings?.fog_of_war) lines.push('Under fog you see whatever your allies see.');
  lines.push('The sides take turns in rotation, so allies never play back to back.');
  return lines;
}

export interface PlayerGroup<P> {
  /** The side, or null for the single ungrouped list of a free-for-all game. */
  team: GameTeam | null;
  /** True when the viewer is on this side. */
  mine: boolean;
  players: P[];
}

/**
 * The HUD's player list: one group per side in a team game, in the order the
 * sides were seated, each with its members in seat order; one ungrouped list,
 * in seat order, otherwise.
 */
export function playerGroups<P extends { player_id: string }>(
  state: { players: P[]; teams?: GameTeam[] },
  viewerId: string | null | undefined,
): Array<PlayerGroup<P>> {
  const teams = state.teams ?? [];
  if (teams.length === 0) return [{ team: null, mine: false, players: state.players }];
  const listed = new Set(teams.flatMap((t) => t.player_ids));
  const groups: Array<PlayerGroup<P>> = teams.map((team) => ({
    team,
    mine: !!viewerId && team.player_ids.includes(viewerId),
    players: team.player_ids
      .map((id) => state.players.find((p) => p.player_id === id))
      .filter((p): p is P => !!p),
  }));
  const rest = state.players.filter((p) => !listed.has(p.player_id));
  if (rest.length > 0) groups.push({ team: null, mine: false, players: rest });
  return groups;
}

/**
 * Mirrors backend `regionBonusHolder`: who collects a region's bonus, given the
 * owner of each of its territories. The owner when one player holds it all; in
 * a team game, when one side holds it all, the member holding the most of it
 * (ties to the earlier seat). Null when nobody holds it whole.
 */
export function regionBonusHolder(
  state: TeamsView,
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
