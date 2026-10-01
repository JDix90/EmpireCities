/**
 * The 2D map in a browser without WebGL. PixiJS has no other renderer, and
 * its constructor used to throw and take the game page into its error screen;
 * the map now says what is missing in its place. PixiJS is the shared fake
 * (test/fakePixi.ts), whose Application throws as PixiJS's does without WebGL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('pixi.js', async () => (await import('../../test/fakePixi')).pixi.module);
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import GameMap from './GameMap';
import { pixi } from '../../test/fakePixi';
import type { MapVisualEvent } from '../../utils/mapVisualEvents';

const spaceAge = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_space_age.json'), 'utf8'));
const firstEarth = (spaceAge.territories as Array<{ territory_id: string; globe_id?: string }>)
  .find((t) => t.globe_id !== 'moon')!.territory_id;

/** One list for every render, as the game page passes. */
const NO_EVENTS: never[] = [];
function show(props: Partial<Parameters<typeof GameMap>[0]> = {}) {
  return render(
    <GameMap
      mapData={spaceAge}
      onTerritoryClick={() => {}}
      width={600}
      height={400}
      activeWorldId="earth"
      mapVisualEvents={NO_EVENTS}
      {...props}
    />,
  );
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  pixi.created.apps.length = 0;
  pixi.webgl.supported = false;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  pixi.webgl.supported = true;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the 2D map without WebGL', () => {
  it('says what is missing in its place, and builds no renderer', () => {
    show();
    expect(screen.getByRole('alert')).toHaveTextContent("This browser can't draw the map");
    expect(screen.getByRole('alert')).toHaveTextContent('Turn on hardware acceleration');
    expect(pixi.created.apps).toHaveLength(0);
    expect(screen.queryByTestId('map-visual-canvas')).toBeNull();
    // Why, for whoever opens the console.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No WebGL renderer'), expect.any(Error));
  });

  it('shows one message, not a second for the Moon inset', () => {
    show({ moonInset: true });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByTestId('map-with-moon-inset')).toBeNull();
  });

  it('acknowledges visual events and leaves nothing waiting to play them', () => {
    vi.useFakeTimers();
    const timeouts = vi.spyOn(window, 'setTimeout');
    const onMapVisualDone = vi.fn();
    const event = { id: 'v1', kind: 'reinforce', territoryId: firstEarth, units: 2 } as unknown as MapVisualEvent;
    show({ mapVisualEvents: [event], onMapVisualDone });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onMapVisualDone).toHaveBeenCalledWith('v1');
    // No renderer means no effects layer will ever come: no polling for one.
    expect(timeouts.mock.calls.filter(([, ms]) => ms === 32)).toHaveLength(0);
  });

  it('draws as before where WebGL is', () => {
    pixi.webgl.supported = true;
    show();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('map-visual-canvas')).toBeInTheDocument();
    expect(pixi.created.apps).toHaveLength(1);
  });
});
