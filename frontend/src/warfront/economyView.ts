/**
 * Pure read-only views of the simulation, for the panels to render.
 *
 * Everything here is a function of the sim's state and nothing else: no React, no
 * caching, no mutation. That is deliberate — the sim is the single source of truth for
 * what a player owns, and a panel that kept its own copy would eventually disagree with
 * the thing it is describing. It also means all of this is testable without a canvas.
 *
 * Integers stay integers. The only place a fixed-point value becomes a float is a
 * position handed to the renderer, which happens in simRunner.ts, not here.
 */

import {
  BUILDER_SLOTS,
  BUILDING_KIND_NAMES,
  BUILDING_SPECS,
  BuildingKind,
  CLAIM_TICKS,
  Resource,
  TRAINS_AT,
  UNIT_KIND_NAMES,
  UNIT_SPECS,
  UnitKind,
  colonisePrice,
  toIntFloor,
  type Building,
  type BuildingKindValue,
  type Sim,
  type Unit,
  type UnitKindValue,
} from '@borderfall/warfront-sim';

export interface ResourceView {
  food: number;
  timber: number;
  silver: number;
  pop: number;
  popCap: number;
  starving: boolean;
  /** Food eaten per minute by everything alive — the number that makes an army a cost. */
  upkeepPerMinute: number;
  provinces: number;
  /** What the next province costs, whether or not one is in reach. */
  nextColonisePrice: number;
}

export function resourceView(sim: Sim, owner: number): ResourceView | null {
  const player = sim.players.get(owner);
  if (!player) return null;
  let upkeepPerMinute = 0;
  for (const unit of sim.entities.all()) {
    if (unit.owner !== owner) continue;
    upkeepPerMinute += UNIT_SPECS[unit.kind]?.upkeep ?? 0;
  }
  const provinces = sim.provinces.heldBy(owner);
  return {
    food: player.food,
    timber: player.timber,
    silver: player.silver,
    pop: player.pop,
    popCap: player.popCap,
    starving: player.starving,
    upkeepPerMinute,
    provinces,
    nextColonisePrice: colonisePrice(provinces),
  };
}

export interface BuildingView {
  id: number;
  kind: BuildingKindValue;
  name: string;
  owner: number;
  cell: number;
  complete: boolean;
  /** Construction progress as a whole percentage; 100 once complete. */
  progressPercent: number;
  hp: number;
  maxHp: number;
  /** Workers assigned AND present, over the slots available right now. */
  workersPresent: number;
  workersAssigned: number;
  slots: number;
  /** Resource this pays out, or Resource.None. */
  produces: number;
  /** What this building is currently producing per minute, given who is standing on it. */
  yieldPerMinute: number;
  queue: string[];
  queueRemaining: number;
}

/** Chebyshev distance in cells between a unit and a cell — the sim's own work radius rule. */
function cellsBetween(unit: Unit, cell: number, width: number): number {
  const dc = Math.abs(toIntFloor(unit.x) - (cell % width));
  const dr = Math.abs(toIntFloor(unit.y) - Math.floor(cell / width));
  return dc > dr ? dc : dr;
}

export function buildingView(sim: Sim, building: Building): BuildingView {
  const spec = BUILDING_SPECS[building.kind];
  const width = sim.terrain?.width ?? 1;
  let present = 0;
  for (const id of building.workers) {
    const worker = sim.entities.get(id);
    if (worker && cellsBetween(worker, building.cell, width) <= 1) present += 1;
  }
  const slots = building.complete ? spec.workerSlots : BUILDER_SLOTS;
  return {
    id: building.id,
    kind: building.kind,
    name: BUILDING_KIND_NAMES[building.kind] ?? 'building',
    owner: building.owner,
    cell: building.cell,
    complete: building.complete,
    progressPercent: building.complete ? 100 : Math.floor((building.progress * 100) / spec.buildTicks),
    hp: building.hp,
    maxHp: spec.hp,
    workersPresent: present,
    workersAssigned: building.workers.length,
    slots,
    produces: spec.produces,
    yieldPerMinute: spec.produces === Resource.None ? 0 : spec.yieldPerMinute * present,
    queue: building.queue.map((k) => UNIT_KIND_NAMES[k] ?? 'unit'),
    queueRemaining: building.queueRemaining,
  };
}

/** Every building standing in a province, in ascending id. */
export function buildingsInProvince(sim: Sim, provinceIndex: number): BuildingView[] {
  const grid = sim.terrain;
  if (!grid || provinceIndex <= 0) return [];
  const out: BuildingView[] = [];
  for (const building of sim.buildings.all()) {
    if (grid.owner(building.cell) !== provinceIndex) continue;
    out.push(buildingView(sim, building));
  }
  return out;
}

export interface ProvinceHolding {
  index: number;
  owner: number;
  /** Seat building id, or -1 when the province is seatless and up for grabs. */
  seat: number;
  claimant: number;
  /** Claim progress as a whole percentage of the forty-five seconds rule III gives. */
  claimPercent: number;
  everSettled: boolean;
}

export function provinceHolding(sim: Sim, provinceIndex: number): ProvinceHolding | null {
  const province = sim.provinces.get(provinceIndex);
  if (!province) return null;
  return {
    index: province.index,
    owner: province.owner,
    seat: province.seat,
    claimant: province.claimant,
    claimPercent: Math.floor((province.claimTicks * 100) / CLAIM_TICKS),
    everSettled: province.everSettled,
  };
}

