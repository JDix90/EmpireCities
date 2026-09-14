/**
 * The shapes the tactical plane draws units and buildings as.
 *
 * Geometry, not rendering: every function here is pure and returns numbers, so the shapes
 * can be tested without a GPU context — the same split as camera.ts and selection.ts, and
 * for the same reason (jsdom has no WebGL).
 *
 * Why shapes at all. Everything on the plane used to be a circle sized by kind and a
 * square for every building, which meant a glance told you where your army was and
 * nothing whatever about what it was made of — a screen of identical dots that happened
 * to differ by a pixel or two of radius. Silhouette is the cheapest channel there is:
 * it survives being small, being one of forty on screen, and being any colour, which is
 * exactly the condition a unit is read under. Colour is spent on WHOSE it is, and
 * brightness on the light, so shape is what is left to say what it is.
 *
 * Coordinates are screen pixels about the thing's centre, x east and y south, matching
 * the plane's own axes. Units are drawn in screen space so they keep their size at every
 * zoom (see WarfrontTerrainCanvas), which is why these are pixels and not cells.
 */

import { BuildingKind, UnitKind } from '@borderfall/warfront-sim';

/** A closed outline as flat x,y pairs. */
export type Outline = readonly number[];

/** Seat colours, in the order seats are numbered. Owner 0 is nobody — see `RAIDER`. */
export const OWNER_COLORS: readonly number[] = [0xf2c661, 0x62a8e8, 0xe8705e, 0x7cd67f, 0xc39ae8, 0x5fd6c4];
/**
 * The tribes. Rule VI wants a raider unmistakable inside your land, so it is the one
 * colour on the plane no seat can ever be issued.
 */
export const RAIDER = 0xc23b28;

export function ownerColor(owner: number): number {
  if (owner === 0) return RAIDER;
  return OWNER_COLORS[(owner - 1) % OWNER_COLORS.length];
}

