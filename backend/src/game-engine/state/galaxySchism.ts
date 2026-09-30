// ============================================================
// Galactic Age Schism — two houses to a world, at five to eight seats
// ============================================================
//
// At eight seats every world is shared. Each faction is dealt to two seats, and
// each of the two — a HOUSE — opens on one half of the faction's home world
// with the faction's kit: the same abilities on both, told apart by house name
// and colour. Every house has a rival at home and enemies across its lanes.
//
// At five to seven seats (the PARTIAL SCHISM) only as many worlds split as
// there are seats over four; each other world is dealt to one seat. Which
// worlds split follows the faction picks (two seats on one faction split its
// world); the deal fills in the rest. Under the Concord or in Civil War every
// seat is still a house on half a world: a house alone on its world faces not a
// rival but its world's UNCLAIMED half, which opens neutral and garrisoned like
// a colony. Measured, nothing else could even the seats out: a seat on a whole
// world against houses on halves won three to seven times as often, and no
// number of extra units for the houses closed it (GALAXY-BALANCE.md §10).
// Allied, every world is one side, so a seat alone on its world holds all of
// it, as at four seats. The halves' eight-seat numbers even a world's two halves
// against each other with a rival on every world; the partial board has its
// own (PARTIAL_SCHISM_HALVES, PARTIAL_SCHISM_TUNING).
//
// The halves are authored (SCHISM_HALVES) because the four worlds do not split
// the same way. Every half is connected, the two halves of a world are the same
// size, and each holds two of the world's four gateways:
//   • Rust and Verdan split by lane side, so each house faces one neighbour.
//   • Sol splits west and east along its bonus regions, so each house has one
//     lane to Verdan and one to Nexus Station. Sol's lane-side split cuts three
//     of its four regions and snakes both houses across the world.
//   • Nexus Station's gateways alternate around the Vault, so no lane-side
//     split exists there while the Gate Ring stays neutral. Its two houses face
//     each other across the Vault, each with one lane to Rust and one to Sol.
//
// The halves are not the same ground, so each carries its own numbers, measured
// in backend/scripts/GALAXY-BALANCE.md §8: a house bonus in units a turn (the
// Western Mandate's border is twice the Eastern's; the Rust-facing Verdan house
// and the Verdan-facing Rust house face only each other across the lanes, and
// wear each other down), and for the two Custodian houses a lighter opening.
// Kept per turn rather than in opening units where it could be: a house that
// opened far larger than its rival could break the Concord in round one, which
// the AI never does and a player would.
//
// House relations (the lobby's `galaxy_house_relations`) decide how a world's
// two houses start: under the CONCORD, a truce on the ordinary truce rules for
// the opening rounds; in CIVIL WAR, with none; or ALLIED, as one side of a team
// game (galaxyTeams.ts), which never fights the other.
//
// The LANE CROWN: a house holding all four of its home world's gateways (its own
// two and its rival's, or its unclaimed half's) drafts extra units every turn it
// holds them. Schism-only: at four seats every player holds their whole world
// from the first turn. Not worn by Allied houses either, for the same reason:
// between them they hold their whole world from the first turn.

import { randomInt } from 'crypto';
import type {
  DiplomacyEntry,
  EraId,
  GalaxyHouseRelations,
  GalaxySchismHouse,
  GalaxySchismMode,
  GalaxySchismWholeWorld,
  GameMap,
  GameState,
} from '../../types';
import { getEraFactions } from '../eras';
import { factionHomeWorld, GALAXY_CLASSIC_SEATS, GALAXY_HOME_WORLD_IDS, GALAXY_SCHISM_SEATS } from './galaxyModes';
import { gatewaysByWorld } from './galaxyRing';
import { vaultRegionGarrisons } from './worldRules';

/** `randomInt(min, max)`: max exclusive, as node's crypto. */
export type SchismRng = (min: number, max: number) => number;

export const GALAXY_HOUSE_RELATIONS: readonly GalaxyHouseRelations[] = ['concord', 'civil_war', 'allied'];

/** A stored relations setting, read leniently: anything but Civil War or Allied is the Concord. */
export function normalizeHouseRelations(raw: unknown): GalaxyHouseRelations {
  return raw === 'civil_war' || raw === 'allied' ? raw : 'concord';
}

