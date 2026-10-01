/**
 * The globe in a browser without WebGL. The 2D map cannot stand in (PixiJS
 * needs WebGL too), so the map area says what is missing instead, on every
 * board, and the turn clock is told the map is up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Whether the 2D map was ever mounted. */
const flat = vi.hoisted(() => ({ mounted: 0 }));
vi.mock('./GameMap', () => ({
  default: () => {
    flat.mounted += 1;
    return null;
  },
}));
// The globe itself, drawn only where WebGL is.
vi.mock('react-globe.gl', async () => {
  const React = await import('react');
  return { default: React.forwardRef(() => React.createElement('div', { 'data-testid': 'globe-stub' })) };
});
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));
// jsdom has no 2D canvas to paint a world's surface on.
vi.mock('../../utils/proceduralPlanet', async (actual) => ({
  ...(await actual<typeof import('../../utils/proceduralPlanet')>()),
  buildGalaxyWorldTextureFromPolygons: () => undefined,
}));
const webgl = vi.hoisted(() => ({ available: false }));
vi.mock('../../utils/webglSupport', () => ({ webglAvailable: () => webgl.available }));

import GlobeMap from './GlobeMap';

const read = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../database/maps/${name}.json`), 'utf8'));
const galaxy = read('era_galaxy');
const spaceAge = read('era_space_age');

function show(mapData: unknown, activeWorldId: string) {
  const onGlobeReady = vi.fn();
  render(
    <GlobeMap
      mapData={mapData as Parameters<typeof GlobeMap>[0]['mapData']}
      activeWorldId={activeWorldId}
      onTerritoryClick={() => {}}
      width={600}
      height={400}
      onGlobeReady={onGlobeReady}
      autoSpin={false}
    />,
  );
  return { onGlobeReady };
}

beforeEach(() => {
  flat.mounted = 0;
  webgl.available = false;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

describe('the globe without WebGL', () => {
  it.each([
    ['a galaxy world', galaxy, 'verdan'],
    ['an Earth board', spaceAge, 'earth'],
  ])('says the map needs WebGL on %s, and tells the turn clock', async (_board, mapData, world) => {
    const { onGlobeReady } = show(mapData, world);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This browser can't draw the map");
    expect(alert).toHaveStyle({ width: '600px', height: '400px' });
    expect(onGlobeReady).toHaveBeenCalledTimes(1);
    // No 2D map that would only fail the page.
    expect(flat.mounted).toBe(0);
    expect(screen.queryByTestId('globe-stub')).toBeNull();
  });

  it('draws the globe where WebGL is', async () => {
    webgl.available = true;
    show(galaxy, 'verdan');
    expect(await screen.findByTestId('globe-stub')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
