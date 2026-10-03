/**
 * Galactic Age lane powers on the client (docs/GALACTIC_AGE_BUILDINGS.md §6).
 *
 * The server's gate (backend abilities/lanePowers.ts) decides; this restates
 * where each power CAN fire so the territory panel offers its button only on a
 * tile where the click would be accepted, instead of listing it everywhere and
 * letting the server refuse it.
 *
 *   Lance Battery   on a rival's tile across an open lane from a gateway of
 *                   yours that carries a defence building;
 *   Orbital Muster  on a gateway of yours that carries an industry building;
 *   Seal Breaker    on a gateway of yours that carries a defence building;
 *   Surge Projector on a rival's gateway at one end of a gap in the ring, when
 *                   you hold the gateway at the other end and a Jump Gate on
 *                   each of the gap's two worlds.
 */
import { GALAXY_LANE_POWER_COSTS } from '@borderfall/shared';

export type LanePowerId = keyof typeof GALAXY_LANE_POWER_COSTS;

export function isLanePowerId(abilityId: string): abilityId is LanePowerId {
  return Object.prototype.hasOwnProperty.call(GALAXY_LANE_POWER_COSTS, abilityId);
}

interface LaneConnection { from: string; to: string; type?: string; source?: string }
interface LaneTerritory { owner_id: string | null; buildings?: string[] }

export interface LanePowerContext {
  territoryId: string;
  myPlayerId: string;
  territories: Record<string, LaneTerritory>;
  connections: LaneConnection[];
  /** Territory id → world id, from the map (game state does not carry it). Surge Projector only. */
  worldOf?: Record<string, string>;
}

/** Jump Gate lanes carry no attack, and a projected surge carries one crossing only. */
const crossable = (c: LaneConnection): boolean =>
  c.type === 'orbit' && c.source !== 'jump_gate' && c.source !== 'surge_projector';
const has = (t: LaneTerritory | undefined, prefix: string): boolean =>
  (t?.buildings ?? []).some((b) => b.startsWith(prefix));

/** Lanes leaving `territoryId` that a power can reach across, as the far tile ids. */
function laneNeighbours(ctx: LanePowerContext, territoryId: string): string[] {
  const out: string[] = [];
  for (const c of ctx.connections) {
    if (!crossable(c)) continue;
    if (c.from === territoryId) out.push(c.to);
    else if (c.to === territoryId) out.push(c.from);
  }
  return out;
}

/**
 * The gaps in the authored ring: for each pair of worlds no authored lane joins,
 * the lane between each world's first gateway (alphabetically). Mirrors the
 * backend's `ringGapLanes` (state/galaxyRing.ts), which places a Lane Surge, a
 * Colonies lane and a Surge Projector the same way.
 */
export function ringGapLanes(connections: LaneConnection[], worldOf: Record<string, string>): Array<{ from: string; to: string }> {
  const authored = connections.filter((c) => c.type === 'orbit' && !c.source);
  const byWorld = new Map<string, string[]>();
  const joined = new Set<string>();
  for (const c of authored) {
    for (const id of [c.from, c.to]) {
      const world = worldOf[id];
      if (!world) continue;
      const list = byWorld.get(world) ?? [];
      if (!list.includes(id)) list.push(id);
      byWorld.set(world, list);
    }
    const wa = worldOf[c.from];
    const wb = worldOf[c.to];
    if (wa && wb && wa !== wb) joined.add(wa < wb ? `${wa}::${wb}` : `${wb}::${wa}`);
  }
  for (const list of byWorld.values()) list.sort();
  const worlds = [...byWorld.keys()].sort();
  const out: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < worlds.length; i++) {
    for (let j = i + 1; j < worlds.length; j++) {
      if (joined.has(`${worlds[i]}::${worlds[j]}`)) continue;
      const from = byWorld.get(worlds[i])?.[0];
      const to = byWorld.get(worlds[j])?.[0];
      if (from && to) out.push({ from, to });
    }
  }
  return out;
}

function surgeProjectorApplies(ctx: LanePowerContext): boolean {
  const target = ctx.territoryId;
  const here = ctx.territories[target];
  if (!here?.owner_id || here.owner_id === ctx.myPlayerId) return false;
  const worldOf = ctx.worldOf ?? {};
  const gateOn = (world: string | undefined): boolean => !!world && Object.entries(ctx.territories).some(
    ([id, t]) => t.owner_id === ctx.myPlayerId && (t.buildings ?? []).includes('jump_gate') && worldOf[id] === world,
  );
  return ringGapLanes(ctx.connections, worldOf).some((gap) => {
    const near = gap.from === target ? gap.to : gap.to === target ? gap.from : null;
    if (!near || ctx.territories[near]?.owner_id !== ctx.myPlayerId) return false;
    if (!gateOn(worldOf[near]) || !gateOn(worldOf[target])) return false;
    // A gap something already bridges needs no projector.
    return !ctx.connections.some((c) => (c.from === near && c.to === target) || (c.from === target && c.to === near));
  });
}

/** Would the server accept this lane power on this tile (ignoring price and turn)? */
export function lanePowerApplies(abilityId: string, ctx: LanePowerContext): boolean {
  if (!isLanePowerId(abilityId)) return true;
  const here = ctx.territories[ctx.territoryId];
  if (!here) return false;
  if (abilityId === 'surge_projector') return surgeProjectorApplies(ctx);
  if (abilityId === 'lance_battery') {
    if (!here.owner_id || here.owner_id === ctx.myPlayerId) return false;
    return laneNeighbours(ctx, ctx.territoryId).some((near) => {
      const t = ctx.territories[near];
      return t?.owner_id === ctx.myPlayerId && has(t, 'defense_');
    });
  }
  if (here.owner_id !== ctx.myPlayerId) return false;
  // Muster and Seal Breaker both fire from a gateway of yours.
  if (laneNeighbours(ctx, ctx.territoryId).length === 0) return false;
  if (abilityId === 'orbital_muster') return has(here, 'production_');
  return has(here, 'defense_');
}

/** The PP a lane power costs, for its button. */
export function lanePowerCost(abilityId: string): number | null {
  return isLanePowerId(abilityId) ? GALAXY_LANE_POWER_COSTS[abilityId] : null;
}
