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

import { inferWorldId, type WorldModifiers } from '@borderfall/shared';
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
  connections: Array<{ from: string; to: string; type?: string }>;
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

export interface GatewayLane {
  /** The gateway on this side (the territory asked about). */
  nearId: string;
  /** The gateway at the other end of the lane. */
  farId: string;
  farName: string;
  farWorldId: string;
  farWorldName: string;
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
