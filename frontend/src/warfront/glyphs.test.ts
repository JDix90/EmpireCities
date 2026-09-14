import { describe, it, expect } from 'vitest';
import { BuildingKind, UnitKind } from '@borderfall/warfront-sim';
import {
  HEALTH_DIRE,
  HEALTH_FULL,
  HEALTH_HURT,
  OWNER_COLORS,
  RAIDER,
  buildingGlyph,
  healthBucket,
  healthColor,
  highlightOf,
  ownerColor,
  shade,
  transformOutline,
  unitGlyph,
  type Outline,
} from './glyphs';

const UNIT_KINDS = Object.values(UnitKind);
const BUILDING_KINDS = Object.values(BuildingKind);

function extent(outline: Outline): number {
  let worst = 0;
  for (let i = 0; i < outline.length; i += 2) worst = Math.max(worst, Math.hypot(outline[i], outline[i + 1]));
  return worst;
}

describe('unitGlyph', () => {
  it('gives every kind a shape, closed and with real area', () => {
    for (const kind of UNIT_KINDS) {
      const { outline } = unitGlyph(kind);
      expect(outline.length % 2).toBe(0);
      expect(outline.length / 2).toBeGreaterThanOrEqual(3);
      for (const n of outline) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('gives no two kinds the same silhouette', () => {
    // The point of the shapes is that a glance separates an army into its parts. Two
    // kinds sharing an outline — the easy copy-paste — puts that back where it was.
    const seen = new Map<string, number>();
    for (const kind of UNIT_KINDS) {
      const key = unitGlyph(kind).outline.join(',');
      expect(seen.has(key)).toBe(false);
      seen.set(key, kind);
    }
    expect(seen.size).toBe(UNIT_KINDS.length);
  });

  it('keeps every point inside the radius the rings are drawn from', () => {
    // The selection ring, the shadow and the health bar are all placed off `radius`. A
    // point outside it would poke through its own selection ring.
    for (const kind of UNIT_KINDS) {
      const glyph = unitGlyph(kind);
      expect(extent(glyph.outline)).toBeLessThanOrEqual(glyph.radius + 0.001);
    }
  });

  it('ranks the heavy kinds above the light ones', () => {
    expect(unitGlyph(UnitKind.Ram).radius).toBeGreaterThan(unitGlyph(UnitKind.Spear).radius);
    expect(unitGlyph(UnitKind.Spear).radius).toBeGreaterThan(unitGlyph(UnitKind.Villager).radius);
  });

  it('falls back to the villager for a kind it has never heard of', () => {
    expect(unitGlyph(99)).toEqual(unitGlyph(UnitKind.Villager));
  });
});

describe('buildingGlyph', () => {
  it('gives every kind a footprint, and every mark an even number of coordinates', () => {
    for (const kind of BUILDING_KINDS) {
      const glyph = buildingGlyph(kind);
      expect(glyph.outline.length / 2).toBeGreaterThanOrEqual(3);
      expect(glyph.half).toBeGreaterThan(0);
      for (const mark of glyph.marks) {
        expect(mark.length % 2).toBe(0);
        expect(mark.length / 2).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('gives no two kinds the same drawing', () => {
    const seen = new Set<string>();
    for (const kind of BUILDING_KINDS) {
      const glyph = buildingGlyph(kind);
      const key = `${glyph.outline.join(',')}|${glyph.marks.map((m) => m.join(',')).join(';')}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(BUILDING_KINDS.length);
  });

  it('makes the seat the largest, since rule III makes it the one that matters', () => {
    for (const kind of BUILDING_KINDS) {
      if (kind === BuildingKind.Seat) continue;
      expect(buildingGlyph(BuildingKind.Seat).half).toBeGreaterThanOrEqual(buildingGlyph(kind).half);
    }
  });

  it('keeps a mark inside the footprint it is drawn on, except the beam that is meant to leave', () => {
    for (const kind of BUILDING_KINDS) {
      if (kind === BuildingKind.Lighthouse) continue;
      const glyph = buildingGlyph(kind);
      for (const mark of glyph.marks) expect(extent(mark)).toBeLessThanOrEqual(extent(glyph.outline) + 0.001);
    }
    expect(extent(buildingGlyph(BuildingKind.Lighthouse).marks[1])).toBeGreaterThan(
      extent(buildingGlyph(BuildingKind.Lighthouse).outline),
    );
  });
});

describe('colours', () => {
  it('never issues a seat the raiders’ colour', () => {
    // Rule VI: a raider inside your land must be unmistakable, at any seat count.
    for (let owner = 1; owner <= OWNER_COLORS.length * 3; owner++) expect(ownerColor(owner)).not.toBe(RAIDER);
    expect(ownerColor(0)).toBe(RAIDER);
  });

  it('wraps rather than running out of seats', () => {
    expect(ownerColor(1)).toBe(OWNER_COLORS[0]);
    expect(ownerColor(OWNER_COLORS.length + 1)).toBe(OWNER_COLORS[0]);
  });

  it('shades each channel and clamps at both ends', () => {
    expect(shade(0x804020, 0.5)).toBe(0x402010);
    expect(shade(0x804020, 0)).toBe(0x000000);
    expect(shade(0xffffff, 4)).toBe(0xffffff);
  });

  it('walks health from green through amber to red', () => {
    expect(healthColor(1)).toBe(HEALTH_FULL);
    expect(healthColor(0.5)).toBe(HEALTH_HURT);
    expect(healthColor(0.1)).toBe(HEALTH_DIRE);
    expect(healthColor(0)).toBe(HEALTH_DIRE);
  });
});

describe('healthBucket', () => {
  it('rounds to tenths and stays inside them', () => {
    expect(healthBucket(100, 100)).toBe(10);
    expect(healthBucket(0, 100)).toBe(0);
    expect(healthBucket(47, 100)).toBe(5);
    // A tick of damage inside one tenth must not rebuild the graphic.
    expect(healthBucket(46, 100)).toBe(healthBucket(47, 100));
  });

  it('treats a building with no recorded maximum as whole rather than dead', () => {
    expect(healthBucket(5, 0)).toBe(10);
  });

  it('clamps a value above its own maximum', () => {
    expect(healthBucket(150, 100)).toBe(10);
  });
});

describe('transformOutline', () => {
  it('scales about the origin and then moves', () => {
    expect(transformOutline([2, 4, -2, -4], 0.5, 1, 2)).toEqual([2, 4, 0, 0]);
  });

  it('insets the highlight up and to the left, which is where the map is lit from', () => {
    const glyph = unitGlyph(UnitKind.Ram);
    const highlight = highlightOf(glyph.outline, glyph.radius);
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < highlight.length; i += 2) {
      sumX += highlight[i];
      sumY += highlight[i + 1];
    }
    expect(sumX / (highlight.length / 2)).toBeLessThan(0);
    expect(sumY / (highlight.length / 2)).toBeLessThan(0);
    expect(extent(highlight)).toBeLessThan(extent(glyph.outline));
  });
});
