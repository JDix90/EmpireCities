/**
 * The globe as a Split pane (GalaxySplitView): where it says its systems show,
 * its lane beams turned off, its targets read across lanes, and its effects
 * kept to its own world. react-globe.gl is a stand-in that records what the
 * component hands it and projects a point to (200 + Δlng, 150 − Δlat) from the
 * point under the camera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, act, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const globe = vi.hoisted(() => ({
  props: null as null | Record<string, unknown>,
  /** The one renderer the stand-in hands out, and whether it was let go. */
  renderer: { disposed: 0, contextsLost: 0 },
  /** Report ready while rendering, as a globe that loads before its render commits does. */
  readyWhileRendering: false,
  pov: { lat: 0, lng: 0, altitude: 2 },
  /** Every point of view the component asked for. */
  moves: [] as Array<Record<string, number>>,
  matrixUpdates: 0,
  controls: { autoRotate: false, autoRotateSpeed: 0, dampingFactor: 0.1, addEventListener: () => {}, removeEventListener: () => {} },
}));

vi.mock('react-globe.gl', async () => {
  const React = await import('react');
  const Globe = React.forwardRef((props: Record<string, unknown>, ref) => {
    globe.props = props;
    React.useImperativeHandle(ref, () => ({
      pauseAnimation: () => {},
      resumeAnimation: () => {},
      controls: () => globe.controls,
      pointOfView: (pov?: Partial<typeof globe.pov>) => {
        if (pov) {
          globe.moves.push({ ...pov });
          Object.assign(globe.pov, pov);
        }
        return { ...globe.pov };
      },
      getScreenCoords: (lat: number, lng: number) => ({ x: 200 + (lng - globe.pov.lng), y: 150 - (lat - globe.pov.lat) }),
      camera: () => ({ updateMatrixWorld: () => { globe.matrixUpdates += 1; } }),
      renderer: () => ({
        setPixelRatio: () => {},
        setSize: () => {},
        domElement: document.createElement('canvas'),
        dispose: () => { globe.renderer.disposed += 1; },
        forceContextLoss: () => { globe.renderer.contextsLost += 1; },
      }),
      toGlobeCoords: () => null,
    }));
    // Once, as react-globe.gl does: while rendering, or once mounted.
    const reported = React.useRef(false);
    if (globe.readyWhileRendering && !reported.current) {
      reported.current = true;
      (props.onGlobeReady as (() => void) | undefined)?.();
    }
    React.useEffect(() => {
      if (reported.current) return;
      reported.current = true;
      (props.onGlobeReady as (() => void) | undefined)?.();
    }, []);
    return React.createElement('div', { 'data-testid': 'globe-stub' });
  });
  return { default: Globe };
});
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));
// jsdom has no 2D canvas to paint a world's surface on.
vi.mock('../../utils/proceduralPlanet', async (actual) => ({
  ...(await actual<typeof import('../../utils/proceduralPlanet')>()),
  buildGalaxyWorldTextureFromPolygons: () => undefined,
}));

import { GlobeMapCore } from './GlobeMap';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { HIGHLIGHT_CSS } from '../../constants/highlightColors';
import { centralAngle } from '../../utils/globeScreenAnchor';
import { orbitLaneId } from '../../utils/galaxyLanes';

interface Territory { territory_id: string; world_id: string; geo_polygon: [number, number][] }
interface Connection { from: string; to: string; type: string }
const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Territory[];
  connections: Connection[];
};
const worldOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.world_id]));
const idsOn = (world: string) => galaxy.territories.filter((t) => t.world_id === world).map((t) => t.territory_id);
const lanes = galaxy.connections.filter((c) => c.type === 'orbit');
/** A lane from Sol III to Verdan Reach, and its two gateways. */
const lane = lanes.find((c) => [c.from, c.to].map((id) => worldOf.get(id)).sort().join() === 'sol,verdan')!;
const solGate = worldOf.get(lane.from) === 'sol' ? lane.from : lane.to;
const verdanGate = solGate === lane.from ? lane.to : lane.from;
/** Roughly where a territory sits on its globe: the mean of its outline. */
function near(id: string) {
  const ring = galaxy.territories.find((t) => t.territory_id === id)!.geo_polygon;
  return { lat: ring.reduce((s, p) => s + p[1], 0) / ring.length, lng: ring.reduce((s, p) => s + p[0], 0) / ring.length };
}

