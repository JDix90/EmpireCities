import { isCoastal } from './coast';
import { toIntFloor } from './fixed';
import {
  BuildingKind,
  LIGHTHOUSE_REVEAL_HOPS,
  PORT_REVEAL_HOPS,
  SCOUT_REVEAL_HOPS,
  UnitKind,
} from './rules';
import type { BuildingStore } from './buildings';
import type { Convoy, ConvoyStore } from './convoys';
import type { EntityStore } from './entities';
import type { ProvinceGeography } from './tribes';
import type { TerrainGrid } from './terrain';

/**
 * Rule V's second half: a convoy is hidden, and this is the list of things that see one.
 *
 * The brief's rule is three sentences — "nothing sees a convoy by default; a lighthouse
 * reveals lanes within one province, a port reveals its own lanes, a scout on a beach
 * reveals that beach's lane" — and the shape they imply is not a fog of war. It is a
 * WATCH LIST over the lane graph: each seat watches a set of lanes, and a crossing on a
 * lane nobody of yours watches is a crossing you never knew happened until it landed.
 *
 * Doing it over lanes rather than over cells is what keeps it honest and cheap. A convoy
 * is deliberately not on the grid at all (see convoys.ts) — it has no position to be
 * within sight of — so any cell-shaped vision would have had to invent one, and inventing
 * a position for a thing the rules say is unreachable is how "cannot be attacked" quietly
 * becomes "can be shot at from the shore".
 *
 * This is the first vision in the simulation. Everything else is public: ownership is
 * public by decision 26, and every unit and building is visible to everyone because fog
 * does not exist yet. So the honest description of this module is narrow — it decides who
 * sees SHIPPING, and nothing else.
 */

export interface RevealContext {
  entities: EntityStore;
  buildings: BuildingStore;
  grid: TerrainGrid;
  geography: ProvinceGeography;
  /** Provinces this one has a sea lane to. The sim's own lane graph, handed in. */
  lanesFrom(province: number): number[];
}

/**
 * A lane as one stable number, lower province first.
 *
 * A lane has no identity in the map data — it is a pair — and a watch list needs to
 * answer "is this crossing on a lane I watch" without caring which end asked. Packing
 * rather than a string because this is compared thousands of times a match and the
 * package's integer-only rule makes the arithmetic exact and the same on every machine.
 */
export function laneKey(a: number, b: number): number {
  return a < b ? a * LANE_KEY_STRIDE + b : b * LANE_KEY_STRIDE + a;
}

// Comfortably past any province count a map will carry: the western twenty has 24 and the
// full Roman map a few hundred. Two of these still fit exactly in a double.
const LANE_KEY_STRIDE = 4096;

/**
 * Provinces reachable from this one in at most `hops` steps over LAND.
 *
 * Land and not lanes, deliberately. "Within one province" means the next province along
 * the coast, not the far side of a crossing — a light on the Kentish shore watches Kent
 * and its neighbours, and does not see what Britannia's own harbours see. It also means
 * an island, which by construction has no land neighbours, watches only itself however
 * tall its lighthouse: the sea is what a hop cannot cross.
 */