/** Scales each channel of a packed 0xRRGGBB colour, clamped. */
export function shade(color: number, factor: number): number {
  const channel = (shift: number) => {
    const v = Math.round(((color >> shift) & 0xff) * factor);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A regular polygon with `sides` points, first point at the top. */
function regular(sides: number, radius: number, squash = 1): number[] {
  const points: number[] = [];
  for (let k = 0; k < sides; k++) {
    const angle = -Math.PI / 2 + (k * 2 * Math.PI) / sides;
    points.push(Math.cos(angle) * radius * squash, Math.sin(angle) * radius);
  }
  return points;
}

/**
 * Outline and drawing radius per unit kind.
 *
 * Seven kinds, seven silhouettes, deliberately no two alike: the civilian is round-ish,
 * the two light kinds are small and angular, the line kinds are triangles pointed
 * opposite ways, and the ram is the only wide one. Sizes rank by weight so a ram still
 * reads as heavy from across the map, where the shape has gone.
 */
export interface UnitGlyph {
  outline: Outline;
  /** What the selection ring, the shadow and the health bar are sized from. */
  radius: number;
}

const UNIT_GLYPHS: Record<number, UnitGlyph> = {
  // A worker token: round, which is the one thing no soldier here is.
  [UnitKind.Villager]: { outline: regular(10, 4.2), radius: 4.2 },
  // Narrow and tall — the fastest thing on the map, and the shape least like a villager's,
  // which matters because those are the two a player sorts first: one is assigned, one is
  // sent. A hexagon beside a pentagon told them apart on paper and not on screen.
  [UnitKind.Scout]: { outline: regular(4, 4.6, 0.55), radius: 4.6 },
  // A spearpoint, up.
  [UnitKind.Spear]: { outline: regular(3, 5.6), radius: 5.6 },
  // An arrowhead: the same triangle with its base cut, so it never reads as a spear.
  [UnitKind.Archer]: { outline: [0, -5.4, 4.6, 2.7, 0, 1.5, -4.6, 2.7], radius: 5.4 },
  // A thrown weapon, turned on its point.
  [UnitKind.Skirmisher]: { outline: [0, -5.2, 5.2, 0, 0, 5.2, -5.2, 0], radius: 5.2 },
  // Mounted: the same mass, stretched along the way it travels.
  [UnitKind.Cavalry]: { outline: regular(6, 5.4, 1.3), radius: 6.7 },
  // Siege: the only wide, blunt thing on the plane.
  [UnitKind.Ram]: { outline: [-6.6, -3.2, 6.6, -3.2, 7.8, 0, 6.6, 3.2, -6.6, 3.2, -7.8, 0], radius: 7.9 },
};

export function unitGlyph(kind: number): UnitGlyph {
  return UNIT_GLYPHS[kind] ?? UNIT_GLYPHS[UnitKind.Villager];
}

/**
 * Outline and marks per building kind.
 *
 * `marks` are open polylines drawn over the footprint in ink: the furrows of a farm, the
 * shaft of a mine, the beam of a lighthouse. They carry the identity, so a building is
 * legible even when its owner's colour is one a player has not learned yet.
 */
export interface BuildingGlyph {
  outline: Outline;
  marks: readonly Outline[];
  /** Half-extent, for the selection ring, the shadow and the health bar. */
  half: number;
}

function box(half: number): number[] {
  return [-half, -half, half, -half, half, half, -half, half];
}

const SEAT_HALF = 8.5;
const BUILDING_HALF = 6.5;

const BUILDING_GLYPHS: Record<number, BuildingGlyph> = {
  // A keep: battlements, because rule III makes this the one building worth defending.
  [BuildingKind.Seat]: {
    // Three merlons and two gaps, clockwise from the bottom-left.
    outline: [
      -SEAT_HALF, SEAT_HALF, -SEAT_HALF, -SEAT_HALF, -4.2, -SEAT_HALF, -4.2, -5.2,
      -1.4, -5.2, -1.4, -SEAT_HALF, 1.4, -SEAT_HALF, 1.4, -5.2,
      4.2, -5.2, 4.2, -SEAT_HALF, SEAT_HALF, -SEAT_HALF, SEAT_HALF, SEAT_HALF,
    ],
    marks: [],
    half: SEAT_HALF,
  },
  // A pitched roof.
  [BuildingKind.House]: {
    outline: [0, -7, 6, -1.5, 6, 6, -6, 6, -6, -1.5],
    marks: [],
    half: 6.5,
  },
  [BuildingKind.Farm]: { outline: box(BUILDING_HALF), marks: [[-4, -2, 4, -2], [-4, 1, 4, 1], [-4, 4, 4, 4]], half: BUILDING_HALF },
  // A tree over the plot it stands on.
  [BuildingKind.LumberCamp]: { outline: box(BUILDING_HALF), marks: [[0, -4.5, 3.4, 2, -3.4, 2, 0, -4.5], [0, 2, 0, 4.5]], half: BUILDING_HALF },
  // A shaft going down.
  [BuildingKind.Mine]: { outline: box(BUILDING_HALF), marks: [[-4, -3.5, 0, 3.5, 4, -3.5]], half: BUILDING_HALF },
  [BuildingKind.Barracks]: { outline: box(BUILDING_HALF), marks: [[-4, -4, 4, 4], [4, -4, -4, 4]], half: BUILDING_HALF },
  // Narrow and tall, with a merlon: the one building that shoots back.
  [BuildingKind.Tower]: { outline: [-4, -8.5, 4, -8.5, 4, 6.5, -4, 6.5], marks: [[-4, -4.5, 4, -4.5]], half: 6.5 },
  // A tent, and the only outline with no straight top — rule VII's camp is temporary.
  [BuildingKind.Camp]: { outline: [0, -7, 7, 6, -7, 6], marks: [[-2.6, 6, 0, 0, 2.6, 6]], half: 7 },
  [BuildingKind.Port]: { outline: box(BUILDING_HALF), marks: [[-4.5, 2.5, -1.5, 0.5, 1.5, 2.5, 4.5, 0.5], [0, -4.5, 0, 1]], half: BUILDING_HALF },
  // A beam, thrown north-west, the way the map is lit.
  [BuildingKind.Lighthouse]: {
    outline: [-3.2, -8.5, 3.2, -8.5, 4.4, 6.5, -4.4, 6.5],
    marks: [[-3.2, -5.5, 3.2, -5.5], [-3.6, -7, -8.5, -8.6], [-3.6, -5.8, -9, -5.8], [-3.6, -4.6, -8.5, -3]],
    half: 6.5,
  },
};

export function buildingGlyph(kind: number): BuildingGlyph {
  return BUILDING_GLYPHS[kind] ?? BUILDING_GLYPHS[BuildingKind.House];
}

/** The same outline scaled about the origin and moved — used for the highlight inset. */
export function transformOutline(outline: Outline, scale: number, dx: number, dy: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < outline.length; i += 2) out.push(outline[i] * scale + dx, outline[i + 1] * scale + dy);
  return out;
}

/**
 * The plane is lit from the north-west (see terrainImage.ts), so everything standing on
 * it is too: a highlight up and to the left, an inset of the thing's own shape.
 */
export const HIGHLIGHT_SCALE = 0.52;
export const HIGHLIGHT_OFFSET = 0.34;
export const HIGHLIGHT_ALPHA = 0.24;
/** The contact shadow that stops a unit floating over the ground it is standing on. */
export const SHADOW_ALPHA = 0.3;
export const SHADOW_DROP = 0.5;

export function highlightOf(outline: Outline, radius: number): number[] {
  const offset = -radius * HIGHLIGHT_OFFSET;
  return transformOutline(outline, HIGHLIGHT_SCALE, offset, offset);
}

/** Health from full to none: green, through amber, to red. */
export const HEALTH_FULL = 0x6fd98a;
export const HEALTH_HURT = 0xe8b45e;
export const HEALTH_DIRE = 0xe05a4a;

export function healthColor(fraction: number): number {
  if (fraction > 0.6) return HEALTH_FULL;
  if (fraction > 0.3) return HEALTH_HURT;
  return HEALTH_DIRE;
}

/**
 * Health is bucketed before it reaches a colour or a graphic key.
 *
 * A unit under fire loses hit points every tick, and a graphic rebuilt on every one of
 * those is forty Graphics rebuilds a second for a bar two pixels tall. Tenths are finer
 * than the bar can show.
 */
export function healthBucket(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 10;
  return Math.max(0, Math.min(10, Math.round((hp * 10) / maxHp)));
}
