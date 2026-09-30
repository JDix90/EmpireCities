// ============================================================
// Galactic Age team boards — Allied houses and 2v2
// ============================================================
//
// Two boards deal teams, and the team rules are the engine's (state/teams.ts):
//   • ALLIED HOUSES (the Schism's five to eight seats, House Relations
//     "Allied"): every world is one side. A split world's two houses are a side
//     of two, sharing their faction's kit and their world, so the Concord and
//     the Lane Crown have nothing to settle between them (galaxySchism.ts leaves
//     both out); in a Partial Schism a seat holding a whole world is a side of
//     one. Four sides, whatever the seat count.
//   • 2v2 (four seats, the lobby's "2v2"): the four home worlds pair off into
//     two sides of two, as GALAXY_2V2_PAIRS says.
//
// Allies never play back to back. The seats are reordered so each side's turns
// come round as evenly spaced as they can (A B C D A B C D at eight seats,
// A B A B at four, A B C A D at five with one pair), each side keeping its
// members in the order they were seated. Back to back, a side would play two
// turns running, and the gateway one ally softened the other would take before
// anyone could answer.

import type { EraId, GameMap, GameSettings, GameTeam, PlayerState } from '../../types';
import { getEraFactions } from '../eras';
import { factionHomeWorld, GALAXY_CLASSIC_SEATS } from './galaxyModes';
import { getAllowedVictoryConditions } from './gameSettings';
import { isSchismSeating, normalizeHouseRelations } from './galaxySchism';

/**
 * The two sides of a 2v2 game, as pairs of home worlds. ⚠ Balance: measured in
 * backend/scripts/GALAXY-BALANCE.md §9; the sim's SIM_2V2_PAIRS patches it. The
 * ring runs Sol – Verdan – Rust – Nexus – Sol, so these pair each world with
 * the one across a gap in the ring: every lane is a front, and every player
 * borders both enemies.
 */
export const GALAXY_2V2_PAIRS: Array<[string, string]> = [
  ['sol', 'rust'],
  ['verdan', 'nexus_station'],
];

type Seat = Pick<PlayerState, 'player_id' | 'faction_id'>;

/** A 2v2 deal: the Galactic Age on its galaxy map, four seats, with the lobby's 2v2 on. */
export function isTwoVersusTwoSeating(era: EraId, map: GameMap, seats: number, settings: Pick<GameSettings, 'galaxy_2v2'>): boolean {
  return era === 'galaxy_age' && map.map_kind === 'galaxy' && seats === GALAXY_CLASSIC_SEATS && settings.galaxy_2v2 === true;
}

function homeWorldsBySeat(era: EraId, map: GameMap, players: readonly Seat[]): string[] | null {
  const byFaction = new Map(getEraFactions(era).map((f) => [f.faction_id, f]));
  const worlds: string[] = [];
  for (const p of players) {
    const faction = p.faction_id ? byFaction.get(p.faction_id) : undefined;
    const world = faction ? factionHomeWorld(map, faction) : null;
    if (!world) return null;
    worlds.push(world);
  }
  return worlds;
}

function factionName(era: EraId, factionId: string | null | undefined): string {
  return getEraFactions(era).find((f) => f.faction_id === factionId)?.name ?? 'Allies';
}

/**
 * The sides this game deals, or null for a free-for-all game. Read once the
 * factions are dealt (every seat on a faction whose home is one of the four
 * worlds). Members are listed in seat order; `team_id`s are placeholders the
 * caller numbers once the seats are reordered.
 */
