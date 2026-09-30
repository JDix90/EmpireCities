// ============================================================
// The galaxy's lane ring — shared geometry
// ============================================================
//
// The authored lanes join the worlds in a ring, each lane landing on a gateway
// tile. Two things bridge the ring's gaps: a Lane Surge (laneWeather.ts) for two
// rounds, and the Colonies board mode (galaxyModes.ts) for the whole game. Both
// place the bridging lane the same way, from here, so a surge can tell when the
// board already keeps that gap open.

import { inferWorldId } from '@borderfall/shared';
import type { GameMap, MapConnection } from '../../types';

/** `source` of a lane the game's board mode adds (see galaxyModes.ts). */
export const GALAXY_MODE_LANE_SOURCE = 'galaxy_mode';

/** Authored lanes only: no Jump Gate, surge or board-mode lane. */
export function authoredLanes(map: GameMap): MapConnection[] {
  return map.connections.filter((c) => c.type === 'orbit' && !c.source);
}

/** Gateway tiles grouped by world, from the authored ring, each list sorted. */
export function gatewaysByWorld(map: GameMap): Map<string, string[]> {
  const byId = new Map(map.territories.map((t) => [t.territory_id, t]));
  const out = new Map<string, string[]>();
  for (const c of authoredLanes(map)) {
    for (const id of [c.from, c.to]) {
      const t = byId.get(id);
      if (!t) continue;
      const world = inferWorldId(t);
      const list = out.get(world) ?? [];
      if (!list.includes(id)) list.push(id);
      out.set(world, list);
    }
  }
  for (const list of out.values()) list.sort();
  return out;
}

/** World pairs the authored ring already joins, as `a::b` with a < b. */
export function neighbouringWorlds(map: GameMap): Set<string> {
  const byId = new Map(map.territories.map((t) => [t.territory_id, t]));
  const out = new Set<string>();
  for (const c of authoredLanes(map)) {
    const a = byId.get(c.from);
    const b = byId.get(c.to);
    if (!a || !b) continue;
    const wa = inferWorldId(a);
    const wb = inferWorldId(b);
    if (wa === wb) continue;
    out.add(wa < wb ? `${wa}::${wb}` : `${wb}::${wa}`);
  }
  return out;
}

/**
 * One lane for each pair of worlds the authored ring does not join, between the
 * first gateway (alphabetically) of each world: where a bridge across the gap
 * lands, so it lands where the lane infrastructure already is. In world order,
 * which is the order a Lane Surge tries them.
 */
export function ringGapLanes(map: GameMap): Array<{ from: string; to: string }> {
  const byWorld = gatewaysByWorld(map);
  const worlds = [...byWorld.keys()].sort();
  const joined = neighbouringWorlds(map);
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
