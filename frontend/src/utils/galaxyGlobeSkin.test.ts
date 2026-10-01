import { describe, it, expect } from 'vitest';
import { galaxyWorldGlobeProps, resolveGalaxyDrillDownGlobeSkin } from './galaxyGlobeSkin';

describe('resolveGalaxyDrillDownGlobeSkin', () => {
  const worlds = [
    {
      world_id: 'sol',
      globe_image_url: 'https://example.com/world-sol.jpg',
      bump_image_url: 'https://example.com/world-sol-bump.png',
      show_atmosphere: true,
      atmosphere_color: '#aabbcc',
      atmosphere_altitude: 0.2,
      background_color: 'rgb(1,2,3)',
    },
  ];
  const territories = [
    {
      territory_id: 't1',
      region_id: 'r1',
      world_id: 'sol',
      globe_image_url: 'https://example.com/t1-override.jpg',
      bump_image_url: '',
    },
  ];

  it('uses world defaults when no territory is selected', () => {
    const r = resolveGalaxyDrillDownGlobeSkin({
      worlds,
      territories,
      focusedWorldId: 'sol',
      selectedTerritoryId: null,
    });
    expect(r.globeImageUrl).toBe('https://example.com/world-sol.jpg');
    expect(r.bumpImageUrl).toBe('https://example.com/world-sol-bump.png');
  });

  it('uses territory override when selection matches focused world', () => {
    const r = resolveGalaxyDrillDownGlobeSkin({
      worlds,
      territories,
      focusedWorldId: 'sol',
      selectedTerritoryId: 't1',
    });
    expect(r.globeImageUrl).toBe('https://example.com/t1-override.jpg');
    expect(r.bumpImageUrl).toBe('');
    expect(r.atmosphereColor).toBe('#aabbcc');
  });

  it('ignores territory override when selection is on another world', () => {
    const r = resolveGalaxyDrillDownGlobeSkin({
      worlds,
      territories,
      focusedWorldId: 'sol',
      selectedTerritoryId: 't1',
    });
    const r2 = resolveGalaxyDrillDownGlobeSkin({
      worlds,
      territories,
      focusedWorldId: 'rust',
      selectedTerritoryId: 't1',
    });
    expect(r.globeImageUrl).toContain('t1-override');
    expect(r2.globeImageUrl).toBeUndefined();
  });
});

describe('galaxyWorldGlobeProps', () => {
  const worlds = [
    { world_id: 'verdan', globe_image_url: 'verdan.jpg', bump_image_url: 'verdan-bump.png', atmosphere_color: '#7fe7a3', atmosphere_altitude: 0.24, background_color: 'rgb(8, 24, 18)' },
    { world_id: 'rust', show_atmosphere: false },
  ];

  it("dresses a world's globe in its procedural surface, its atmosphere and its void, with no bump", () => {
    expect(galaxyWorldGlobeProps(worlds, 'verdan', 'data:verdan')).toEqual({
      globeImageUrl: 'data:verdan',
      bumpImageUrl: '',
      showAtmosphere: true,
      atmosphereColor: '#7fe7a3',
      atmosphereAltitude: 0.24,
      backgroundColor: 'rgb(8, 24, 18)',
    });
  });

  it('falls back to the authored surface, and to the default atmosphere', () => {
    expect(galaxyWorldGlobeProps(worlds, 'verdan', undefined).globeImageUrl).toBe('verdan.jpg');
    expect(galaxyWorldGlobeProps(worlds, 'rust', undefined)).toEqual({
      globeImageUrl: undefined,
      bumpImageUrl: '',
      showAtmosphere: false,
      atmosphereColor: 'lightskyblue',
      atmosphereAltitude: 0.15,
      backgroundColor: undefined,
    });
  });
});
