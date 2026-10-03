/**
 * Galactic Age corridors — client mirror of the lane rules.
 *
 * Advisory only: the backend (`game-engine/state/moonAccess.ts`) decides every
 * crossing. This module exists so the chart, the globe, the territory panel and
 * the bonuses screen all describe a lane the same way: which of the viewer's
 * gateways it touches (its *state*), whether an Emergency Seal is on it, and how
 * many dice an attack across it rolls. Keep the rules in step with the backend:
 *
 *   - corridor: the player holds both gateways — the lane is theirs to move along.
 *   - open:     the player holds one gateway — they can attack across it.
 *   - closed:   the player holds neither — nothing to do here until they take a gateway.
 *   - sealed:   an Emergency Seal (Void Custodians) closes it to everyone but the sealer
 *               until the sealer's next turn.
 *   - dice:     crossings roll 2 attacker dice, 3 with Lane Charts; the Hyperlane
 *               Anchor lifts the cap for its owner. Same-world attacks are untouched.
 */

import { inferWorldId, type WorldModifiers, type WorldRules } from '@borderfall/shared';
import type { GalaxySchismHouse, GalaxySchismWholeWorld, GameState } from '../store/gameStore';
import { getGalaxyWorldLore } from '../constants/galaxyLore';
import { areAllies, isFriendlyOwner } from './teams';

export type LaneState = 'corridor' | 'open' | 'closed';