export function withinHops(geography: ProvinceGeography, province: number, hops: number): number[] {
  const seen = new Set<number>([province]);
  let frontier = [province];
  for (let step = 0; step < hops; step++) {
    const next: number[] = [];
    for (const current of frontier) {
      for (const neighbour of geography.neighbours.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return [...seen].sort((a, b) => a - b);
}

/** One watcher: where it stands and how far its sight carries. */
interface Watcher {
  province: number;
  hops: number;
}

/**
 * Everything of this seat's that is currently watching water.
 *
 * Currently, and that word is the mechanism rather than an implementation detail: nothing
 * here is remembered. Burn the lighthouse or kill the scout and the lanes it watched go
 * dark the same tick, mid-crossing, which is what makes blinding a defender something an
 * attacker can actually do rather than a thing the rules merely allow.
 */
function watchers(ctx: RevealContext, seat: number): Watcher[] {
  const out: Watcher[] = [];

  for (const building of ctx.buildings.all()) {
    if (building.owner !== seat) continue;
    // A half-built light is a pile of stone. The same rule the marching camp uses, and for
    // the same reason: a watcher you get before you have paid for it is not a cost.
    if (!building.complete) continue;
    const hops =
      building.kind === BuildingKind.Lighthouse
        ? LIGHTHOUSE_REVEAL_HOPS
        : building.kind === BuildingKind.Port
          ? PORT_REVEAL_HOPS
          : -1;
    if (hops < 0) continue;
    const province = ctx.grid.owner(building.cell);
    if (province > 0) out.push({ province, hops });
  }

  for (const unit of ctx.entities.all()) {
    if (unit.owner !== seat || unit.kind !== UnitKind.Scout || unit.hp <= 0) continue;
    // A scout in a convoy is a passenger, not a lookout.
    if (unit.convoy >= 0) continue;
    const cell = cellOf(ctx.grid, unit);
    if (cell < 0 || !isCoastal(ctx.grid, cell)) continue;
    const province = ctx.grid.owner(cell);
    // No ownership test: standing on somebody else's shore is the entire point of the
    // scout, and the brief's answer to the attacker being blind.
    if (province > 0) out.push({ province, hops: SCOUT_REVEAL_HOPS });
  }

  return out;
}

/** Every lane this seat can currently see traffic on. */
export function revealedLanes(ctx: RevealContext, seat: number): Set<number> {
  const lanes = new Set<number>();
  for (const watcher of watchers(ctx, seat)) {
    for (const province of withinHops(ctx.geography, watcher.province, watcher.hops)) {
      for (const other of ctx.lanesFrom(province)) lanes.add(laneKey(province, other));
    }
  }
  return lanes;
}

/**
 * What a watcher learns about a crossing: size and arrival, and which beach.
 *
 * Exactly the brief's list, and the beach is on it because without it the brief's own
 * counter-play does not exist — "a decoy convoy toward one beach and the real force
 * toward another" is only a play if the defender can see the two are aimed at different
 * doors and has to pick one.
 *
 * What is NOT here is as deliberate. No unit ids, kinds or health: a watcher on the lane
 * counts hulls, and whether those eight are spears or rams is what the landing tells you.
 * No departure quay either — knowing a convoy is on the Channel does not tell you which
 * of Gaul's harbours it left from.
 */
export interface ConvoySighting {
  readonly id: number;
  readonly owner: number;
  readonly fromProvince: number;
  readonly toProvince: number;
  /** The far port or beach it is aimed at. */
  readonly toCell: number;
  /** How many units are aboard. */
  readonly size: number;
  readonly departTick: number;
  readonly arriveTick: number;
  /** True when it is landing over a beach rather than walking off a quay it owns. */
  readonly overBeach: boolean;
  /** True when this seat owns it. Own shipping is never hidden from its owner. */
  readonly own: boolean;
}

function sight(convoy: Convoy, seat: number): ConvoySighting {
  return {
    id: convoy.id,
    owner: convoy.owner,
    fromProvince: convoy.fromProvince,
    toProvince: convoy.toProvince,
    toCell: convoy.toCell,
    size: convoy.units.length,
    departTick: convoy.departTick,
    arriveTick: convoy.arriveTick,
    overBeach: convoy.overBeach,
    own: convoy.owner === seat,
  };
}

/**
 * Every convoy this seat can currently see, in launch order.
 *
 * Computed fresh rather than accumulated, because a sighting is a thing you can LOSE: a
 * convoy seen at launch and hidden again when its watcher burns is the correct behaviour,
 * and a remembered list would quietly turn one glimpse into a tracking system.
 */
export function sightingsFor(ctx: RevealContext, seat: number, convoys: ConvoyStore): ConvoySighting[] {
  const all = convoys.all();
  if (all.length === 0) return [];
  // Only pay for the watch list if there is something to watch.
  const lanes = revealedLanes(ctx, seat);
  const out: ConvoySighting[] = [];
  for (const convoy of all) {
    if (convoy.owner !== seat && !lanes.has(laneKey(convoy.fromProvince, convoy.toProvince))) continue;
    out.push(sight(convoy, seat));
  }
  return out;
}

/** The cell a unit stands in, or -1 when it is off the grid. */
function cellOf(grid: TerrainGrid, unit: { x: number; y: number }): number {
  const col = toIntFloor(unit.x);
  const row = toIntFloor(unit.y);
  return grid.inBounds(col, row) ? grid.index(col, row) : -1;
}
