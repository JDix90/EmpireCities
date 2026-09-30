// ============================================================
// Galactic Age Schism — eight seats, two houses to every world
// ============================================================
//
// At eight seats every world is shared. Each faction is dealt to two seats, and
// each of the two — a HOUSE — opens on one half of the faction's home world
// with the faction's kit: the same abilities on both, told apart by house name
// and colour. Every house has a rival at home and enemies across its lanes.
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
// two and its rival's) drafts extra units every turn it holds them. Schism-only:
// at four seats every player holds their whole world from the first turn. Not
// worn by Allied houses either, for the same reason: between them they hold
// their whole world from the first turn.

import { randomInt } from 'crypto';
import type {
  DiplomacyEntry,
  EraId,
  GalaxyHouseRelations,
  GalaxySchismHouse,
  GalaxySchismMode,
  GameMap,
  GameState,
} from '../../types';
import { getEraFactions } from '../eras';
import { factionHomeWorld, GALAXY_HOME_WORLD_IDS, GALAXY_SCHISM_SEATS } from './galaxyModes';
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

/** A Schism deal: the Galactic Age on its galaxy map, at eight seats. */
export function isSchismSeating(era: EraId, map: GameMap, seats: number): boolean {
  return era === 'galaxy_age' && map.map_kind === 'galaxy' && seats === GALAXY_SCHISM_SEATS;
}

/**
 * The factions a Schism game deals, two seats each: every era faction whose
 * home regions lie on one of the four worlds, one per world. Null when the era
 * does not have exactly that (no Schism is dealt then).
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
  return out.size * 2 === GALAXY_SCHISM_SEATS && worlds.size === GALAXY_HOME_WORLD_IDS.size ? out : null;
}

function shuffle<T>(items: T[], rng: SchismRng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * Deal each world's faction to exactly two seats, in place. A seat's own pick
 * stands while its faction has a slot left; when three or more seats pick one
 * faction, two of them keep it (drawn by `rng`) and the rest join the seats with
 * no pick, which take the slots left in shuffled order. Returns false, changing
 * nothing, when this is not a Schism deal.
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

  const slots = new Map<string, number>([...factions.keys()].map((f) => [f, 2]));
  const wanting = new Map<string, number[]>();
  const unassigned: number[] = [];
  players.forEach((p, idx) => {
    if (p.faction_id && slots.has(p.faction_id)) {
      const list = wanting.get(p.faction_id) ?? [];
      list.push(idx);
      wanting.set(p.faction_id, list);
    } else {
      unassigned.push(idx);
    }
  });
  for (const [factionId, seats] of wanting) {
    const keep = seats.length > 2 ? shuffle(seats, rng).slice(0, 2) : seats;
    for (const idx of seats) {
      if (keep.includes(idx)) slots.set(factionId, slots.get(factionId)! - 1);
      else unassigned.push(idx);
    }
    for (const idx of keep) players[idx]!.faction_id = factionId;
  }
  const left = shuffle(
    [...slots.entries()].flatMap(([factionId, n]) => Array.from({ length: n }, () => factionId)),
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
 * (not eight seats, or the seats are not two to a faction's world, or the map
 * is not the one the halves were authored for). Which of a world's two houses
 * takes which half is drawn by `rng`, unless `forceHalves` (player id → half)
 * says; the houses are listed in seat order.
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
  if ([...seatsByWorld.values()].some((seats) => seats.length !== 2)) return null;

  const rng = opts.rng ?? randomInt;
  const houseOf = new Map<number, GalaxySchismHouse>();
  // World order is fixed so a seeded rng deals the same halves every time.
  for (const world of [...seatsByWorld.keys()].sort()) {
    const [a, b] = seatsByWorld.get(world)!;
    const forced = opts.forceHalves?.[players[a!]!.player_id];
    const halfOfA: 0 | 1 = forced ?? (rng(0, 2) === 0 ? 0 : 1);
    const halfOfB: 0 | 1 = halfOfA === 0 ? 1 : 0;
    for (const [seat, half] of [[a!, halfOfA], [b!, halfOfB]] as const) {
      const reinforce = relations === 'allied'
        ? ALLIED_TUNING[world]?.reinforce ?? 0
        : halves[world]![half].reinforce_bonus ?? 0;
      houseOf.set(seat, {
        player_id: players[seat]!.player_id,
        world_id: world,
        half,
        name: halves[world]![half].house,
        ...(reinforce ? { reinforce_bonus: reinforce } : {}),
      });
    }
  }

  const gateways = gatewaysByWorld(map);
  const crownGateways: Record<string, string[]> = {};
  for (const world of [...GALAXY_HOME_WORLD_IDS].sort()) crownGateways[world] = gateways.get(world) ?? [];

  return {
    id: 'schism',
    relations,
    concord_rounds: relations === 'concord' ? SCHISM_TUNING.concordRounds : 0,
    lane_crown_bonus: relations === 'allied' ? 0 : SCHISM_TUNING.laneCrownBonus,
    houses: players.map((_, i) => houseOf.get(i)!),
    crown_gateways: crownGateways,
  };
}

/** The tiles a house opens on. */
export function schismHouseTiles(house: Pick<GalaxySchismHouse, 'world_id' | 'half'>): readonly string[] {
  return SCHISM_HALVES[house.world_id]?.[house.half].tiles ?? [];
}

/**
 * Extra units a house opens with on each of its tiles: its half's
 * `opening_bonus`, or its world's ALLIED_TUNING when the houses are Allied.
 */
export function schismOpeningBonus(
  house: Pick<GalaxySchismHouse, 'world_id' | 'half'>,
  relations: GalaxyHouseRelations = 'concord',
): number {
  if (relations === 'allied') return ALLIED_TUNING[house.world_id]?.opening ?? 0;
  return SCHISM_HALVES[house.world_id]?.[house.half].opening_bonus ?? 0;
}

/** This game's house for a player, if it is a Schism game. */
export function schismHouseOf(state: Pick<GameState, 'galaxy_mode'>, playerId: string): GalaxySchismHouse | null {
  const mode = state.galaxy_mode;
  if (mode?.id !== 'schism') return null;
  return mode.houses.find((h) => h.player_id === playerId) ?? null;
}

/** The other house on a player's home world. */
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

/** The house's own units a turn, as recorded when the board was dealt (0 off a Schism board). */
export function houseReinforceBonus(state: Pick<GameState, 'galaxy_mode'>, playerId: string): number {
  return schismHouseOf(state, playerId)?.reinforce_bonus ?? 0;
}

/** The Lane Crown's reinforcements for this player this turn (0 without it). */
export function laneCrownBonus(state: Pick<GameState, 'galaxy_mode' | 'territories'>, playerId: string): number {
  const mode = state.galaxy_mode;
  return mode?.id === 'schism' && holdsLaneCrown(state, playerId) ? mode.lane_crown_bonus : 0;
}
