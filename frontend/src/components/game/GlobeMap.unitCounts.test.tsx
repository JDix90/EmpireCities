/**
 * Army counts on the globe (globe_unit_counts_enabled): the badges reach the
 * globe's overlay layer for the territories that have room on screen, never for
 * a fogged one, and not at all with the switch off or the player's preference
 * off. The room rule itself is tested in utils/globeUnitCounts.test.ts.
 *
 * react-globe.gl is replaced by a stand-in that records the props it is handed
 * and projects a point flat onto the canvas, `scale` pixels per degree from the
 * camera's centre.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const globe = vi.hoisted(() => ({
  pov: { lat: 54, lng: -2, altitude: 0.55 },
  scale: 60,
  props: null as null | Record<string, unknown>,
  controls: {
    autoRotate: false, autoRotateSpeed: 0, dampingFactor: 0.1, enabled: true,
    addEventListener: () => {}, removeEventListener: () => {},
  },
}));

vi.mock('react-globe.gl', async () => {
  const React = await import('react');
  const Globe = React.forwardRef((props: Record<string, unknown>, ref) => {
    globe.props = props;
    React.useImperativeHandle(ref, () => ({
      pauseAnimation: () => {},
      resumeAnimation: () => {},
      controls: () => globe.controls,
      pointOfView: (pov?: Partial<typeof globe.pov>) => { if (pov) Object.assign(globe.pov, pov); return { ...globe.pov }; },
      getScreenCoords: (lat: number, lng: number) => ({
        x: 195 + (lng - globe.pov.lng) * globe.scale,
        y: 370 - (lat - globe.pov.lat) * globe.scale,
      }),
      renderer: () => ({ setPixelRatio: () => {}, setSize: () => {}, domElement: document.createElement('canvas') }),
      toGlobeCoords: () => null,
      scene: () => null,
      camera: () => ({ aspect: 1, updateProjectionMatrix() {}, updateMatrixWorld() {} }),
    }));
    React.useEffect(() => { (props.onGlobeReady as (() => void) | undefined)?.(); }, []);
    return React.createElement('div', { 'data-testid': 'globe-stub' });
  });
  return { default: Globe };
});
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import { GlobeMapCore } from './GlobeMap';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { setGlobeArmyCountsPreference } from '../../utils/userPreferences';

const britain = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/community_britain_925.json'), 'utf8'));
const ids: string[] = britain.territories.map((t: { territory_id: string }) => t.territory_id);

type Overlay = { kind: string; id: string; alt: number; count?: number; emphasis?: string };
const overlays = () => (globe.props!.htmlElementsData as Overlay[]);
const counts = () => overlays().filter((d) => d.kind === 'unit-count');
const countFor = (tid: string) => counts().find((d) => d.id === `unit-count-${tid}`);

function gameState(fogged: string[] = []) {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  ids.forEach((tid, i) => {
    territories[tid] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: fogged.includes(tid) ? -1 : i + 1 };
  });
  return {
    game_id: 'g1', era: 'medieval', map_id: britain.map_id, phase: 'draft', turn_number: 1, current_player_index: 0,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Bot', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: {},
  };
}

function mount({ flag = true, fogged = [] as string[] } = {}) {
  act(() => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, globe_unit_counts_enabled: flag } }));
    useGameStore.setState({ gameState: gameState(fogged) as never });
  });
  return render(
    <GlobeMapCore mapData={britain} onTerritoryClick={() => {}} width={390} height={740}
      selfPlayerId="me" frameBudget reducedEffects autoSpin={false} />,
  );
}

describe('army counts on the globe', () => {
  beforeEach(() => {
    globe.pov = { lat: 54, lng: -2, altitude: 0.55 };
    globe.scale = 60;
    globe.props = null;
    localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useGameStore.setState({ gameState: null });
      useUiStore.getState().reset();
      useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, globe_unit_counts_enabled: false } }));
    });
  });

  it('shows none with the switch off, and leaves the globe as it was', () => {
    mount({ flag: false });
    expect(counts()).toEqual([]);
    expect(overlays().filter((d) => d.kind === 'region-label').every((d) => d.alt === 0.07)).toBe(true);
    expect(globe.props!.onZoom).toBeUndefined();
    expect(document.querySelector<HTMLElement>('[data-testid="globe-map-root"]')!.style.isolation).toBe('');
  });

  it('keeps the overlay layer’s stacking inside the globe, under the panels beside it', () => {
    mount();
    expect(document.querySelector<HTMLElement>('[data-testid="globe-map-root"]')!.style.isolation).toBe('isolate');
  });

  it('shows every count on a board with room for them all, with its army', () => {
    mount();
    expect(counts()).toHaveLength(ids.length);
    expect(countFor(ids[4]!)?.count).toBe(5);
  });

  it('never shows a fogged territory’s count', () => {
    mount({ fogged: [ids[0]!, ids[1]!] });
    expect(countFor(ids[0]!)).toBeUndefined();
    expect(countFor(ids[1]!)).toBeUndefined();
    expect(counts()).toHaveLength(ids.length - 2);
  });

  it('shows none when the player has turned them off', () => {
    setGlobeArmyCountsPreference(false);
    mount();
    expect(counts()).toEqual([]);
  });

  it('puts region names under the counts, so a count draws over a name', () => {
    mount();
    const labels = overlays().filter((d) => d.kind === 'region-label');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((d) => d.alt < counts()[0]!.alt)).toBe(true);
  });

  it('zoomed out on a crowded board, keeps the selection and its neighbours and drops the rest', () => {
    globe.scale = 2; // the whole board within a few pixels
    mount();
    // Nothing selected: one count fits, the viewer's biggest stack.
    expect(counts()).toHaveLength(1);
    const target = britain.territories.find((t: { territory_id: string }) => t.territory_id === 'brycheiniog').territory_id;
    act(() => useUiStore.getState().setSelectedTerritory(target));
    const neighbours = britain.connections
      .filter((c: { from: string; to: string }) => c.from === target || c.to === target)
      .map((c: { from: string; to: string }) => (c.from === target ? c.to : c.from));
    const shown = counts().map((d) => d.id.replace('unit-count-', ''));
    expect(new Set(shown)).toEqual(new Set([target, ...neighbours]));
    expect(countFor(target)?.emphasis).toBe('selected');
  });

  it('places again as the camera moves, keeping each unchanged badge', () => {
    vi.useFakeTimers();
    mount();
    expect(counts()).toHaveLength(ids.length);
    // The viewer's biggest stack: the one count that still fits zoomed out.
    const biggestMine = ids.filter((_, i) => i % 2 === 0).at(-1)!;
    const kept = countFor(biggestMine);
    // Zoom far out: the camera reports the move and the counts thin out.
    globe.scale = 2;
    act(() => {
      (globe.props!.onZoom as () => void)();
      vi.advanceTimersByTime(200);
    });
    expect(counts().map((d) => d.id)).toEqual([`unit-count-${biggestMine}`]);
    // Its badge is the same object, so three-globe keeps its element.
    expect(countFor(biggestMine)).toBe(kept);
    // And back in: every count returns, that badge still unchanged.
    globe.scale = 60;
    act(() => {
      (globe.props!.onZoom as () => void)();
      vi.advanceTimersByTime(200);
    });
    expect(counts()).toHaveLength(ids.length);
    expect(countFor(biggestMine)).toBe(kept);
  });
});
