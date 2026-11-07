import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { altitudeToFitBounds, deriveRegionalGlobeView, fitRegionalView, resolveActiveGlobeView } from './regionalGlobe';

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

/**
 * Fitting a fixed regional board to the screen (fit_board_camera_enabled):
 * the first match's Britain opened at its authored altitude 0.55 on every
 * screen, which on a portrait phone left the board about 140×180 px of a
 * 390×844 screen and its territories smaller than a fingertip.
 */
describe('fitting a regional board to the screen', () => {
  const britain = { minLng: -8, maxLng: 2, minLat: 49.5, maxLat: 59 };
  const authored = { lockRotation: true, centerLat: 54, centerLng: -2, altitude: 0.55 };

  it('zooms Britain in on a portrait phone and on a desktop, centred on the board', () => {
    const phone = fitRegionalView(authored, britain, 390, 740);
    expect(phone.altitude).toBeGreaterThan(0.18);
    expect(phone.altitude).toBeLessThan(0.3);
    expect(phone).toMatchObject({ lockRotation: true, centerLat: 54.25, centerLng: -3 });
    const desktop = fitRegionalView(authored, britain, 1078, 720);
    expect(desktop.altitude).toBeLessThan(0.3);
  });

  it('never zooms out past the authored view: a wide board on a tall phone keeps it', () => {
    const australia = { minLng: 112, maxLng: 155, minLat: -44, maxLat: -10 };
    const view = { lockRotation: true, centerLat: -27, centerLng: 134, altitude: 0.85 };
    expect(fitRegionalView(view, australia, 390, 740)).toBe(view);
  });

  it('fits the narrower side: a wider canvas needs less altitude for the same board', () => {
    expect(altitudeToFitBounds(britain, 1078, 720)).toBeLessThan(altitudeToFitBounds(britain, 390, 740));
  });

  it('leaves the view alone for a canvas with no size yet, or bounds it cannot read', () => {
    expect(fitRegionalView(authored, britain, 0, 740)).toBe(authored);
    expect(fitRegionalView(authored, { ...britain, maxLng: -9 }, 390, 740)).toBe(authored);
  });

  it('stops short of the camera\'s near plane for a tiny board', () => {
    const island = { minLng: -0.2, maxLng: 0.2, minLat: 51.4, maxLat: 51.6 };
    expect(fitRegionalView(authored, island, 390, 740).altitude).toBe(0.12);
  });
});