/**
 * Schism's numbers. ⚠ Balance: measured at eight seats in
 * backend/scripts/GALAXY-BALANCE.md; the sim's SIM_CONCORD_ROUNDS and
 * SIM_LANE_CROWN patch this object. A game records both when it is dealt
 * (`galaxy_mode`), so a change here never re-rules a game in progress.
 *   concordRounds: the rounds the Concord truce covers, counting the first.
 *   laneCrownBonus: units a turn for holding all four of your world's gateways.
 */
export const SCHISM_TUNING = { concordRounds: 3, laneCrownBonus: 2 };

/**
 * Allied houses' numbers, by world, the same for both of its houses: units a
 * turn each drafts on top of its kit, and extra units on every tile it opens
 * with (a tile never opens below 1). The Schism's per-half numbers settle a
 * rivalry between a world's two halves; Allied houses have none, so a world's
 * pair is tuned as the one side it is. ⚠ Balance: measured in
 * backend/scripts/GALAXY-BALANCE.md §9; the sim's SIM_ALLIED_REINFORCE and
 * SIM_ALLIED_OPENING patch this object. Recorded on each house when the board
 * is dealt, as the Schism's are.
 */
export const ALLIED_TUNING: Record<string, { reinforce: number; opening: number }> = {
  // Sol's houses hold four whole regions between them and a lane to each
  // neighbour apiece; the Syndicate's sit between Verdan's and Nexus's, both of
  // which collect their split regions now, and take a pounding from both sides.
  sol: { reinforce: -1, opening: 0 },
  verdan: { reinforce: 0, opening: 0 },
  rust: { reinforce: 3, opening: 0 },
  nexus_station: { reinforce: 1, opening: 0 },
};

/**
 * The Partial Schism's numbers, by seat count:
 *   unclaimed: the garrison a lone house's unclaimed half opens with, on its
 *     gateway tiles (the ends of its lanes) and inland — under the Concord or
 *     in Civil War;
 *   allied: units a turn on top of the kit when the houses are Allied, for a
 *     house (one of a side of two) and for a seat holding a whole world alone.
 * ⚠ Balance: measured in backend/scripts/GALAXY-BALANCE.md §10; the sim's
 * SIM_PARTIAL_UNCLAIMED, SIM_PARTIAL_ALLIED_HOUSE and SIM_PARTIAL_ALLIED_WHOLE
 * patch this object. Recorded on the board when it is dealt (the garrison) or
 * on each seat (the units a turn), so a retune never re-rules a game in
 * progress.
 */
export const PARTIAL_SCHISM_TUNING: Record<number, {
  unclaimed: { gateway: number; interior: number };
  allied: { house: number; whole: number };
}> = {
  5: { unclaimed: { gateway: 10, interior: 12 }, allied: { house: 0, whole: 0 } },
  6: { unclaimed: { gateway: 10, interior: 12 }, allied: { house: 0, whole: 0 } },
  7: { unclaimed: { gateway: 10, interior: 12 }, allied: { house: 0, whole: 0 } },
};

/**
 * Units a turn for the house on each half of a world at five to seven seats,
 * under the Concord or in Civil War, in the order of SCHISM_HALVES' halves:
 *   rival: a house sharing its world, which evens a world's two halves against
 *     each other, as the halves' own numbers do at eight seats;
 *   alone: a house alone on its world, against its unclaimed half.
 * They replace the halves' eight-seat numbers (`reinforce_bonus`,
 * `opening_bonus`), which were measured with a rival on every world and a
 * rival on each of its neighbours. ⚠ Balance: measured in
 * backend/scripts/GALAXY-BALANCE.md §10; the sim's SIM_PARTIAL_HALVES patches
 * this object. Recorded on each house when the board is dealt.
 */
export const PARTIAL_SCHISM_HALVES: Record<string, { rival: [number, number]; alone: [number, number] }> = {
  sol: { rival: [0, 0], alone: [0, 0] },
  verdan: { rival: [0, 0], alone: [0, 0] },
  rust: { rival: [0, 0], alone: [0, 0] },
  nexus_station: { rival: [0, 0], alone: [0, 0] },
};

