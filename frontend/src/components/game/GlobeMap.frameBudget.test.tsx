/**
 * The globe's side of the phone frame budget (docs/MOBILE_UX_PLAN.md M-13),
 * with react-globe.gl replaced by a stand-in that records what the component
 * asks of it: when the render loop runs, how the controls are tuned, and what
 * decoration it is handed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const globe = vi.hoisted(() => ({
  running: false,
  resumes: 0,
  controls: { autoRotate: false, autoRotateSpeed: 0, dampingFactor: 0.1, enabled: true, addEventListener: () => {}, removeEventListener: () => {} },
  props: null as null | Record<string, unknown>,
  pov: { lat: 0, lng: 0, altitude: 1.8 },
}));

vi.mock('react-globe.gl', async () => {
  const React = await import('react');
  const Globe = React.forwardRef((props: Record<string, unknown>, ref) => {
    globe.props = props;
    React.useImperativeHandle(ref, () => ({
      pauseAnimation: () => { globe.running = false; },
      resumeAnimation: () => { if (!globe.running) globe.resumes += 1; globe.running = true; },
      controls: () => globe.controls,
      pointOfView: (pov?: Partial<typeof globe.pov>) => { if (pov) Object.assign(globe.pov, pov); return { ...globe.pov }; },
      renderer: () => ({ setPixelRatio: () => {}, setSize: () => {}, domElement: document.createElement('canvas') }),
      toGlobeCoords: () => null,
    }));
    React.useEffect(() => { (props.onGlobeReady as (() => void) | undefined)?.(); }, []);
    return React.createElement('div', { 'data-testid': 'globe-stub' });
  });
  return { default: Globe };
});
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import { GlobeMapCore } from './GlobeMap';
import { useGameStore } from '../../store/gameStore';

const spaceAge = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_space_age.json'), 'utf8'));

function gameState(overrides: { owner?: string; units?: number; current?: number } = {}) {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  spaceAge.territories.forEach((t: { territory_id: string }, i: number) => {
    territories[t.territory_id] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: 3 };
  });
  const first = spaceAge.territories[0].territory_id;
  if (overrides.owner) territories[first].owner_id = overrides.owner;
  if (overrides.units) territories[first].unit_count = overrides.units;
  return {
    game_id: 'g1',
    era: 'space_age',
    map_id: 'era_space_age',
    phase: 'attack',
    turn_number: 3,
    current_player_index: overrides.current ?? 1,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Admiral Chen', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: {},
  };
}

function mount(props: { frameBudget?: boolean; reducedEffects?: boolean } = {}) {
  return render(
    <GlobeMapCore
      mapData={spaceAge}
      onTerritoryClick={() => {}}
      width={390}
      height={600}
      selfPlayerId="me"
      frameBudget={props.frameBudget ?? true}
      reducedEffects={props.reducedEffects ?? true}
      autoSpin={false}
    />,
  );
}

describe('GlobeMap under the phone frame budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globe.running = false;
    globe.resumes = 0;
    globe.controls.dampingFactor = 0.1;
    globe.props = null;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    act(() => { useGameStore.setState({ gameState: gameState() as never }); });
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => { useGameStore.setState({ gameState: null }); });
  });

  it('idles within a few frames of mounting instead of four seconds', () => {
    mount();
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(400); });
    expect(globe.running).toBe(false);
  });

  it('keeps the four-second idle on the desktop', () => {
    mount({ frameBudget: false, reducedEffects: false });
    act(() => { vi.advanceTimersByTime(400); });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(globe.running).toBe(false);
  });

  it('wakes an idle globe to paint a board change, then idles again', () => {
    mount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(globe.running).toBe(false);
    const before = globe.resumes;
    act(() => { useGameStore.setState({ gameState: gameState({ owner: 'ai_1', units: 5 }) as never }); });
    expect(globe.resumes).toBe(before + 1);
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(350); });
    expect(globe.running).toBe(false);
  });

  it('keeps the loop awake for the whole of a camera tween', () => {
    mount({ frameBudget: false, reducedEffects: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(globe.running).toBe(false);
    // The zoom buttons tween the camera over 200 ms.
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(300); });
    expect(globe.running).toBe(true);
  });

  it('rescales the controls damping for 30 frames a second, and leaves the desktop at 0.1', () => {
    const { unmount } = mount();
    expect(globe.controls.dampingFactor).toBeCloseTo(0.19, 5);
    unmount();
    mount({ frameBudget: false, reducedEffects: false });
    expect(globe.controls.dampingFactor).toBeCloseTo(0.1, 5);
  });

  it('drops the endless wasteland rings and stills the markers under reduced effects', () => {
    const { unmount } = mount({ reducedEffects: true });
    const rings = (globe.props?.ringsData as Array<{ id: string }>).filter((r) => r.id.startsWith('wasteland-ring-'));
    const markers = (globe.props?.htmlElementsData as Array<{ kind: string; pulse?: boolean }>).filter((d) => d.kind === 'wasteland-zone');
    expect(rings).toHaveLength(0);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((m) => m.pulse === false)).toBe(true);
    unmount();
    mount({ frameBudget: false, reducedEffects: false });
    const desktopRings = (globe.props?.ringsData as Array<{ id: string }>).filter((r) => r.id.startsWith('wasteland-ring-'));
    const desktopMarkers = (globe.props?.htmlElementsData as Array<{ kind: string; pulse?: boolean }>).filter((d) => d.kind === 'wasteland-zone');
    expect(desktopRings.length).toBeGreaterThan(0);
    expect(desktopMarkers.every((m) => m.pulse === true)).toBe(true);
  });
});