/** Sol is all the viewer's; every other world the AI's. Corridors on, as in a default game. */
function gameState(over: Record<string, unknown> = {}) {
  const territories: Record<string, { owner_id: string; unit_count: number }> = {};
  for (const t of galaxy.territories) {
    territories[t.territory_id] = { owner_id: t.world_id === 'sol' ? 'me' : 'ai_1', unit_count: 3 };
  }
  return {
    game_id: 'g1', era: 'galaxy_age', map_id: 'era_galaxy', phase: 'attack', turn_number: 5,
    current_player_index: 1,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Admiral Chen', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: { galaxy_corridors_enabled: true },
    ...over,
  };
}

function pane(props: Partial<Parameters<typeof GlobeMapCore>[0]> = {}) {
  return render(
    <GlobeMapCore
      mapData={galaxy as unknown as Parameters<typeof GlobeMapCore>[0]['mapData']}
      onTerritoryClick={() => {}}
      width={480}
      height={320}
      autoSpin={false}
      activeWorldId="verdan"
      {...props}
    />,
  );
}

const arcIds = () => (globe.props!.arcsData as Array<{ id: string }>).map((a) => a.id);
const ringIds = () => (globe.props!.ringsData as Array<{ id: string }>).map((r) => r.id);
/** The border colour the globe gives a territory's polygon. */
function stroke(id: string) {
  const polygon = (globe.props!.polygonsData as Array<{ territory_id: string }>).find((p) => p.territory_id === id);
  return polygon ? (globe.props!.polygonStrokeColor as (p: object) => string)(polygon) : undefined;
}

beforeEach(() => {
  globe.props = null;
  globe.renderer = { disposed: 0, contextsLost: 0 };
  globe.readyWhileRendering = false;
  globe.pov = { lat: 0, lng: 0, altitude: 2 };
  globe.moves = [];
  globe.matrixUpdates = 0;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, media: '', onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  act(() => {
    useGameStore.setState({ gameState: gameState() as never });
    useUiStore.setState({ selectedTerritory: null, attackSource: null });
  });
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    useGameStore.setState({ gameState: null });
    useUiStore.setState({ selectedTerritory: null, attackSource: null });
  });
});

describe('a Split globe: where its systems show', () => {
  it("reports each of its world's systems, in sight or round the back", () => {
    const report = vi.fn();
    pane({ onTerritoryCenters: report });
    const centers = report.mock.calls.at(-1)![0] as ReadonlyMap<string, { x: number; y: number; behind?: boolean }>;
    expect([...centers.keys()].sort()).toEqual(idsOn('verdan').sort());
    // Verdan opens on its authored view; a system well within the horizon is in
    // sight, one on the far side is not.
    const camera = { ...globe.pov };
    for (const id of idsOn('verdan')) {
      const angle = (centralAngle(camera.lat, camera.lng, near(id).lat, near(id).lng) * 180) / Math.PI;
      if (angle < 60) expect(centers.get(id)!.behind, id).toBeUndefined();
      if (angle > 100) expect(centers.get(id)!.behind, id).toBe(true);
    }
    // In sight: where the globe projects it.
    const inSight = [...centers].find(([, p]) => !p.behind)!;
    expect(inSight[1].x).toBeGreaterThan(0);
    expect(inSight[1].x).toBeLessThan(480);
  });

  it('reports again as its camera turns, with the camera brought up to date first', () => {
    const report = vi.fn();
    pane({ onTerritoryCenters: report });
    const before = report.mock.calls.length;
    const crown = idsOn('verdan').find((id) => id === 'verdan_photic_crown')!;
    expect((report.mock.calls.at(-1)![0] as Map<string, { behind?: boolean }>).get(crown)!.behind).toBe(true);
    // The player turns the globe to face Photic Crown.
    const updates = globe.matrixUpdates;
    act(() => {
      Object.assign(globe.pov, near(crown));
      (globe.props!.onZoom as (pov: object) => void)({ ...globe.pov });
    });
    expect(report.mock.calls.length).toBe(before + 1);
    expect(globe.matrixUpdates).toBe(updates + 1);
    const now = report.mock.calls.at(-1)![0] as Map<string, { x: number; y: number; behind?: boolean }>;
    expect(now.get(crown)!.behind).toBeUndefined();
  });

  it('turns the camera reports off for the single globe', () => {
    pane();
    expect(globe.props!.onZoom).toBeUndefined();
  });
});