export interface SchismHalf {
  /** The house that opens here, e.g. "Western Mandate". */
  house: string;
  tiles: readonly string[];
  /**
   * Extra units on every tile of this half at the start, on top of the initial
   * count and a Vault world's home-unit bonus (negative takes units off; a
   * tile never opens below 1). Absent is 0.
   */
  opening_bonus?: number;
  /**
   * Units a turn the house on this half drafts on top of its kit, for as long
   * as it lives. ⚠ Balance: it evens out the two halves of a world, which are
   * not the same ground (a longer border, a weaker neighbour); measured in
   * GALAXY-BALANCE.md. Recorded on the house when the board is dealt. Absent is 0.
   */
  reinforce_bonus?: number;
}

/**
 * Each world's two halves on `era_galaxy`. A Vault region (the Nexus Gate Ring)
 * is in neither: it opens neutral, as at every seat count. galaxySchism.test.ts
 * holds these to the committed map (a partition, connected, equal, two gateways
 * each); at runtime `schismHalvesFor` refuses a map they do not partition.
 */
export const SCHISM_HALVES: Readonly<Record<string, readonly [SchismHalf, SchismHalf]>> = {
  // The western hemisphere and the Atlantic arc, against the Crescent and the
  // Asian rim: every region whole, a lane to Verdan and to Nexus on each side.
  // The west's border is four tiles long against the east's two (Maghreb
  // borders four western tiles), so the west drafts +3 a turn.
  sol: [
    {
      house: 'Western Mandate',
      tiles: [
        'sol_amazonia', 'sol_atlantic_europe', 'sol_austral', 'sol_columbia',
        'sol_equatoria', 'sol_guinea', 'sol_pacifica', 'sol_southern_cone',
      ],
      reinforce_bonus: 3,
    },
    {
      house: 'Eastern Mandate',
      tiles: [
        'sol_arabia', 'sol_cathay', 'sol_eastern_reach', 'sol_hindustan',
        'sol_maghreb', 'sol_oceania', 'sol_pacific_rim', 'sol_turkestan',
      ],
    },
  ],
  // By lane side: the Dawnrim house (the Dawnrim and Emberfen regions, and Mycel
  // Deep of the Brilliance Isles) faces Sol; the Duskrim house (the Duskrim and
  // the Storm Belts, and the rest of the Isles) faces Rust. Three border tiles
  // each; the Dawnrim house's regions are worth more (6 against 4). The
  // Duskrim's lanes lead only to Tharsis: +2 a turn to the Dawnrim's +1.
  verdan: [
    {
      house: 'Dawnrim Navigators',
      tiles: [
        'verdan_chlorophage_span', 'verdan_glowmire_shelf', 'verdan_greenfire_vault', 'verdan_lumen_bog',
        'verdan_mycel_deep', 'verdan_saffron_mire', 'verdan_spore_reach', 'verdan_verdigris_span',
      ],
      reinforce_bonus: 1,
    },
    {
      house: 'Duskrim Navigators',
      tiles: [
        'verdan_cinder_bloom', 'verdan_emberleaf_basin', 'verdan_mistveil_hollow', 'verdan_photic_crown',
        'verdan_pollen_sea', 'verdan_sulphur_drift', 'verdan_thundercrown_belt', 'verdan_witchlight_fen',
      ],
      reinforce_bonus: 2,
    },
  ],
  // By lane side, every region whole: Tharsis faces Verdan, Hellas faces Nexus.
  // Tharsis's lanes lead only to the Duskrim house, whose lanes lead only back,
  // while Hellas faces both Custodian houses: Tharsis drafts +3, Hellas 1 fewer.
  rust: [
    {
      house: 'Tharsis Syndicate',
      tiles: [
        'rust_anvil_basin', 'rust_bessemer_cut', 'rust_caldera_foundry', 'rust_crucible_deep',
        'rust_furnace_marches', 'rust_oxide_flats', 'rust_smelter_crown', 'rust_tether_anchorage',
      ],
      reinforce_bonus: 3,
    },
    {
      house: 'Hellas Syndicate',
      tiles: [
        'rust_cinderworks', 'rust_dross_hollow', 'rust_ferro_span', 'rust_hematite_span',
        'rust_ironstorm_belt', 'rust_scoria_flats', 'rust_slag_reach', 'rust_tailing_drift',
      ],
      reinforce_bonus: -1,
    },
  ],
  // Either side of the neutral Vault: the Vault Ward with the Spire Walk's
  // Antenna and Cordon, and the Berth Ring with the Walk's Lodgeway and
  // Quietude. Each house has one lane to Rust and one to Sol. Six tiles a house.
  // The Custodians' kit and the Vault at their door made both houses the
  // strongest seats, so neither gets the Vault's +1 a tile (it pays a faction
  // for a ring it would otherwise hold whole; here neither would), the Berth
  // opens a unit lighter still, and both draft 1 fewer a turn.
  nexus_station: [
    {
      house: 'Ward Custodians',
      tiles: [
        'nexus_antenna_spire', 'nexus_beacon_hollow', 'nexus_cordon_march',
        'nexus_custodian_quarter', 'nexus_resonance_vault', 'nexus_vault_approach',
      ],
      opening_bonus: -1,
      reinforce_bonus: -1,
    },
    {
      house: 'Berth Custodians',
      tiles: [
        'nexus_halo_span', 'nexus_lattice_berth', 'nexus_lodgeway',
        'nexus_quietude_basin', 'nexus_toll_crater', 'nexus_waystation_loni',
      ],
      opening_bonus: -2,
      reinforce_bonus: -1,
    },
  ],
};

