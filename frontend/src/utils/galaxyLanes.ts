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
import type { GameState } from '../store/gameStore';
import { getGalaxyWorldLore } from '../constants/galaxyLore';

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

/** Mirrors backend `laneStateFor`: which ends of the lane the player holds. */
export function laneStateFor(
  gameState: Pick<GameState, 'territories'>,
  fromId: string,
  toId: string,
  playerId: string | null | undefined,
): LaneState {
  if (!playerId) return 'closed';
  const a = gameState.territories[fromId]?.owner_id === playerId;
  const b = gameState.territories[toId]?.owner_id === playerId;
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

/** Mirrors backend `isLaneSealedForPlayer`: the sealer crosses their own seal. */
export function isLaneSealedForPlayer(
  gameState: Pick<GameState, 'lane_blockades'>,
  fromId: string,
  toId: string,
  playerId: string | null | undefined,
): boolean {
  const seal = laneSealFor(gameState, fromId, toId);
  return !!seal && seal.owner_id !== playerId;
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
 * other two are engine-added and behave differently — a Jump Gate lane carries
 * no attack, and a surge lane blows over after two rounds.
 */
export type LaneKind = 'authored' | 'jump_gate' | 'lane_surge';

export function laneKindOf(source: string | undefined): LaneKind {
  if (source === 'jump_gate') return 'jump_gate';
  if (source === 'lane_surge') return 'lane_surge';
  return 'authored';
}

/** Short label for a lane's kind, or null for an ordinary authored lane. */
export function describeLaneKind(kind: LaneKind): string | null {
  if (kind === 'jump_gate') return 'Jump Gate lane — your units only, no attacks';
  if (kind === 'lane_surge') return 'Lane Surge — a temporary lane, it blows over';
  return null;
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
// three turns running. Engine-added lanes (a Jump Gate, a Launch Pad — anything
// carrying `source`) never count, so a player cannot build their own win.
// Advisory, like everything else here: the streak itself comes from the server.

export const LANE_SOVEREIGNTY_CORRIDORS_NEEDED = 5;
export const LANE_SOVEREIGNTY_ROUNDS = 3;

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
  gameState: Pick<GameState, 'settings' | 'territories' | 'players'> | null | undefined,
  connections: Array<{ from: string; to: string; type?: string; source?: string }> | undefined,
  playerId: string | null | undefined,
): LaneSovereigntyProgress {
  const lanes = authoredOrbitLanes(connections ?? []);
  const needed = Math.min(LANE_SOVEREIGNTY_CORRIDORS_NEEDED, lanes.length);
  const allowed = gameState?.settings?.allowed_victory_conditions ?? [];
  const applicable = !!gameState && !!playerId && needed > 0 && allowed.includes('lane_sovereignty');
  if (!applicable) {
    return { applicable: false, held: 0, needed, streak: 0, roundsNeeded: LANE_SOVEREIGNTY_ROUNDS };
  }
  let held = 0;
  for (const lane of lanes) {
    if (
      gameState.territories[lane.from]?.owner_id === playerId
      && gameState.territories[lane.to]?.owner_id === playerId
    ) held += 1;
  }
  const player = gameState.players.find((p) => p.player_id === playerId);
  return {
    applicable: true,
    held,
    needed,
    streak: player?.lane_sovereignty_streak ?? 0,
    roundsNeeded: LANE_SOVEREIGNTY_ROUNDS,
  };
}
