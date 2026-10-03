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
 *   Seal Breaker    on a gateway of yours that carries a defence building.
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
}

const crossable = (c: LaneConnection): boolean => c.type === 'orbit' && c.source !== 'jump_gate';
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

/** Would the server accept this lane power on this tile (ignoring price and turn)? */
export function lanePowerApplies(abilityId: string, ctx: LanePowerContext): boolean {
  if (!isLanePowerId(abilityId)) return true;
  const here = ctx.territories[ctx.territoryId];
  if (!here) return false;
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