/**
 * A Schism deal: the Galactic Age on its galaxy map, at five to eight seats
 * (five to seven are the Partial Schism).
 */
export function isSchismSeating(era: EraId, map: GameMap, seats: number): boolean {
  return era === 'galaxy_age' && map.map_kind === 'galaxy'
    && seats > GALAXY_CLASSIC_SEATS && seats <= GALAXY_SCHISM_SEATS;
}

/** How many worlds split at this many seats: one per seat over four, every world at eight. */
export function schismSplitWorldCount(seats: number): number {
  return Math.max(0, Math.min(GALAXY_HOME_WORLD_IDS.size, seats - GALAXY_CLASSIC_SEATS));
}

/**
 * The factions a Schism game deals: every era faction whose home regions lie on
 * one of the four worlds, one per world. Null when the era does not have
 * exactly that (no Schism is dealt then).
 */
function schismFactions(era: EraId, map: GameMap): Map<string, string> | null {
  const out = new Map<string, string>();
  const worlds = new Set<string>();
  for (const f of getEraFactions(era)) {
    const world = factionHomeWorld(map, f);
    if (!world || worlds.has(world)) continue;
    out.set(f.faction_id, world);
    worlds.add(world);
  }
  return out.size === GALAXY_HOME_WORLD_IDS.size && worlds.size === GALAXY_HOME_WORLD_IDS.size ? out : null;
}

