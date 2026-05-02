import { describe, it, expect } from 'vitest';
import { resolveGalaxyDrillDownGlobeSkin } from './galaxyGlobeSkin';

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