export function galaxyTeamsFor(
  era: EraId,
  map: GameMap,
  players: readonly Seat[],
  settings: Pick<GameSettings, 'galaxy_house_relations' | 'galaxy_2v2'>,
): GameTeam[] | null {
  const worlds = homeWorldsBySeat(era, map, players);
  if (!worlds) return null;
  const seatsOn = (wanted: readonly string[]) =>
    players.filter((_, i) => wanted.includes(worlds[i]!)).map((p) => p.player_id);

  if (isSchismSeating(era, map, players.length)
    && normalizeHouseRelations(settings.galaxy_house_relations) === 'allied') {
    const firstSeatOf = new Map<string, number>();
    worlds.forEach((w, i) => { if (!firstSeatOf.has(w)) firstSeatOf.set(w, i); });
    const teams = [...firstSeatOf.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([world, seat]) => ({ team_id: world, name: factionName(era, players[seat]!.faction_id), player_ids: seatsOn([world]) }));
    return teams.length === 4 && teams.every((t) => t.player_ids.length >= 1 && t.player_ids.length <= 2)
      ? teams
      : null;
  }

  if (isTwoVersusTwoSeating(era, map, players.length, settings)) {
    if (new Set(worlds).size !== worlds.length) return null;
    const teams = GALAXY_2V2_PAIRS.map((pair) => {
      const ids = seatsOn(pair);
      const names = ids.map((id) => factionName(era, players.find((p) => p.player_id === id)!.faction_id));
      return { team_id: pair.join('+'), name: names.join(' & '), player_ids: ids };
    });
    return teams.every((t) => t.player_ids.length === 2) ? teams : null;
  }
  return null;
}

/**
 * Reorder the seats so each side's turns come round evenly spaced: the sides, in
 * the order they were first seated, lay their members at even intervals round
 * the table (a side of k members at places j, j + n/k, … round n seats, for its
 * place j among the sides; its members take them in their own seat order), and
 * the seats are read off in order. With sides of equal size that is the first
 * member of every side, then every second member, and so on.
 * Mutates `players` (and each `player_index`, which is the seat) and returns
 * the teams with their members in the new seat order and numbered ids.
 */
export function seatTeamsApart<T extends { player_id: string; player_index: number }>(
  players: T[],
  teams: readonly GameTeam[],
): GameTeam[] {
  const seatOf = new Map(players.map((p, i) => [p.player_id, i]));
  const sides = [...teams]
    .map((t) => ({ ...t, player_ids: [...t.player_ids].sort((a, b) => seatOf.get(a)! - seatOf.get(b)!) }))
    .sort((a, b) => seatOf.get(a.player_ids[0]!)! - seatOf.get(b.player_ids[0]!)!);
  const seated = sides.reduce((n, side) => n + side.player_ids.length, 0);
  const placed = sides.flatMap((side, j) => {
    const k = side.player_ids.length;
    const places = side.player_ids.map((_, m) => (j + (m * seated) / k) % seated).sort((a, b) => a - b);
    return side.player_ids.map((id, m) => ({ id, at: places[m]!, j, m }));
  });
  placed.sort((a, b) => a.at - b.at || a.j - b.j || a.m - b.m);
  const order = placed.map((p) => p.id);
  // Anyone the teams leave out keeps their place at the end, in seat order.
  for (const p of players) if (!order.includes(p.player_id)) order.push(p.player_id);
  const byId = new Map(players.map((p) => [p.player_id, p]));
  players.splice(0, players.length, ...order.map((id) => byId.get(id)!));
  players.forEach((p, i) => { p.player_index = i; });
  const newSeat = new Map(players.map((p, i) => [p.player_id, i]));
  return sides.map((side, i) => ({
    team_id: `team_${i + 1}`,
    name: side.name,
    player_ids: [...side.player_ids].sort((a, b) => newSeat.get(a)! - newSeat.get(b)!),
  }));
}

/**
 * A team game plays without secret missions: each is a win of one's own, and
 * one could name an ally to eliminate. Drops the condition from the game's own
 * settings, leaving Domination if it was the only way to win.
 */
export function dropSecretMissions(settings: GameSettings): void {
  const allowed = getAllowedVictoryConditions(settings);
  if (!allowed.includes('secret_mission')) return;
  const rest = allowed.filter((c) => c !== 'secret_mission');
  settings.allowed_victory_conditions = rest.length > 0 ? rest : ['domination'];
  if (settings.victory_type === 'secret_mission') settings.victory_type = 'domination';
}