function shuffle<T>(items: T[], rng: SchismRng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * Deal every world's faction to one or two seats, in place, so that exactly
 * `schismSplitWorldCount` worlds have two: all four at eight seats.
 *   • A seat's own pick stands while its faction has a seat left. When three or
 *     more seats pick one faction, two of them keep it (drawn by `rng`).
 *   • At five to seven seats, when more factions were picked twice than worlds
 *     may split, the pairs that stand are drawn, and each other gives one seat
 *     back (drawn too).
 *   • Every seat without a faction then takes one: first a faction nobody
 *     holds, then a second seat on each world still to split, a world nobody
 *     picked before one a seat picked alone, so a lone pick keeps its world
 *     whole where it can.
 * Returns false, changing nothing, when this is not a Schism deal.
 */
export function dealSchismFactions(
  era: EraId,
  map: GameMap,
  players: Array<{ faction_id?: string | null }>,
  rng: SchismRng = randomInt,
): boolean {
  if (!isSchismSeating(era, map, players.length)) return false;
  const factions = schismFactions(era, map);
  if (!factions) return false;
  const split = schismSplitWorldCount(players.length);

  const wanting = new Map<string, number[]>();
  const unassigned: number[] = [];
  players.forEach((p, idx) => {
    if (p.faction_id && factions.has(p.faction_id)) {
      const list = wanting.get(p.faction_id) ?? [];
      list.push(idx);
      wanting.set(p.faction_id, list);
    } else {
      unassigned.push(idx);
    }
  });
  const kept = new Map<string, number[]>();
  for (const [factionId, seats] of wanting) {
    const keep = seats.length > 2 ? shuffle(seats, rng).slice(0, 2) : seats;
    for (const idx of seats) if (!keep.includes(idx)) unassigned.push(idx);
    kept.set(factionId, keep);
  }
  const pairs = [...kept.entries()].filter(([, seats]) => seats.length === 2).map(([factionId]) => factionId);
  if (pairs.length > split) {
    const standing = new Set(shuffle([...pairs], rng).slice(0, split));
    for (const factionId of pairs) {
      if (standing.has(factionId)) continue;
      const seats = kept.get(factionId)!;
      const out = rng(0, 2);
      unassigned.push(seats[out]!);
      kept.set(factionId, [seats[1 - out]!]);
    }
  }
  for (const [factionId, seats] of kept) for (const idx of seats) players[idx]!.faction_id = factionId;

  // Seats each faction ends with: two on the worlds that split, one elsewhere.
  const held = (factionId: string) => kept.get(factionId)?.length ?? 0;
  const target = new Map<string, number>([...factions.keys()].map((f) => [f, held(f) === 2 ? 2 : 1]));
  let toSplit = split - [...target.values()].filter((n) => n === 2).length;
  // A tier is drawn from only when not all of it splits.
  const tier = (list: string[]) => (list.length > toSplit ? shuffle(list, rng) : list);
  for (const list of [[...factions.keys()].filter((f) => held(f) === 0), [...factions.keys()].filter((f) => held(f) === 1)]) {
    for (const factionId of tier(list)) {
      if (toSplit <= 0) break;
      target.set(factionId, 2);
      toSplit--;
    }
  }
  const left = shuffle(
    [...target.entries()].flatMap(([factionId, n]) => Array.from({ length: n - held(factionId) }, () => factionId)),
    rng,
  );
  unassigned.sort((a, b) => a - b).forEach((idx, i) => {
    players[idx]!.faction_id = left[i]!;
  });
  return true;
}

/**
 * The authored halves, when they partition this map's worlds: each world's
 * tiles, less any Vault region, split between its two halves with none left
 * over and none shared. Null otherwise, and no Schism is dealt.
 */
export function schismHalvesFor(map: GameMap): Readonly<Record<string, readonly [SchismHalf, SchismHalf]>> | null {
  const vault = vaultRegionGarrisons(map);
  const worldOf = new Map(map.territories.map((t) => [t.territory_id, t.world_id]));
  for (const world of GALAXY_HOME_WORLD_IDS) {
    const halves = SCHISM_HALVES[world];
    if (!halves) return null;
    const expected = map.territories
      .filter((t) => t.world_id === world && !vault.has(t.territory_id))
      .map((t) => t.territory_id);
    const dealt = [...halves[0].tiles, ...halves[1].tiles];
    if (new Set(dealt).size !== dealt.length || dealt.length !== expected.length) return null;
    if (dealt.some((id) => worldOf.get(id) !== world || vault.has(id))) return null;
  }
  return SCHISM_HALVES;
}

/**
 * The Schism board for these seats, or null when this game does not deal one
 * (not five to eight seats, or the seats are not one or two to each faction's
 * world with the right number of worlds split, or the map is not the one the
 * halves were authored for). Which of a world's two houses takes which half,
 * and which half a house alone on its world opens on, is drawn by `rng` unless
 * `forceHalves` (player id → half) says. Houses and whole-world seats are
 * listed in seat order.
 */
export function schismLayout(
  era: EraId,
  map: GameMap,
  players: ReadonlyArray<{ player_id: string; faction_id?: string | null }>,
  relations: GalaxyHouseRelations,
  opts: { forceHalves?: Readonly<Record<string, 0 | 1>>; rng?: SchismRng } = {},
): GalaxySchismMode | null {
  if (!isSchismSeating(era, map, players.length)) return null;
  const factions = schismFactions(era, map);
  const halves = schismHalvesFor(map);
  if (!factions || !halves) return null;

  const seatsByWorld = new Map<string, number[]>();
  for (let i = 0; i < players.length; i++) {
    const world = players[i]!.faction_id ? factions.get(players[i]!.faction_id!) : undefined;
    if (!world) return null;
    seatsByWorld.set(world, [...(seatsByWorld.get(world) ?? []), i]);
  }
  const counts = [...seatsByWorld.values()].map((seats) => seats.length);
  if (
    seatsByWorld.size !== GALAXY_HOME_WORLD_IDS.size
    || counts.some((n) => n < 1 || n > 2)
    || counts.filter((n) => n === 2).length !== schismSplitWorldCount(players.length)
  ) return null;

  const rng = opts.rng ?? randomInt;
  const allied = relations === 'allied';
  const partial = players.length < GALAXY_SCHISM_SEATS ? PARTIAL_SCHISM_TUNING[players.length] : undefined;
  // A house's own units a turn: its world's Allied numbers, or its half's.
  const houseBonus = (world: string, half: 0 | 1, alone: boolean): number => {
    if (allied) return (ALLIED_TUNING[world]?.reinforce ?? 0) + (partial?.allied.house ?? 0);
    if (!partial) return halves[world]![half].reinforce_bonus ?? 0;
    return PARTIAL_SCHISM_HALVES[world]?.[alone ? 'alone' : 'rival'][half] ?? 0;
  };
  const houseOf = new Map<number, GalaxySchismHouse>();
  const wholeOf = new Map<number, GalaxySchismWholeWorld>();
  const addHouse = (seat: number, world: string, half: 0 | 1, alone: boolean) => {
    const reinforce = houseBonus(world, half, alone);
    houseOf.set(seat, {
      player_id: players[seat]!.player_id,
      world_id: world,
      half,
      name: halves[world]![half].house,
      ...(reinforce ? { reinforce_bonus: reinforce } : {}),
    });
  };
  // World order is fixed so a seeded rng deals the same halves every time.
  for (const world of [...seatsByWorld.keys()].sort()) {
    const seats = seatsByWorld.get(world)!;
    const forced = opts.forceHalves?.[players[seats[0]!]!.player_id];
    if (seats.length === 1 && allied) {
      // An Allied side of one holds its whole world.
      const reinforce = partial?.allied.whole ?? 0;
      wholeOf.set(seats[0]!, {
        player_id: players[seats[0]!]!.player_id,
        world_id: world,
        ...(reinforce ? { reinforce_bonus: reinforce } : {}),
      });
      continue;
    }
    const half: 0 | 1 = forced ?? (rng(0, 2) === 0 ? 0 : 1);
    // A house alone on its world opens on this half; the other is unclaimed.
    addHouse(seats[0]!, world, half, seats.length === 1);
    if (seats.length === 2) addHouse(seats[1]!, world, half === 0 ? 1 : 0, false);
  }

  const gateways = gatewaysByWorld(map);
  const crownGateways: Record<string, string[]> = {};
  for (const world of [...GALAXY_HOME_WORLD_IDS].sort()) crownGateways[world] = gateways.get(world) ?? [];

  return {
    id: 'schism',
    relations,
    concord_rounds: relations === 'concord' ? SCHISM_TUNING.concordRounds : 0,
    lane_crown_bonus: relations === 'allied' ? 0 : SCHISM_TUNING.laneCrownBonus,
    houses: players.flatMap((_, i) => houseOf.get(i) ?? []),
    ...(partial && allied ? { whole_worlds: players.flatMap((_, i) => wholeOf.get(i) ?? []) } : {}),
    ...(partial && !allied ? { unclaimed_garrison: { ...partial.unclaimed } } : {}),
    crown_gateways: crownGateways,
  };
}

/**
 * The tiles of every unclaimed half on this board: the half of a world its lone
 * house did not open on (a Partial Schism under the Concord or in Civil War).
 * Empty on any other board.
 */
export function schismUnclaimedTiles(mode: Pick<GalaxySchismMode, 'houses'>): string[] {
  const perWorld = new Map<string, GalaxySchismHouse[]>();
  for (const h of mode.houses) perWorld.set(h.world_id, [...(perWorld.get(h.world_id) ?? []), h]);
  return [...perWorld.values()].flatMap((houses) => (houses.length === 1
    ? [...(SCHISM_HALVES[houses[0]!.world_id]?.[houses[0]!.half === 0 ? 1 : 0].tiles ?? [])]
    : []));
}

/** The tiles a house opens on. */
export function schismHouseTiles(house: Pick<GalaxySchismHouse, 'world_id' | 'half'>): readonly string[] {
  return SCHISM_HALVES[house.world_id]?.[house.half].tiles ?? [];
}

/**
 * Extra units a house opens with on each of its tiles: its half's
 * `opening_bonus`, or its world's ALLIED_TUNING when the houses are Allied. A
 * Partial Schism under the Concord or in Civil War opens every half even: the
 * halves' eight-seat numbers are not its own (PARTIAL_SCHISM_HALVES).
 */
export function schismOpeningBonus(
  house: Pick<GalaxySchismHouse, 'world_id' | 'half'>,
  relations: GalaxyHouseRelations = 'concord',
  seats: number = GALAXY_SCHISM_SEATS,
): number {
  if (relations === 'allied') return ALLIED_TUNING[house.world_id]?.opening ?? 0;
  if (seats < GALAXY_SCHISM_SEATS) return 0;
  return SCHISM_HALVES[house.world_id]?.[house.half].opening_bonus ?? 0;
}

/** This game's house for a player, if it is a Schism game. */
export function schismHouseOf(state: Pick<GameState, 'galaxy_mode'>, playerId: string): GalaxySchismHouse | null {
  const mode = state.galaxy_mode;
  if (mode?.id !== 'schism') return null;
  return mode.houses.find((h) => h.player_id === playerId) ?? null;
}

/** The other house on a player's home world (none for a house alone on its world). */
export function schismRivalOf(state: Pick<GameState, 'galaxy_mode'>, playerId: string): GalaxySchismHouse | null {
  const mode = state.galaxy_mode;
  const mine = schismHouseOf(state, playerId);
  if (mode?.id !== 'schism' || !mine) return null;
  return mode.houses.find((h) => h.world_id === mine.world_id && h.player_id !== playerId) ?? null;
}

/**
 * Open the Concord: each world's two houses start under a truce for the
 * mode's `concord_rounds`, counting the first (like an event card's truce, it
 * counts the round it lands in). It is an ordinary truce: an attack across it
 * breaks it, with the usual defence and retaliation dice, and the AI keeps it.
 * Civil War opens none. Mutates `diplomacy`.
 */
export function openConcord(
  diplomacy: DiplomacyEntry[],
  players: ReadonlyArray<{ player_id: string; player_index: number }>,
  mode: GalaxySchismMode,
): void {
  if (mode.relations !== 'concord' || mode.concord_rounds <= 0) return;
  const indexOf = new Map(players.map((p) => [p.player_id, p.player_index]));
  const byWorld = new Map<string, number[]>();
  for (const h of mode.houses) {
    const idx = indexOf.get(h.player_id);
    if (idx !== undefined) byWorld.set(h.world_id, [...(byWorld.get(h.world_id) ?? []), idx]);
  }
  for (const [a, b] of byWorld.values()) {
    if (a === undefined || b === undefined) continue;
    let entry = diplomacy.find(
      (d) => (d.player_index_a === a && d.player_index_b === b) || (d.player_index_a === b && d.player_index_b === a),
    );
    if (!entry) {
      entry = { player_index_a: Math.min(a, b), player_index_b: Math.max(a, b), status: 'neutral', truce_turns_remaining: 0 };
      diplomacy.push(entry);
    }
    entry.status = 'truce';
    entry.truce_turns_remaining = mode.concord_rounds;
  }
}

/** True while a player holds every gateway of their house's home world. */
export function holdsLaneCrown(state: Pick<GameState, 'galaxy_mode' | 'territories'>, playerId: string): boolean {
  const mode = state.galaxy_mode;
  const house = schismHouseOf(state, playerId);
  if (mode?.id !== 'schism' || !house) return false;
  const gateways = mode.crown_gateways[house.world_id] ?? [];
  return gateways.length > 0 && gateways.every((id) => state.territories[id]?.owner_id === playerId);
}

/** An Allied Partial Schism seat that holds its whole world alone, if this player is one. */
export function schismWholeWorldOf(
  state: Pick<GameState, 'galaxy_mode'>,
  playerId: string,
): GalaxySchismWholeWorld | null {
  const mode = state.galaxy_mode;
  if (mode?.id !== 'schism') return null;
  return mode.whole_worlds?.find((w) => w.player_id === playerId) ?? null;
}

/**
 * The seat's own units a turn on a Schism board, as recorded when the board was
 * dealt: its house's, or in an Allied Partial Schism a whole world's (0
 * elsewhere).
 */
export function houseReinforceBonus(state: Pick<GameState, 'galaxy_mode'>, playerId: string): number {
  return schismHouseOf(state, playerId)?.reinforce_bonus ?? schismWholeWorldOf(state, playerId)?.reinforce_bonus ?? 0;
}

/** The Lane Crown's reinforcements for this player this turn (0 without it). */
export function laneCrownBonus(state: Pick<GameState, 'galaxy_mode' | 'territories'>, playerId: string): number {
  const mode = state.galaxy_mode;
  return mode?.id === 'schism' && holdsLaneCrown(state, playerId) ? mode.lane_crown_bonus : 0;
}