describe('a Split globe: the lanes are the view\'s to draw', () => {
  const beams = () => arcIds().filter((id) => id.startsWith('gateway-lane-'));

  it('beams each lane off its gateway by default, and none when the view draws the lanes', () => {
    const { unmount } = pane();
    // Verdan Reach has two lanes to Sol III and two to Rust Belt.
    expect(beams()).toHaveLength(4);
    unmount();
    pane({ showOrbitStubs: false });
    expect(beams()).toEqual([]);
    // The gateway markers stay: they carry each lane's state.
    const markers = (globe.props!.htmlElementsData as Array<{ kind: string }>).filter((d) => d.kind === 'gateway-marker');
    expect(markers).toHaveLength(4);
  });
});

describe('a Split globe: targets across lanes', () => {
  it('lights the system a gateway on another world can strike', () => {
    act(() => { useUiStore.setState({ attackSource: solGate }); });
    pane({ targetsAcrossWorlds: true });
    expect(stroke(verdanGate)).toBe(HIGHLIGHT_CSS.attackTarget);
  });

  it('reaches a fortify through another world and across its lane', () => {
    // From deep in Sol III, through the viewer's own systems to the gateway,
    // and over the lane to the viewer's system on Verdan Reach.
    const deepInSol = idsOn('sol').find((id) => !lanes.some((c) => c.from === id || c.to === id))!;
    const state = gameState({ phase: 'fortify', current_player_index: 0 });
    state.territories[verdanGate]!.owner_id = 'me';
    act(() => {
      useGameStore.setState({ gameState: state as never });
      useUiStore.setState({ attackSource: deepInSol });
    });
    const { unmount } = pane({ targetsAcrossWorlds: true });
    expect(stroke(verdanGate)).toBe(HIGHLIGHT_CSS.fortifyTarget);
    unmount();
    // The single globe walks only its own world, so the route never starts.
    pane();
    expect(stroke(verdanGate)).not.toBe(HIGHLIGHT_CSS.fortifyTarget);
  });

  it('does not offer a lane sealed against the player', () => {
    act(() => {
      useGameStore.setState({
        gameState: gameState({
          lane_blockades: { [orbitLaneId(lane.from, lane.to)]: { owner_id: 'ai_1', turns_remaining: 1 } },
        }) as never,
      });
      useUiStore.setState({ attackSource: solGate });
    });
    pane({ targetsAcrossWorlds: true });
    expect(stroke(verdanGate)).not.toBe(HIGHLIGHT_CSS.attackTarget);
  });

  it('rings the gateways a player can act from across a lane, on its own world only', () => {
    // The viewer also holds a system deep in Verdan Reach, among the AI's: a
    // source too, but not on this globe.
    const deepInVerdan = idsOn('verdan').find((id) => !lanes.some((c) => c.from === id || c.to === id))!;
    const state = gameState({ current_player_index: 0 });
    state.territories[deepInVerdan]!.owner_id = 'me';
    act(() => { useGameStore.setState({ gameState: state as never }); });
    const sources = () => ringIds().filter((id) => id.startsWith('valid-source-')).map((id) => id.slice('valid-source-'.length));
    // Every Sol system is the viewer's, so Sol's only enemies are across its lanes.
    const solGates = new Set(lanes.flatMap((c) => [c.from, c.to]).filter((id) => worldOf.get(id) === 'sol'));
    const { unmount } = pane({ activeWorldId: 'sol', targetsAcrossWorlds: true, validSourceOwnerId: 'me' });
    expect(sources().sort()).toEqual([...solGates].sort());
    unmount();
    pane({ activeWorldId: 'sol', validSourceOwnerId: 'me' });
    expect(sources()).toEqual([]);
  });
});

