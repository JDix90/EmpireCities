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

const globe = vi.hoisted(() => {
  // OrbitControls' listeners, so a test can move the camera.
  const listeners: Record<string, () => void> = {};
  return {
    running: false,
    resumes: 0,
    // Every pixel ratio the component set on the renderer, in order.
    pixelRatios: [] as number[],
    listeners,
    controls: {
      autoRotate: false, autoRotateSpeed: 0, dampingFactor: 0.1, enabled: true,
      addEventListener: (type: string, fn: () => void) => { listeners[type] = fn; },
      removeEventListener: (type: string) => { delete listeners[type]; },
    },
    props: null as null | Record<string, unknown>,
    pov: { lat: 0, lng: 0, altitude: 1.8 },
    // three.js's frame counter, when a test wants the renderer to count frames.
    info: null as null | { render: { frame: number } },
    scene: null as null | { children: unknown[] },
  };
});

vi.mock('react-globe.gl', async () => {
  const React = await import('react');
  const Globe = React.forwardRef((props: Record<string, unknown>, ref) => {
    globe.props = props;
    React.useImperativeHandle(ref, () => ({
      pauseAnimation: () => { globe.running = false; },
      resumeAnimation: () => { if (!globe.running) globe.resumes += 1; globe.running = true; },
      controls: () => globe.controls,
      pointOfView: (pov?: Partial<typeof globe.pov>) => { if (pov) Object.assign(globe.pov, pov); return { ...globe.pov }; },
      renderer: () => ({ setPixelRatio: (r: number) => { globe.pixelRatios.push(r); }, setSize: () => {}, domElement: document.createElement('canvas'), ...(globe.info ? { info: globe.info } : {}) }),
      toGlobeCoords: () => null,
      scene: () => globe.scene,
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
    globe.pixelRatios.length = 0;
    globe.controls.dampingFactor = 0.1;
    globe.props = null;
    globe.info = null;
    globe.scene = null;
    for (const k of Object.keys(globe.listeners)) delete globe.listeners[k];
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    act(() => { useGameStore.setState({ gameState: gameState() as never }); });
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => { useGameStore.setState({ gameState: null }); useUiStore.getState().reset(); });
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

  it('wakes an idle globe to paint a board change for two frames at 20 a second, then idles again', () => {
    mount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(globe.running).toBe(false);
    const before = globe.resumes;
    act(() => { useGameStore.setState({ gameState: gameState({ owner: 'ai_1', units: 5 }) as never }); });
    expect(globe.resumes).toBe(before + 1);
    expect(globe.running).toBe(true);
    // Every other player's move is a board change: under the budget it gets
    // 100 ms, not the 300 ms the desktop keeps (M-14).
    act(() => { vi.advanceTimersByTime(90); });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(20); });
    expect(globe.running).toBe(false);
  });

  it('owes a board change three frames when a slow frame outlasts the wake', () => {
    globe.info = { render: { frame: 0 } };
    mount();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(globe.running).toBe(false);
    act(() => { useGameStore.setState({ gameState: gameState({ owner: 'ai_1', units: 6 }) as never }); });
    // One frame, 150 ms long: past the wake, with the new board maybe not yet in it.
    act(() => { vi.advanceTimersByTime(150); globe.info!.render.frame += 1; });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(50); globe.info!.render.frame += 2; });
    act(() => { vi.advanceTimersByTime(60); });
    expect(globe.running).toBe(false);
  });

  it('keeps the 100 ms wake when the frames come on time', () => {
    globe.info = { render: { frame: 0 } };
    mount();
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { useGameStore.setState({ gameState: gameState({ owner: 'ai_1', units: 6 }) as never }); });
    act(() => { vi.advanceTimersByTime(90); globe.info!.render.frame += 3; });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(20); });
    expect(globe.running).toBe(false);
  });

  it('keeps a desktop globe painting a board change for 300 ms', () => {
    mount({ frameBudget: false, reducedEffects: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(globe.running).toBe(false);
    act(() => { useGameStore.setState({ gameState: gameState({ owner: 'ai_1', units: 5 }) as never }); });
    act(() => { vi.advanceTimersByTime(250); });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(globe.running).toBe(false);
  });

  it('wakes an idle globe to paint new shapes, as Natural Earth arriving brings', () => {
    const props = { onTerritoryClick: () => {}, width: 390, height: 600, selfPlayerId: 'me', autoSpin: false };
    const { rerender } = render(<GlobeMapCore {...props} mapData={spaceAge} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(globe.running).toBe(false);
    // The same board with one territory fewer: new shapes to draw.
    rerender(<GlobeMapCore {...props} mapData={{ ...spaceAge, territories: spaceAge.territories.slice(1) }} />);
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(400); });
    expect(globe.running).toBe(false);
    // A new map object with the same shapes is nothing new to paint.
    rerender(<GlobeMapCore {...props} mapData={{ ...spaceAge, territories: spaceAge.territories.slice(1) }} />);
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

  // A touch kept a phone's globe drawing for four seconds, and a player touches
  // more often than that, so it drew at the full budget for the whole turn.
  it('wakes a phone globe for a moment on a touch, not four seconds', () => {
    mount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(globe.running).toBe(false);
    const stub = screen.getByTestId('globe-stub');
    fireEvent.pointerDown(stub, { clientX: 100, clientY: 100 });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(stub, { clientX: 100, clientY: 100 });
    // The finger lifting wakes it again, for the selection the tap makes.
    act(() => { vi.advanceTimersByTime(550); });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(100); });
    expect(globe.running).toBe(false);
  });

  it('paints a selection made after the touch wake has ended, frames and all', () => {
    // Reinforcing: a selection lights no moving target arcs, which wake for longer.
    act(() => { useGameStore.setState({ gameState: { ...gameState(), phase: 'reinforce' } as never }); });
    globe.info = { render: { frame: 0 } };
    mount();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(globe.running).toBe(false);
    // A territory picked from a panel, or a tap whose click lands late.
    act(() => { useUiStore.getState().setSelectedTerritory(spaceAge.territories[0].territory_id); });
    expect(globe.running).toBe(true);
    // One slow frame outlasts the wake; the restyle is owed the frames after it.
    act(() => { vi.advanceTimersByTime(150); globe.info!.render.frame += 1; });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(50); globe.info!.render.frame += 2; });
    act(() => { vi.advanceTimersByTime(60); });
    expect(globe.running).toBe(false);
    act(() => { useUiStore.getState().setAttackSource(spaceAge.territories[0].territory_id); });
    expect(globe.running).toBe(true);
  });

  it('keeps a desktop globe drawing for four seconds after a touch', () => {
    mount({ frameBudget: false, reducedEffects: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(globe.running).toBe(false);
    fireEvent.pointerDown(screen.getByTestId('globe-stub'), { clientX: 100, clientY: 100 });
    act(() => { vi.advanceTimersByTime(3900); });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(globe.running).toBe(false);
  });

  it('keeps a phone globe drawing while the camera moves, and idles once it stops', () => {
    mount();
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerDown(screen.getByTestId('globe-stub'), { clientX: 100, clientY: 100 });
    // A drag and its coast: the controls report a change every frame for two seconds.
    for (let i = 0; i < 60; i++) {
      act(() => { globe.listeners.change?.(); vi.advanceTimersByTime(33); });
    }
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(300); });
    expect(globe.running).toBe(false);
  });

  it('keeps a coast running through slow frames until the camera stops', () => {
    globe.info = { render: { frame: 0 } };
    mount();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(globe.running).toBe(false);
    // A fling coasting on a busy phone: every frame takes 300 ms, longer than
    // a camera wake, and the camera still moves in each one.
    for (let i = 0; i < 5; i++) {
      act(() => { globe.listeners.change?.(); vi.advanceTimersByTime(300); globe.info!.render.frame += 1; });
      expect(globe.running).toBe(true);
    }
    // The camera has stopped: the frames owed to its last move, then idle.
    act(() => { vi.advanceTimersByTime(300); globe.info!.render.frame += 1; });
    act(() => { vi.advanceTimersByTime(300); globe.info!.render.frame += 1; });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(300); globe.info!.render.frame += 1; });
    act(() => { vi.advanceTimersByTime(60); });
    expect(globe.running).toBe(false);
  });

  it('gives a new pulse on a phone a moment of motion before it holds still', () => {
    const props = { mapData: spaceAge, onTerritoryClick: () => {}, width: 390, height: 600, selfPlayerId: 'me', autoSpin: false, frameBudget: true, reducedEffects: true };
    const { rerender } = render(<GlobeMapCore {...props} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(globe.running).toBe(false);
    // What the viewer lost while away (M-12): a ring that pulses while the loop runs.
    rerender(<GlobeMapCore {...props} lossPulseTerritoryIds={[spaceAge.territories[0].territory_id]} />);
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(1400); });
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(globe.running).toBe(false);
  });

  it('takes over the globe\'s hover hit-test once the globe is ready', () => {
    const plain = () => {};
    const root = { toGeoCoords: () => ({}), getCoords: () => ({}), children: [], raycast: plain };
    globe.scene = { children: [root] };
    mount();
    expect(root.raycast).not.toBe(plain);
  });

  it('rescales the controls damping for 30 frames a second, and leaves the desktop at 0.1', () => {
    const { unmount } = mount();
    expect(globe.controls.dampingFactor).toBeCloseTo(0.19, 5);
    unmount();
    mount({ frameBudget: false, reducedEffects: false });
    expect(globe.controls.dampingFactor).toBeCloseTo(0.1, 5);
  });

  it('draws an idle globe again when its pane resizes, which clears the canvas', () => {
    const props = { mapData: spaceAge, onTerritoryClick: () => {}, width: 390, selfPlayerId: 'me', autoSpin: false, frameBudget: true, reducedEffects: true };
    const { rerender } = render(<GlobeMapCore {...props} height={600} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(globe.running).toBe(false);
    // The browser's toolbar slides away: the pane grows.
    rerender(<GlobeMapCore {...props} height={660} />);
    expect(globe.running).toBe(true);
    act(() => { vi.advanceTimersByTime(400); });
    expect(globe.running).toBe(false);
  });

  it('draws a phone at 1.25 device pixels per CSS pixel, and the desktop at 1.5', () => {
    const dpr = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    try {
      const props = { mapData: spaceAge, onTerritoryClick: () => {}, width: 390, height: 600, selfPlayerId: 'me', autoSpin: false, reducedEffects: true };
      const { rerender } = render(<GlobeMapCore {...props} frameBudget />);
      expect(globe.pixelRatios.at(-1)).toBe(1.25);
      // Battery saver turned off on a laptop: the budget lifts mid-game.
      rerender(<GlobeMapCore {...props} frameBudget={false} />);
      expect(globe.pixelRatios.at(-1)).toBe(1.5);
    } finally {
      if (dpr) Object.defineProperty(window, 'devicePixelRatio', dpr);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });

  it('draws territory tops opaque on a phone, and leaves the walls as they are', () => {
    // A world map: translucent tops on the desktop (Space Age is solid already).
    const medieval = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_medieval.json'), 'utf8'));
    const territories = Object.fromEntries(
      medieval.territories.map((t: { territory_id: string }) => [t.territory_id, { owner_id: 'ai_1', unit_count: 3 }]),
    );
    act(() => { useGameStore.setState({ gameState: { ...gameState(), era: 'medieval', map_id: 'era_medieval', territories } as never }); });
    const props = { mapData: medieval, onTerritoryClick: () => {}, width: 390, height: 600, selfPlayerId: 'me', autoSpin: false, reducedEffects: true };
    const territory = { territory_id: medieval.territories[0].territory_id };
    const colours = () => ({
      top: (globe.props?.polygonCapColor as (p: object) => string)(territory),
      wall: (globe.props?.polygonSideColor as (p: object) => string)(territory),
    });
    const { unmount } = render(<GlobeMapCore {...props} frameBudget />);
    const phone = colours();
    unmount();
    render(<GlobeMapCore {...props} frameBudget={false} />);
    const desktop = colours();
    expect(phone.top).toBe('rgb(52, 152, 219)');
    expect(desktop.top).toBe('rgba(52, 152, 219, 0.96)');
    expect(phone.wall).toBe(desktop.wall);
    expect(phone.wall).toMatch(/^rgba\(.*, 0\.45\)$/);
  });

  it('asks for the low-power GPU on a phone, and leaves the desktop context alone', () => {
    const { unmount } = mount();
    expect(globe.props?.rendererConfig).toEqual({ powerPreference: 'low-power' });
    unmount();
    mount({ frameBudget: false, reducedEffects: false });
    expect(globe.props?.rendererConfig).toBeUndefined();
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