/** Canonical, order-independent lane id — must match the backend `orbitLaneId`. */
export function orbitLaneId(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export const GALAXY_LANE_BASE_ATTACK_DICE = 2;
export const LANE_CHARTS_TECH_ID = 'ga_hyperspace_chart';
export const HYPERLANE_ANCHOR_WONDER_ID = 'wonder_hyperlane_anchor';
export const EMERGENCY_SEAL_ABILITY_ID = 'emergency_seal';
export const EMERGENCY_SEAL_WORLD_ID = 'nexus_station';

export interface LaneSeal {
  owner_id: string;
  turns_remaining: number;
}

interface LaneMapTerritory {
  territory_id: string;
  region_id: string;
  world_id?: string;
  globe_id?: string;
  name?: string;
}

interface LaneMapData {
  map_kind?: 'standard' | 'galaxy';
  territories: LaneMapTerritory[];
  /** `type` is loose so the panel's `MapConnection` (type?: string) fits without a cast. */
  connections: Array<{ from: string; to: string; type?: string; source?: string }>;
  worlds?: Array<{ world_id: string; display_name?: string }>;
}

/**
 * Mirrors backend `laneStateFor`: which ends of the lane the player holds. In a
 * team game an ally's gateway counts as the player's (utils/teams).
 */
export function laneStateFor(
  gameState: Pick<GameState, 'territories'> & Partial<Pick<GameState, 'teams'>>,
  fromId: string,
  toId: string,
  playerId: string | null | undefined,
): LaneState {
  if (!playerId) return 'closed';
  const a = isFriendlyOwner(gameState, playerId, gameState.territories[fromId]?.owner_id);
  const b = isFriendlyOwner(gameState, playerId, gameState.territories[toId]?.owner_id);
  if (a && b) return 'corridor';
  if (a || b) return 'open';
  return 'closed';
}

/** The active Emergency Seal on a lane, or null when unsealed / expired. */
export function laneSealFor(
  gameState: Pick<GameState, 'lane_blockades'>,
  fromId: string,
  toId: string,
): LaneSeal | null {
  const seal = gameState.lane_blockades?.[orbitLaneId(fromId, toId)];
  return seal && seal.turns_remaining > 0 ? seal : null;
}

/** Mirrors backend `isLaneSealedForPlayer`: the sealer, and the sealer's allies, cross their own seal. */
export function isLaneSealedForPlayer(
  gameState: Pick<GameState, 'lane_blockades'> & Partial<Pick<GameState, 'teams'>>,
  fromId: string,
  toId: string,
  playerId: string | null | undefined,
): boolean {
  const seal = laneSealFor(gameState, fromId, toId);
  return !!seal && seal.owner_id !== playerId && !areAllies(gameState, playerId, seal.owner_id);
}

/**
 * Mirrors backend `galaxyLaneAttackDiceCap`: attacker dice across a lane, or
 * undefined when no cap applies (corridors off, or the Hyperlane Anchor owner).
 */
export function laneAttackDiceCap(
  gameState: Pick<GameState, 'settings' | 'players' | 'territories'>,
  playerId: string | null | undefined,
): number | undefined {
  if (!gameState.settings?.galaxy_corridors_enabled || !playerId) return undefined;
  const ownsAnchor = Object.values(gameState.territories).some(
    (t) => t.owner_id === playerId && (t.buildings?.includes(HYPERLANE_ANCHOR_WONDER_ID) ?? false),
  );
  if (ownsAnchor) return undefined;
  const player = gameState.players.find((p) => p.player_id === playerId);
  const hasLaneCharts = !!gameState.settings.tech_trees_enabled
    && (player?.unlocked_techs?.includes(LANE_CHARTS_TECH_ID) ?? false);
  return GALAXY_LANE_BASE_ATTACK_DICE + (hasLaneCharts ? 1 : 0);
}

/**
 * What opened this lane. Authored lanes are the ring the era is fought over; the
 * others are engine-added and behave differently — a Jump Gate lane carries no
 * attack, a surge lane blows over after two rounds, and a colony lane (three
 * seats on the Colonies board) stays all game but is not one of the eight lanes
 * Lane Sovereignty counts. A Surge Projector lane (a lane power) carries its
 * opener's one crossing for one attack phase.
 */
export type LaneKind = 'authored' | 'jump_gate' | 'lane_surge' | 'colony' | 'surge_projector';

export function laneKindOf(source: string | undefined): LaneKind {
  if (source === 'jump_gate') return 'jump_gate';
  if (source === 'lane_surge') return 'lane_surge';
  if (source === 'surge_projector') return 'surge_projector';
  if (source === 'galaxy_mode') return 'colony';
  return 'authored';
}

/** Short label for a lane's kind, or null for an ordinary authored lane. */
export function describeLaneKind(kind: LaneKind): string | null {
  if (kind === 'jump_gate') return 'Jump Gate lane — your units only, no attacks';
  if (kind === 'lane_surge') return 'Lane Surge — a temporary lane, it blows over';
  if (kind === 'surge_projector') return 'Surge Projector — one crossing, this attack phase only';
  if (kind === 'colony') return 'Colony lane — open all game; Lane Sovereignty counts only the eight charted lanes';
  return null;
}

/** The reinforcement fields of a faction, as the era's factions endpoint sends them. */
export interface FactionReinforceKit {
  faction_id: string;
  name: string;
  reinforce_bonus?: number;
  /** Colonies board only: the bonus at a seat count, keyed by seats (JSON keys are strings). */
  colony_reinforce_bonus?: Record<string, number>;
}

/**
 * A faction's flat reinforcement bonus in this game. Mirrors backend
 * `factionReinforceBonus`: the kit's, unless the Colonies board sets another for
 * this seat count.
 */
export function factionReinforceBonus(
  gameState: Pick<GameState, 'galaxy_mode' | 'players'> | null | undefined,
  faction: Pick<FactionReinforceKit, 'reinforce_bonus' | 'colony_reinforce_bonus'>,
): number {
  const kit = faction.reinforce_bonus ?? 0;
  if (gameState?.galaxy_mode?.id !== 'colonies') return kit;
  return faction.colony_reinforce_bonus?.[String(gameState.players.length)] ?? kit;
}

/** The start briefing's lines for seated kits this Colonies board changes. */
export function describeColonyKitChanges(
  gameState: Pick<GameState, 'galaxy_mode' | 'players'> | null | undefined,
  factions: FactionReinforceKit[],
): string[] {
  if (gameState?.galaxy_mode?.id !== 'colonies') return [];
  const seated = new Set(gameState.players.map((p) => p.faction_id).filter(Boolean));
  return factions.flatMap((f) => {
    if (!seated.has(f.faction_id)) return [];
    const kit = f.reinforce_bonus ?? 0;
    const here = factionReinforceBonus(gameState, f);
    return here === kit ? [] : [`The ${f.name} draft +${here} a turn in this game, not +${kit}.`];
  });
}

/**
 * The start briefing's line for a Colonies board, or null for the classic
 * start. Mirrors `state.galaxy_mode` (backend state/galaxyModes.ts).
 */
export function describeColonies(
  mode: GameState['galaxy_mode'],
  mapData?: LaneMapData | null,
): string | null {
  if (mode?.id !== 'colonies' || mode.neutral_worlds.length === 0) return null;
  const names = mode.neutral_worlds.map((w) => worldDisplayName(mapData, w));
  const worlds = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? 'starts' : 'start';
  const prize = names.length === 1 ? 'a colony for whoever takes it' : 'colonies for whoever takes them';
  const lanes = (mode.lanes?.length ?? 0) > 0 ? ' Two extra lanes link every world to every other.' : '';
  return `${worlds} ${verb} neutral and garrisoned — ${prize}.${lanes}`;
}

/** This game's house for a player, if it is a Schism game. Mirrors backend `schismHouseOf`. */
export function schismHouseOf(
  gameState: Pick<GameState, 'galaxy_mode'> | null | undefined,
  playerId: string | null | undefined,
): GalaxySchismHouse | null {
  const mode = gameState?.galaxy_mode;
  if (mode?.id !== 'schism' || !playerId) return null;
  return mode.houses.find((h) => h.player_id === playerId) ?? null;
}

/** An Allied Partial Schism seat that holds its whole world alone, if this player is one. Mirrors backend `schismWholeWorldOf`. */
export function schismWholeWorldOf(
  gameState: Pick<GameState, 'galaxy_mode'> | null | undefined,
  playerId: string | null | undefined,
): GalaxySchismWholeWorld | null {
  const mode = gameState?.galaxy_mode;
  if (mode?.id !== 'schism' || !playerId) return null;
  return mode.whole_worlds?.find((w) => w.player_id === playerId) ?? null;
}

/** The other house on a player's home world (none for a house alone on it). Mirrors backend `schismRivalOf`. */
export function schismRivalOf(
  gameState: Pick<GameState, 'galaxy_mode'> | null | undefined,
  playerId: string | null | undefined,
): GalaxySchismHouse | null {
  const mode = gameState?.galaxy_mode;
  const mine = schismHouseOf(gameState, playerId);
  if (mode?.id !== 'schism' || !mine) return null;
  return mode.houses.find((h) => h.world_id === mine.world_id && h.player_id !== mine.player_id) ?? null;
}

/**
 * True while a player holds every gateway of their house's home world: the
 * Lane Crown. Mirrors backend `holdsLaneCrown`.
 */
export function holdsLaneCrown(
  gameState: Pick<GameState, 'galaxy_mode' | 'territories'> | null | undefined,
  playerId: string | null | undefined,
): boolean {
  const mode = gameState?.galaxy_mode;
  const house = schismHouseOf(gameState, playerId);
  if (mode?.id !== 'schism' || !house || !gameState) return false;
  const gateways = mode.crown_gateways[house.world_id] ?? [];
  return gateways.length > 0 && gateways.every((id) => gameState.territories[id]?.owner_id === playerId);
}

/**
 * A house's own reinforcement bonus in words: "the Western Mandate drafts +3 a
 * turn on top of the kit", or "… drafts 1 fewer a turn than the kit".
 */
export function describeHouseBonus(houseName: string, bonus: number): string {
  return bonus >= 0
    ? `the ${houseName} drafts +${bonus} a turn on top of the kit`
    : `the ${houseName} drafts ${-bonus} fewer a turn than the kit`;
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The start briefing's lines for a Schism board, from the viewer's seat (a
 * spectator gets the board in general). Empty for any other board.
 */
export function describeSchism(
  gameState: Pick<GameState, 'galaxy_mode' | 'players'> | null | undefined,
  viewerId: string | null | undefined,
  mapData?: LaneMapData | null,
): string[] {
  const mode = gameState?.galaxy_mode;
  if (mode?.id !== 'schism' || !gameState) return [];
  const rounds = mode.concord_rounds;
  const roundsText = `${rounds} round${rounds === 1 ? '' : 's'}`;
  const house = schismHouseOf(gameState, viewerId);
  const rival = schismRivalOf(gameState, viewerId);
  const whole = schismWholeWorldOf(gameState, viewerId);
  const crown = `+${mode.lane_crown_bonus} reinforcement${mode.lane_crown_bonus === 1 ? '' : 's'} a turn`;
  const allied = mode.relations === 'allied';

  // The Partial Schism (five to seven seats): only some worlds are shared.
  const housesOn = new Map<string, number>();
  for (const h of mode.houses) housesOn.set(h.world_id, (housesOn.get(h.world_id) ?? 0) + 1);
  const shared = [...housesOn.entries()].filter(([, n]) => n === 2).map(([w]) => w);
  const partial = (mode.whole_worlds?.length ?? 0) > 0 || [...housesOn.values()].some((n) => n === 1);
  if (partial) {
    const sharedNames = listNames(shared.map((w) => worldDisplayName(mapData, w)));
    const are = shared.length === 1 ? 'is' : 'are';
    const garrison = mode.unclaimed_garrison
      ? `${mode.unclaimed_garrison.gateway} units on each gateway and ${mode.unclaimed_garrison.interior} inland`
      : 'a garrison';
    const relationsLine = allied
      ? 'Allied: every world is one side — its two houses, or the one player holding it.'
      : mode.relations === 'concord' && rounds > 0
        ? `The Concord: the two houses on ${sharedNames} start under a truce for the first ${roundsText}.`
        : `Civil War: the two houses on ${sharedNames} are enemies from the first turn.`;
    if (whole) {
      const n = whole.reinforce_bonus ?? 0;
      return [
        `You hold all of ${worldDisplayName(mapData, whole.world_id)}, a side of your own. ${sharedNames} ${are} shared by two Allied houses, a side together.`,
        ...(n === 0 ? [] : [n > 0
          ? `Alone against sides of two, you draft +${n} a turn on top of the kit.`
          : `Alone against sides of two, you draft ${-n} fewer a turn than the kit.`]),
      ];
    }
    if (house && !rival) {
      const world = worldDisplayName(mapData, house.world_id);
      const n = house.reinforce_bonus ?? 0;
      return [
        `You are the ${house.name}, alone on ${world}: its other half starts unclaimed, with ${garrison}. Take it and the world is yours.`,
        ...(n === 0 ? [] : [`Your half is the ${n > 0 ? 'harder' : 'richer'} ground: ${describeHouseBonus(house.name, n)}.`]),
        `${sharedNames} ${are} shared by two rival houses. ${relationsLine}`,
        `The Lane Crown: hold all four of ${world}'s gateways, your two and the unclaimed half's, and you draft ${crown}.`,
      ];
    }
    if (!house) {
      return [
        allied
          ? `${sharedNames} ${are} shared by two houses, who split the world and share its kit; every other world is held whole by one player.`
          : `${sharedNames} ${are} shared by two houses, who split the world and share its kit. Every other world has one house on half of it: the other half starts unclaimed, with ${garrison}.`,
        relationsLine,
        ...(allied ? [] : [`The Lane Crown: a house that holds all four of its world's gateways drafts ${crown}.`]),
      ];
    }
  }

  if (!house || !rival) {
    return [
      'Eight houses, two to every world: each faction is dealt to two players, who split its home world and share its kit.',
      allied
        ? "Allied: each world's two houses are one side."
        : mode.relations === 'concord' && rounds > 0
          ? `The Concord: each world's two houses start under a truce for the first ${roundsText}.`
          : 'Civil War: the two houses on every world are enemies from the first turn.',
      ...(allied ? [] : [`The Lane Crown: a house that holds all four of its world's gateways drafts ${crown}.`]),
    ];
  }
  const world = worldDisplayName(mapData, house.world_id);
  const rivalName = gameState.players.find((p) => p.player_id === rival.player_id)?.username ?? 'your rival';
  const bonusLines = ([['Your', house], ['Their', rival]] as const).flatMap(([whose, h]) => {
    const n = h.reinforce_bonus ?? 0;
    if (n === 0) return [];
    return [`${whose} half is the ${n > 0 ? 'harder' : 'richer'} ground: ${describeHouseBonus(h.name, n)}.`];
  });
  return [
    `You are the ${house.name}. The ${rival.name} (${rivalName}) holds the rest of ${world}, with the same kit.`,
    ...bonusLines,
    allied
      ? `Allied: the ${rival.name} is your ally, not your rival.`
      : mode.relations === 'concord' && rounds > 0
        ? `The Concord: you and the ${rival.name} are under a truce for the first ${roundsText}. Attacking them before it ends breaks it: they defend that attack with an extra die, and get an extra die for their next attack on you.`
        : `Civil War: the ${rival.name} is your enemy from the first turn.`,
    ...(allied ? [] : [`The Lane Crown: hold all four of ${world}'s gateways, your two and theirs, and you draft ${crown}.`]),
  ];
}

export interface GatewayLane {
  /** The gateway on this side (the territory asked about). */
  nearId: string;
  /** The gateway at the other end of the lane. */
  farId: string;
  farName: string;
  farWorldId: string;
  farWorldName: string;
  kind: LaneKind;
}

/** Every hyperspace lane leaving `territoryId` (empty for non-gateway tiles). */
export function gatewayLanesFor(mapData: LaneMapData | null | undefined, territoryId: string): GatewayLane[] {
  if (!mapData) return [];
  const byId = new Map(mapData.territories.map((t) => [t.territory_id, t]));
  const near = byId.get(territoryId);
  if (!near) return [];
  const nearWorld = inferWorldId(near);
  const out: GatewayLane[] = [];
  for (const c of mapData.connections) {
    if (c.type !== 'orbit') continue;
    const farId = c.from === territoryId ? c.to : c.to === territoryId ? c.from : null;
    if (!farId) continue;
    const far = byId.get(farId);
    if (!far) continue;
    const farWorldId = inferWorldId(far);
    if (farWorldId === nearWorld) continue;
    out.push({
      nearId: territoryId,
      farId,
      farName: far.name ?? farId,
      farWorldId,
      farWorldName: worldDisplayName(mapData, farWorldId),
      kind: laneKindOf(c.source),
    });
  }
  return out;
}

/** Ids of every territory that anchors a cross-world lane. */
export function gatewayTerritoryIds(mapData: LaneMapData | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!mapData) return out;
  const byId = new Map(mapData.territories.map((t) => [t.territory_id, t]));
  for (const c of mapData.connections) {
    if (c.type !== 'orbit') continue;
    const a = byId.get(c.from);
    const b = byId.get(c.to);
    if (!a || !b || inferWorldId(a) === inferWorldId(b)) continue;
    out.add(c.from);
    out.add(c.to);
  }
  return out;
}

/**
 * The worlds a player can actually go to right now: the manifest entries that
 * have at least one territory on the board, in manifest order, plus any world a
 * territory infers that the manifest never declared.
 *
 * `mapData.worlds` is the authored manifest and lists every world the board will
 * EVER have. On a growth board (Space to Stars) the far worlds are held out
 * behind `unlock_era_index` and projected off the emitted map until somebody
 * reaches the Galactic Age — but the manifest still names them, so a switcher
 * built straight from it offers three tabs that open an empty globe. Deriving
 * the list from the territories in hand means the tab appears on the turn the
 * world does, which is also the reveal.
 */
export function worldsInPlay(
  mapData: LaneMapData | null | undefined,
): Array<{ world_id: string; display_name: string }> {
  if (!mapData) return [];
  const present = new Set(mapData.territories.map((t) => inferWorldId(t)));
  const out: Array<{ world_id: string; display_name: string }> = [];
  const seen = new Set<string>();
  for (const w of mapData.worlds ?? []) {
    if (!present.has(w.world_id) || seen.has(w.world_id)) continue;
    seen.add(w.world_id);
    out.push({ world_id: w.world_id, display_name: worldDisplayName(mapData, w.world_id) });
  }
  for (const wid of present) {
    if (seen.has(wid)) continue;
    seen.add(wid);
    out.push({ world_id: wid, display_name: worldDisplayName(mapData, wid) });
  }
  return out;
}

/** The map's authored world name, else the lore name, else the id. */
export function worldDisplayName(mapData: LaneMapData | null | undefined, worldId: string): string {
  const authored = mapData?.worlds?.find((w) => w.world_id === worldId)?.display_name;
  if (authored) return authored;
  return getGalaxyWorldLore(worldId)?.display_name ?? worldId;
}

/** Mirrors backend `canSealLane` minus the faction check the caller makes. */
export function laneTouchesSealWorld(mapData: LaneMapData | null | undefined, fromId: string, toId: string): boolean {
  if (!mapData) return false;
  return [fromId, toId].some((id) => {
    const t = mapData.territories.find((tt) => tt.territory_id === id);
    return !!t && inferWorldId(t) === EMERGENCY_SEAL_WORLD_ID;
  });
}

/** Plain-words description of one lane's state for the viewer. */
export function describeLaneState(state: LaneState): string {
  switch (state) {
    case 'corridor': return 'Corridor — you hold both gateways';
    case 'open': return 'Open — you hold this end';
    default: return 'Closed — you hold neither gateway';
  }
}

export function describeLaneSeal(
  seal: LaneSeal | null,
  playerName: (playerId: string) => string,
  viewerId?: string | null,
): string | null {
  if (!seal) return null;
  const who = seal.owner_id === viewerId ? 'you' : playerName(seal.owner_id);
  const rounds = seal.turns_remaining === 1 ? '1 round' : `${seal.turns_remaining} rounds`;
  return `Sealed by ${who} · ${rounds} left`;
}

/** "roll 2 dice (3 with Lane Charts)" style note for the viewer's crossings, or null when uncapped. */
export function describeLaneDice(cap: number | undefined): string | null {
  if (cap == null) return null;
  return cap <= GALAXY_LANE_BASE_ATTACK_DICE
    ? `Lane attacks roll ${cap} dice (3 with Lane Charts)`
    : `Lane attacks roll ${cap} dice`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/**
 * A world's economic modifiers in words a player can act on. The income values
 * are per system held and floor per turn, which is why the copy says "per
 * system" rather than promising a whole point.
 */
export function describeWorldModifiers(mods: WorldModifiers | undefined | null): string[] {
  if (!mods) return [];
  const out: string[] = [];
  if (mods.production_bonus) out.push(`+${fmtNum(mods.production_bonus)} production per system you hold`);
  if (mods.tech_bonus) out.push(`+${fmtNum(mods.tech_bonus)} tech per system you hold`);
  if (mods.stability_bonus) out.push(`+${fmtNum(mods.stability_bonus)} stability recovery per system you hold`);
  if (mods.build_cost_mult != null && mods.build_cost_mult !== 1) {
    const pct = Math.round(Math.abs(1 - mods.build_cost_mult) * 100);
    out.push(mods.build_cost_mult < 1 ? `Buildings cost ${pct}% less` : `Buildings cost ${pct}% more`);
  }
  return out;
}

/** "nexus_gate_ring" → "Nexus Gate Ring", for maps that carry no region names here. */
export function prettyRegionId(regionId: string): string {
  return regionId.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * A world's rule(s) in words a player can act on. One line per rule; the copy
 * names the decision the rule changes (where to stack, what to build, what to
 * take), which is the point of a rule over a modifier.
 */
export function describeWorldRules(
  rules: WorldRules | undefined | null,
  regionName: (regionId: string) => string = prettyRegionId,
): string[] {
  if (!rules) return [];
  const out: string[] = [];
  if (rules.muster_threshold != null) {
    const n = rules.muster_units ?? 1;
    const when = rules.muster_every && rules.muster_every > 1 ? `every ${ordinal(rules.muster_every)} round` : 'every round';
    out.push(`Cradle: ${when}, any system held here with fewer than ${rules.muster_threshold} units musters ${n} more`);
  }
  if (rules.deploy_cap_bonus) {
    out.push(`Cradle: place up to ${rules.deploy_cap_bonus} more units per system each draft, even at low stability`);
  }
  if (rules.population_growth_mult && rules.population_growth_mult !== 1) {
    out.push(`Population grows ${fmtNum(rules.population_growth_mult)}× as fast`);
  }
  if (rules.storm_threshold != null) {
    const lost = rules.storm_attrition ?? 1;
    out.push(`Storms: at round start any system above ${rules.storm_threshold} units loses ${lost} to the weather`);
  }
  if (rules.defense_building_bonus_dice) {
    out.push(`Forge: a system with a defence building rolls +${rules.defense_building_bonus_dice} extra defence die`);
  }
  if (rules.vault) {
    const v = rules.vault;
    out.push(
      `The Vault: ${regionName(v.region_id)} starts neutral (garrison ${v.neutral_garrison}); hold all of it for +${v.tech_income} tech per turn`
      + (v.emergency_seal ? ' and one Emergency Seal per turn on any lane' : ''),
    );
    if (v.home_unit_bonus) {
      out.push(`Its home faction starts with +${v.home_unit_bonus} unit per system, paying for the ring it begins without`);
    }
  }
  return out;
}

export interface VaultView {
  world_id: string;
  region_id: string;
  /** Player holding EVERY tile of the region, else null. */
  holder_id: string | null;
  tiles: number;
  /** Tiles the viewer holds (0 without a viewer). */
  viewer_held: number;
  tech_income: number;
  emergency_seal: boolean;
}

/**
 * Every vault in the game and who holds it — the client mirror of the
 * backend's `vaultStatuses`. Region and world come from the map territories,
 * because the client territory state carries neither.
 */
export function vaultViews(
  gameState: Pick<GameState, 'settings' | 'territories'>,
  mapTerritories: LaneMapTerritory[],
  viewerId?: string | null,
): VaultView[] {
  const rules = gameState.settings?.world_rules;
  if (!rules) return [];
  const out: VaultView[] = [];
  for (const [worldId, r] of Object.entries(rules)) {
    const v = r.vault;
    if (!v) continue;
    const owners = new Set<string | null>();
    let tiles = 0;
    let viewerHeld = 0;
    for (const t of mapTerritories) {
      if (inferWorldId(t) !== worldId || t.region_id !== v.region_id) continue;
      tiles += 1;
      const owner = gameState.territories[t.territory_id]?.owner_id ?? null;
      owners.add(owner);
      if (viewerId && owner === viewerId) viewerHeld += 1;
    }
    out.push({
      world_id: worldId,
      region_id: v.region_id,
      holder_id: tiles > 0 && owners.size === 1 ? [...owners][0] ?? null : null,
      tiles,
      viewer_held: viewerHeld,
      tech_income: v.tech_income,
      emergency_seal: v.emergency_seal === true,
    });
  }
  return out;
}

/** True when the viewer holds a vault that grants an Emergency Seal on any lane. */
export function viewerHoldsVaultSeal(
  gameState: Pick<GameState, 'settings' | 'territories'>,
  mapTerritories: LaneMapTerritory[],
  viewerId: string | null | undefined,
): boolean {
  if (!viewerId) return false;
  return vaultViews(gameState, mapTerritories, viewerId).some((v) => v.emergency_seal && v.holder_id === viewerId);
}

// ── Lane Sovereignty ──────────────────────────────────────────────────────
// Client mirror of `backend/src/game-engine/victory/laneSovereignty.ts`: hold
// both gateways of five of the eight AUTHORED lanes at the start of your turn,
// three turns running — five in a two-player game. Engine-added lanes (a Jump
// Gate, a Launch Pad, a colony lane — anything carrying `source`) never count,
// so a player cannot build their own win. Advisory, like everything else here:
// the streak itself comes from the server.

export const LANE_SOVEREIGNTY_CORRIDORS_NEEDED = 5;
export const LANE_SOVEREIGNTY_ROUNDS = 3;
/** Mirrors backend LANE_SOVEREIGNTY_ROUNDS_BY_SEATS: one rival breaks a streak on fewer turns. */
export const LANE_SOVEREIGNTY_ROUNDS_BY_SEATS: Record<number, number> = { 2: 5, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3 };
/** Mirrors backend LANE_SOVEREIGNTY_ROUNDS_BY_SIDES: a team game counts its sides instead. */
export const LANE_SOVEREIGNTY_ROUNDS_BY_SIDES: Record<number, number> = { 2: 5, 4: 3 };

/** Rounds a streak must run in a game with this many seats. */
export function laneSovereigntyRoundsFor(seats: number): number {
  return LANE_SOVEREIGNTY_ROUNDS_BY_SEATS[seats] ?? LANE_SOVEREIGNTY_ROUNDS;
}

/** Rounds a streak must run in this game: by its sides in a team game, else by its seats. */
export function laneSovereigntyRoundsForGame(
  gameState: Partial<Pick<GameState, 'players' | 'teams'>> | null | undefined,
): number {
  const sides = gameState?.teams?.length ?? 0;
  if (sides > 0) return LANE_SOVEREIGNTY_ROUNDS_BY_SIDES[sides] ?? LANE_SOVEREIGNTY_ROUNDS;
  return laneSovereigntyRoundsFor(gameState?.players?.length ?? 0);
}

/** Authored orbit lanes — the board sovereignty is played on. */
export function authoredOrbitLanes(
  connections: Array<{ from: string; to: string; type?: string; source?: string }>,
): Array<{ from: string; to: string }> {
  return connections.filter((c) => c.type === 'orbit' && !c.source).map((c) => ({ from: c.from, to: c.to }));
}

export interface LaneSovereigntyProgress {
  /** False when the condition is not in play, or the map has no authored lanes. */
  applicable: boolean;
  held: number;
  needed: number;
  streak: number;
  roundsNeeded: number;
}

export function laneSovereigntyProgress(
  gameState: (Pick<GameState, 'settings' | 'territories' | 'players'> & Partial<Pick<GameState, 'teams'>>) | null | undefined,
  connections: Array<{ from: string; to: string; type?: string; source?: string }> | undefined,
  playerId: string | null | undefined,
): LaneSovereigntyProgress {
  const lanes = authoredOrbitLanes(connections ?? []);
  const needed = Math.min(LANE_SOVEREIGNTY_CORRIDORS_NEEDED, lanes.length);
  const roundsNeeded = laneSovereigntyRoundsForGame(gameState);
  const allowed = gameState?.settings?.allowed_victory_conditions ?? [];
  const applicable = !!gameState && !!playerId && needed > 0 && allowed.includes('lane_sovereignty');
  if (!applicable) {
    return { applicable: false, held: 0, needed, streak: 0, roundsNeeded };
  }
  // A side holds its corridors together: an ally's gateway counts as yours.
  let held = 0;
  for (const lane of lanes) {
    if (
      isFriendlyOwner(gameState, playerId, gameState.territories[lane.from]?.owner_id)
      && isFriendlyOwner(gameState, playerId, gameState.territories[lane.to]?.owner_id)
    ) held += 1;
  }
  const player = gameState.players.find((p) => p.player_id === playerId);
  return {
    applicable: true,
    held,
    needed,
    streak: player?.lane_sovereignty_streak ?? 0,
    roundsNeeded,
  };
}

// ── Transit ───────────────────────────────────────────────────────────────
// Convoys are public commitments: the units have left their garrison and are in
// the void until the mover's next turn. Mirrors backend `state/transit.ts`.

export interface ConvoyView {
  id: string;
  owner_id: string;
  from: string;
  to: string;
  units: number;
  turns_remaining: number;
}

export function convoysFor(
  gameState: Pick<GameState, 'settings' | 'transits'> | null | undefined,
  opts?: { ownerId?: string | null; touching?: string },
): ConvoyView[] {
  if (!gameState?.settings?.galaxy_transit_enabled) return [];
  return (gameState.transits ?? []).filter(
    (c) =>
      (!opts?.ownerId || c.owner_id === opts.ownerId)
      && (!opts?.touching || c.from === opts.touching || c.to === opts.touching),
  );
}

/** "6 units arrive next turn" — the line a territory panel shows for an inbound convoy. */
export function describeConvoy(convoy: ConvoyView, territoryName: (id: string) => string): string {
  const units = `${convoy.units} unit${convoy.units === 1 ? '' : 's'}`;
  const when = convoy.turns_remaining <= 1 ? 'next turn' : `in ${convoy.turns_remaining} turns`;
  return `${units} from ${territoryName(convoy.from)} arrive ${when}`;
}