describe("a Split globe: only its own world's effects", () => {
  const reinforce = (id: string, territoryId: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'reinforce' as const, territoryId, units: 2, playerColor: '#3498db', ...extra,
  });
  const playing = () => screen.getByTestId('globe-map-root').getAttribute('data-globe-playing');

  it("acknowledges another world's event and leaves it to that world's globe", () => {
    const onEventDone = vi.fn();
    pane({ ownWorldEffectsOnly: true, onEventDone, events: [reinforce('e1', solGate)] });
    expect(onEventDone).toHaveBeenCalledWith('e1');
    expect(playing()).toBeNull();
    expect(globe.moves.some((m) => m.altitude === 1.5)).toBe(false);
  });

  it("never queues another world's event behind its own", () => {
    pane({ ownWorldEffectsOnly: true, events: [reinforce('e7', verdanGate), reinforce('e8', solGate)] });
    // Verdan's own plays; Sol's never waits behind it, nor counts as queued.
    expect(playing()).toBe('true');
    expect(screen.getByTestId('globe-map-root').getAttribute('data-globe-queue-depth')).toBe('0');
  });

  it('plays its own, and an event bound to no world', () => {
    const onEventDone = vi.fn();
    const { unmount } = pane({ ownWorldEffectsOnly: true, onEventDone, events: [reinforce('e2', verdanGate)] });
    expect(onEventDone).toHaveBeenCalledWith('e2');
    expect(playing()).toBe('true');
    unmount();
    pane({ ownWorldEffectsOnly: true, events: [{ id: 'e3', type: 'event', territoryId: '__global__' }] });
    expect(playing()).toBe('true');
  });

  it('plays an event that touches its world through the territories it names', () => {
    pane({
      ownWorldEffectsOnly: true,
      events: [{ id: 'e4', type: 'event', territoryId: solGate, affectedTerritories: [{ territory_id: verdanGate, delta: -1 }] }],
    });
    expect(playing()).toBe('true');
  });

  it("strikes across a lane without an arc from the other world's coordinates", () => {
    vi.useFakeTimers();
    const attack = { id: 'e5', type: 'combat' as const, territoryId: verdanGate, fromTerritoryId: solGate, attackerColor: '#c0392b' };
    const { unmount } = pane({ events: [attack] });
    act(() => { vi.advanceTimersByTime(700); });
    // The single globe draws the attacker's arc from Sol III's coordinates, on Verdan.
    expect(arcIds().some((id) => id.startsWith('combat-arc'))).toBe(true);
    unmount();
    pane({ ownWorldEffectsOnly: true, events: [{ ...attack, id: 'e6' }] });
    act(() => { vi.advanceTimersByTime(700); });
    expect(arcIds().some((id) => id.startsWith('combat-arc'))).toBe(false);
  });

  it('pulses a loss only on the world it happened on', () => {
    pane({ ownWorldEffectsOnly: true, lossPulseTerritoryIds: [solGate, verdanGate] });
    expect(ringIds().filter((id) => id.startsWith('loss-'))).toEqual([`loss-${verdanGate}`]);
  });
});

describe('a Split globe: coming and going', () => {
  it('gives its WebGL context back when it goes for good, not on a rehearsal', () => {
    vi.useFakeTimers();
    // StrictMode unmounts and mounts every component once as it first mounts.
    const { unmount } = render(
      <StrictMode>
        <GlobeMapCore
          mapData={galaxy as unknown as Parameters<typeof GlobeMapCore>[0]['mapData']}
          onTerritoryClick={() => {}}
          width={480}
          height={320}
          autoSpin={false}
          activeWorldId="verdan"
          releaseContextOnUnmount
        />
      </StrictMode>,
    );
    act(() => { vi.advanceTimersByTime(10); });
    expect(globe.renderer).toEqual({ disposed: 0, contextsLost: 0 });
    unmount();
    act(() => { vi.advanceTimersByTime(10); });
    expect(globe.renderer).toEqual({ disposed: 1, contextsLost: 1 });
  });

  it('leaves the single globe to be collected', () => {
    vi.useFakeTimers();
    const { unmount } = pane();
    unmount();
    act(() => { vi.advanceTimersByTime(10); });
    expect(globe.renderer).toEqual({ disposed: 0, contextsLost: 0 });
  });

  it('holds a ready report that comes before its render commits', () => {
    globe.readyWhileRendering = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onGlobeReady = vi.fn();
    const report = vi.fn();
    pane({ onGlobeReady, onTerritoryCenters: report });
    expect(errors).not.toHaveBeenCalled();
    expect(onGlobeReady).toHaveBeenCalled();
    // Mounted, then ready: it reports where its systems show again once ready.
    expect(report.mock.calls.length).toBeGreaterThanOrEqual(2);
    errors.mockRestore();
  });
});
