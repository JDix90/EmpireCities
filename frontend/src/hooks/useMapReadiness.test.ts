import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { mapReadinessSurface, useMapReadiness } from './useMapReadiness';

interface Screen {
  map: { map_id: string; map_kind?: string; connections?: unknown[] } | null;
  view: '2d' | 'globe';
  overview: boolean;
}

/** GamePage's wiring: the surface from the map and view, the ack's ready flag, and the ack. */
function mount(initial: Screen) {
  const readyRef = { current: false };
  const onReady = vi.fn();
  const { rerender } = renderHook(
    ({ map, view, overview }: Screen) =>
      useMapReadiness(mapReadinessSurface(map, view, overview), readyRef, onReady),
    { initialProps: initial },
  );
  return {
    readyRef,
    onReady,
    show: (next: Screen) => rerender(next),
    /** What GamePage's handleGlobeReady does when react-globe.gl reports ready. */
    globeReady: () => { readyRef.current = true; },
  };
}

const spaceAge = () => ({ map_id: 'era_space_age', connections: [{ from: 'a', to: 'b' }] });
const galaxy = () => ({ map_id: 'era_galaxy', map_kind: 'galaxy' });

describe('mapReadinessSurface', () => {
  it('has no surface before the map loads', () => {
    expect(mapReadinessSurface(null, 'globe', false)).toBeNull();
    expect(mapReadinessSurface(undefined, '2d', true)).toBeNull();
  });

  it('draws the 2D map and the galaxy overview at once', () => {
    expect(mapReadinessSurface(spaceAge(), '2d', false)).toBe('instant');
    expect(mapReadinessSurface(galaxy(), '2d', false)).toBe('instant');
    expect(mapReadinessSurface(galaxy(), 'globe', true)).toBe('instant');
  });

  it('waits for a globe, a galaxy world included', () => {
    expect(mapReadinessSurface(spaceAge(), 'globe', false)).toBe('globe');
    // The overview setting only means something on a galaxy map.
    expect(mapReadinessSurface(spaceAge(), 'globe', true)).toBe('globe');
    expect(mapReadinessSurface(galaxy(), 'globe', false)).toBe('globe');
  });
});

describe('useMapReadiness', () => {
  it('waits for the globe to report ready on first mount', () => {
    const screen = mount({ map: spaceAge(), view: 'globe', overview: false });
    expect(screen.readyRef.current).toBe(false);
    expect(screen.onReady).not.toHaveBeenCalled();
  });

  it('keeps a ready globe ready when the map changes under it', () => {
    // A Launch Pad lane, a territory unlock or a board transform delivers a new
    // map object; the globe is not remounted, so it never reports ready again.
    const screen = mount({ map: spaceAge(), view: 'globe', overview: false });
    screen.globeReady();
    const withLane = spaceAge();
    withLane.connections.push({ from: 'b', to: 'moon_1' });
    screen.show({ map: withLane, view: 'globe', overview: false });
    expect(screen.readyRef.current).toBe(true);
    screen.show({ map: { map_id: 'era_next_board' }, view: 'globe', overview: false });
    expect(screen.readyRef.current).toBe(true);
  });

  it('keeps an unready globe waiting when the map changes before it is ready', () => {
    const screen = mount({ map: spaceAge(), view: 'globe', overview: false });
    screen.show({ map: spaceAge(), view: 'globe', overview: false });
    expect(screen.readyRef.current).toBe(false);
    expect(screen.onReady).not.toHaveBeenCalled();
  });

  it('is ready at once on the 2D map, and asks once', () => {
    const screen = mount({ map: spaceAge(), view: '2d', overview: false });
    expect(screen.readyRef.current).toBe(true);
    expect(screen.onReady).toHaveBeenCalledTimes(1);
    screen.show({ map: spaceAge(), view: '2d', overview: false });
    expect(screen.onReady).toHaveBeenCalledTimes(1);
  });

  it('waits again for the globe that mounts on a switch back from 2D', () => {
    const screen = mount({ map: spaceAge(), view: 'globe', overview: false });
    screen.globeReady();
    screen.show({ map: spaceAge(), view: '2d', overview: false });
    expect(screen.readyRef.current).toBe(true);
    expect(screen.onReady).toHaveBeenCalledTimes(1);
    screen.show({ map: spaceAge(), view: 'globe', overview: false });
    expect(screen.readyRef.current).toBe(false);
  });

  it('treats the galaxy overview as instant and a world globe as a new globe', () => {
    const map = galaxy();
    const screen = mount({ map, view: 'globe', overview: true });
    expect(screen.readyRef.current).toBe(true);
    expect(screen.onReady).toHaveBeenCalledTimes(1);
    screen.show({ map, view: 'globe', overview: false });
    expect(screen.readyRef.current).toBe(false);
    screen.globeReady();
    screen.show({ map, view: 'globe', overview: true });
    expect(screen.readyRef.current).toBe(true);
    expect(screen.onReady).toHaveBeenCalledTimes(2);
  });

  it('does nothing until the map has loaded', () => {
    const screen = mount({ map: null, view: '2d', overview: false });
    expect(screen.readyRef.current).toBe(false);
    expect(screen.onReady).not.toHaveBeenCalled();
    screen.show({ map: spaceAge(), view: '2d', overview: false });
    expect(screen.readyRef.current).toBe(true);
    expect(screen.onReady).toHaveBeenCalledTimes(1);
  });
});
