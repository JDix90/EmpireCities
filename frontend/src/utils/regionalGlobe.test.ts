import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRegionalGlobeView, resolveActiveGlobeView } from './regionalGlobe';

const galaxy = JSON.parse(readFileSync(join(__dirname, '../../../database/maps/era_galaxy.json'), 'utf8'));

describe('resolveActiveGlobeView', () => {
  const mapLevel = { center_lat: 10, center_lng: 20, altitude: 1.8 };
  const worldView = { center_lat: 25, center_lng: 30, altitude: 2.3, lock_rotation: false };

  it("uses the focused world's view on a galaxy map", () => {
    const map = { map_kind: 'galaxy', globe_view: mapLevel, worlds: [{ world_id: 'verdan', globe_view: worldView }, { world_id: 'sol' }] };
    expect(resolveActiveGlobeView(map, 'verdan')).toBe(worldView);
    // A world without its own view keeps the map-level one.
    expect(resolveActiveGlobeView(map, 'sol')).toBe(mapLevel);
  });

  it('ignores world views on every other kind of map', () => {
    const map = { map_kind: 'standard', globe_view: mapLevel, worlds: [{ world_id: 'earth', globe_view: worldView }] };
    expect(resolveActiveGlobeView(map, 'earth')).toBe(mapLevel);
    expect(resolveActiveGlobeView({ globe_view: mapLevel }, 'earth')).toBe(mapLevel);
  });

  it('keeps idle spin on the shipped far worlds and frames each on its landmark', () => {
    for (const id of ['verdan', 'rust', 'nexus_station']) {
      const view = resolveActiveGlobeView(galaxy, id);
      expect(view, id).toBeDefined();
      const derived = deriveRegionalGlobeView(view, new Map());
      expect(derived.lockRotation, id).toBe(false);
      expect(derived.centerLat, id).toBe(view!.center_lat);
    }
  });
});