export interface BuildOption {
  kind: BuildingKindValue;
  name: string;
  timber: number;
  silver: number;
  /** False when the biome here forbids it — rule IV deciding what rule II can do. */
  allowedHere: boolean;
  affordable: boolean;
  /** Why it cannot be built on this cell, for the tooltip. Empty when it can. */
  reason: string;
}

/** Buildings a villager may raise, in menu order. A seat is planted by colonising. */
export const BUILDABLE: readonly BuildingKindValue[] = [
  BuildingKind.House,
  BuildingKind.Farm,
  BuildingKind.LumberCamp,
  BuildingKind.Mine,
  BuildingKind.Barracks,
  BuildingKind.Tower,
];

/**
 * What could go on this cell, and why not when not. `cell` may be -1, which asks the
 * cost-and-affordability question alone — the palette still wants to grey out what the
 * player cannot pay for before they have picked a spot.
 */
export function buildOptions(sim: Sim, owner: number, cell: number): BuildOption[] {
  const grid = sim.terrain;
  const player = sim.players.get(owner);
  return BUILDABLE.map((kind) => {
    const spec = BUILDING_SPECS[kind];
    const affordable = !!player && player.timber >= spec.timber && player.silver >= spec.silver;
    let allowedHere = true;
    let reason = '';
    if (!affordable) reason = 'Not enough materials.';
    if (grid && cell >= 0) {
      if (!grid.isPassable(cell)) {
        allowedHere = false;
        reason = 'Nothing can be built on water or mountain.';
      } else if (sim.buildings.atCell(cell)) {
        allowedHere = false;
        reason = 'Something already stands here.';
      } else if (spec.biomes.length > 0 && !spec.biomes.includes(grid.biome(cell))) {
        allowedHere = false;
        reason = `Needs ${spec.biomes.map(biomeLabel).join(' or ')}.`;
      }
    }
    return {
      kind,
      name: BUILDING_KIND_NAMES[kind] ?? 'building',
      timber: spec.timber,
      silver: spec.silver,
      allowedHere,
      affordable,
      reason,
    };
  });
}

/** The biome names the build rules use, for a message a player can act on. */
function biomeLabel(biome: number): string {
  return ['void', 'sea', 'plains', 'forest', 'highland', 'mountain', 'river', 'desert'][biome] ?? 'ground';
}

export interface TrainOption {
  kind: UnitKindValue;
  name: string;
  food: number;
  timber: number;
  silver: number;
  pop: number;
  seconds: number;
  affordable: boolean;
  /** True when the unit would train but has nowhere to live — a house, not a refusal. */
  popBlocked: boolean;
}

/** What a building trains, with what it would cost right now. Empty for a farm. */
export function trainOptions(sim: Sim, building: Building): TrainOption[] {
  const player = sim.players.get(building.owner);
  const kinds = TRAINS_AT[building.kind] ?? [];
  return kinds.map((kind) => {
    const spec = UNIT_SPECS[kind];
    return {
      kind,
      name: UNIT_KIND_NAMES[kind] ?? 'unit',
      food: spec.food,
      timber: spec.timber,
      silver: spec.silver,
      pop: spec.pop,
      seconds: Math.round(spec.trainTicks / 15),
      affordable: !!player && player.food >= spec.food && player.timber >= spec.timber && player.silver >= spec.silver,
      popBlocked: !!player && player.pop + spec.pop > player.popCap,
    };
  });
}

export interface ColoniseView {
  /** Province the villager is standing in, or 0. */
  provinceIndex: number;
  price: number;
  /** True when the colonise command would be accepted right now. */
  ready: boolean;
  reason: string;
}

/**
 * Whether this villager can plant a seat where it stands, and what it would cost.
 *
 * Mirrors the simulation's own refusals rather than guessing at them, so the button is
 * never enabled for an order the sim will silently drop. The one that most needs saying
 * out loud is `everSettled`: a province whose seat was razed is CLAIMED, not bought.
 */
export function coloniseView(sim: Sim, unitId: number): ColoniseView {
  const grid = sim.terrain;
  const unit = sim.entities.get(unitId);
  const none: ColoniseView = { provinceIndex: 0, price: 0, ready: false, reason: '' };
  if (!grid || !unit) return none;
  if (unit.kind !== UnitKind.Villager) return { ...none, reason: 'Only a villager plants a seat.' };
  const player = sim.players.get(unit.owner);
  if (!player) return none;
  const col = toIntFloor(unit.x);
  const row = toIntFloor(unit.y);
  if (!grid.inBounds(col, row)) return none;
  const cell = grid.index(col, row);
  const provinceIndex = grid.owner(cell);
  const price = sim.colonisePriceFor(unit.owner);
  if (provinceIndex === 0) return { provinceIndex: 0, price, ready: false, reason: 'Unclaimed ground — no province here.' };
  const province = sim.provinces.get(provinceIndex);
  if (!province) return { provinceIndex, price, ready: false, reason: '' };
  if (province.seat >= 0) {
    return {
      provinceIndex,
      price,
      ready: false,
      reason: province.owner === unit.owner ? 'Already yours.' : 'Held by a seat — raze it and claim the ground.',
    };
  }
  if (province.everSettled) {
    return { provinceIndex, price, ready: false, reason: 'Razed ground is claimed, not bought — stand here and wait.' };
  }
  if (sim.buildings.atCell(cell)) {
    return { provinceIndex, price, ready: false, reason: 'Something already stands on this cell.' };
  }
  if (player.food < price) {
    return { provinceIndex, price, ready: false, reason: `Needs ${price} food.` };
  }
  return { provinceIndex, price, ready: true, reason: '' };
}
