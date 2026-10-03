import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Each pane's map as GalaxySplitView last rendered it, by world, in the order the panes render. */
const maps = vi.hoisted(() => new Map<string, Record<string, unknown>>());
/** Where every mock map says it drew each of its systems. */
const DRAWN_AT = { x: 100, y: 50 };
vi.mock('./GameMap', async () => {
  const { useEffect } = await import('react');
  return {
    // Named, so the hooks linter sees a component rather than a function called "default".
    default: function MockGameMap(props: Record<string, unknown>) {
      const world = props.activeWorldId as string;
      maps.set(world, props);
      useEffect(() => {
        const territories = (props.mapData as { territories: Array<{ territory_id: string; world_id: string }> }).territories;
        const report = props.onTerritoryCenters as ((c: ReadonlyMap<string, { x: number; y: number }>) => void) | undefined;
        report?.(new Map(territories.filter((t) => t.world_id === world).map((t) => [t.territory_id, DRAWN_AT])));
      }, [world]);
      return (
        <button
          type="button"
          data-testid={`map-${world}`}
          onClick={() => (props.onTerritoryClick as (id: string) => void)(`${world}_1`)}
        />
      );
    },
  };
});

/** Each globe pane as GalaxySplitView last rendered it, by world. */
const globes = vi.hoisted(() => new Map<string, Record<string, unknown>>());
/** Gateways the globe stubs report round the back of their planet. */
const turnedAway = vi.hoisted(() => new Set<string>());
/** Each globe's own "skip animations", by world. */
const globeSkips = vi.hoisted(() => new Map<string, () => void>());
vi.mock('./GlobeMap', async () => {
  const { useEffect } = await import('react');
  const { vi: v } = await import('vitest');
  function GlobeStub(props: Record<string, unknown>) {
    const world = props.activeWorldId as string;
    globes.set(world, props);
    useEffect(() => {
      const territories = (props.mapData as { territories: Array<{ territory_id: string; world_id: string }> }).territories;
      const report = props.onTerritoryCenters as ((c: ReadonlyMap<string, object>) => void) | undefined;
      report?.(new Map(territories.filter((t) => t.world_id === world).map((t) => [
        t.territory_id,
        turnedAway.has(t.territory_id) ? { x: 20, y: 30, behind: true } : { x: 100, y: 50 },
      ])));
      const skip = v.fn();
      globeSkips.set(world, skip);
      const ref = props.skipAnimationsRef as { current: (() => void) | null };
      ref.current = skip;
      return () => { ref.current = null; };
    }, [world]);
    return <div data-testid={`globe-${world}`} />;
  }
  return { default: GlobeStub, GlobeMapCore: GlobeStub };
});
const webgl = vi.hoisted(() => ({ available: true }));
vi.mock('../../utils/webglSupport', () => ({ webglAvailable: () => webgl.available }));
vi.mock('../../utils/proceduralPlanet', () => ({ proceduralWorldTextureUrl: (w: string) => `procedural:${w}` }));

import GalaxySplitView, { SPLIT_GAP_PX, SPLIT_HEADER_PX, type SplitPaneGlobeProps, type SplitPaneMapProps } from './GalaxySplitView';
import type { GameState } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { LANE_COLORS } from './galaxyLaneStyle';
import { orbitLaneId } from '../../utils/galaxyLanes';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8'));
const solIds: string[] = galaxy.territories
  .filter((t: { world_id: string }) => t.world_id === 'sol')
  .map((t: { territory_id: string }) => t.territory_id);

/** Sol: 6 the viewer's, 4 the AI's, 6 unclaimed. Every other world the AI's. */
function gameState(): GameState {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  for (const t of galaxy.territories as Array<{ territory_id: string; world_id: string }>) {
    territories[t.territory_id] = { owner_id: t.world_id === 'sol' ? null : 'ai_1', unit_count: 2 };
  }
  solIds.slice(0, 6).forEach((id) => { territories[id] = { owner_id: 'me', unit_count: 3 }; });
  solIds.slice(6, 10).forEach((id) => { territories[id] = { owner_id: 'ai_1', unit_count: 3 }; });
  return {
    game_id: 'g1', era: 'galaxy_age', map_id: 'era_galaxy', phase: 'attack', turn_number: 4,
    players: [
      { player_id: 'me', username: 'Me', color: '#c0392b', is_ai: false },
      { player_id: 'ai_1', username: 'Admiral Chen', color: '#3498db', is_ai: true },
    ],
    territories,
    settings: {},
  } as unknown as GameState;
}

const onTerritoryClick = vi.fn();
const events: never[] = [];
const mapProps: SplitPaneMapProps = {
  onTerritoryClick,
  mapVisualEvents: events,
  validSourceOwnerId: 'me',
  connectionHintMode: 'borders',
  frameBudget: false,
};

function show(over: Partial<Parameters<typeof GalaxySplitView>[0]> = {}) {
  const onOpenWorld = vi.fn();
  render(
    <GalaxySplitView
      mapData={galaxy}
      gameState={gameState()}
      width={1000}
      height={700}
      viewerPlayerId="me"
      mapProps={mapProps}
      onOpenWorld={onOpenWorld}
      {...over}
    />,
  );
  return { onOpenWorld };
}

/** The panes in the order they render, with the grid cell each sits in. */
function panes() {
  return screen.getAllByRole('region').map((el) => ({
    name: el.getAttribute('aria-label'),
    cell: [el.style.gridRow, el.style.gridColumn],
  }));
}

beforeEach(() => {
  maps.clear();
  globes.clear();
  turnedAway.clear();
  globeSkips.clear();
  webgl.available = true;
  onTerritoryClick.mockReset();
  useUiStore.setState({ selectedTerritory: null, attackSource: null });
});

afterEach(() => {
  act(() => { useUiStore.setState({ selectedTerritory: null, attackSource: null }); });
});

describe('GalaxySplitView', () => {
  it("shows every world's map at once, in the chart's ring order", () => {
    show();
    expect(panes()).toEqual([
      { name: 'Sol III', cell: ['1', '1'] },
      { name: 'Verdan Reach', cell: ['1', '2'] },
      { name: 'Rust Belt', cell: ['2', '2'] },
      { name: 'Nexus Station', cell: ['2', '1'] },
    ]);
  });

  it('draws each world on a held-still map that reads targets across lanes', () => {
    show();
    const paneWidth = Math.floor((1000 - SPLIT_GAP_PX) / 2);
    const paneHeight = Math.floor((700 - SPLIT_GAP_PX) / 2) - SPLIT_HEADER_PX;
    expect([...maps.keys()]).toEqual(['sol', 'verdan', 'rust', 'nexus_station']);
    for (const m of maps.values()) {
      expect(m).toMatchObject({
        mapData: galaxy,
        width: paneWidth,
        height: paneHeight,
        lockCamera: true,
        targetsAcrossWorlds: true,
        ambientEnabled: false,
        // The view draws whole lanes across the panes instead.
        showOrbitStubs: false,
        // The single map's props, passed through untouched.
        mapVisualEvents: events,
        validSourceOwnerId: 'me',
        connectionHintMode: 'borders',
      });
      expect(m).not.toHaveProperty('resetViewRef');
    }
    // A click in any pane is the game's own click.
    fireEvent.click(screen.getByTestId('map-rust'));
    expect(onTerritoryClick).toHaveBeenCalledWith('rust_1');
  });

  it("heads each pane with the world's owners and the viewer's count", () => {
    show();
    const sol = screen.getByRole('region', { name: 'Sol III' });
    const bar = within(sol).getByRole('img');
    expect(bar).toHaveAccessibleName('Sol III, 16 systems: You 6, Admiral Chen 4, unclaimed 6');
    const segments = [...bar.children].map((el) => [
      (el as HTMLElement).style.flexGrow,
      (el as HTMLElement).style.backgroundColor,
    ]);
    // Owners in their colours, most systems first; the unclaimed rest is bare track.
    expect(segments).toEqual([['6', 'rgb(192, 57, 43)'], ['4', 'rgb(52, 152, 219)'], ['6', '']]);
    expect(within(sol).getByText('6/16')).toBeInTheDocument();
    // A world the viewer holds nothing on shows no count for them.
    const rust = screen.getByRole('region', { name: 'Rust Belt' });
    expect(within(rust).getByRole('img')).toHaveAccessibleName('Rust Belt, 16 systems: Admiral Chen 16');
    expect(within(rust).queryByText(/\/16$/)).toBeNull();
  });

  it('opens a world on its own', () => {
    const { onOpenWorld } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Open Verdan Reach' }));
    expect(onOpenWorld).toHaveBeenCalledWith('verdan');
  });

  it('shows only the worlds in play, two side by side', () => {
    const inPlay = {
      ...galaxy,
      territories: galaxy.territories.filter((t: { world_id: string }) => t.world_id === 'sol' || t.world_id === 'verdan'),
    };
    show({ mapData: inPlay });
    expect(panes()).toEqual([
      { name: 'Sol III', cell: ['1', '1'] },
      { name: 'Verdan Reach', cell: ['1', '2'] },
    ]);
    expect(maps.get('sol')).toMatchObject({
      width: Math.floor((1000 - SPLIT_GAP_PX) / 2),
      height: 700 - SPLIT_HEADER_PX,
    });
  });
});

describe('GalaxySplitView: the lanes across the panes', () => {
  interface Connection { from: string; to: string; type: string }
  const worldOf = new Map(
    (galaxy.territories as Array<{ territory_id: string; world_id: string }>).map((t) => [t.territory_id, t.world_id]),
  );
  const lanes = (galaxy.connections as Connection[]).filter((c) => c.type === 'orbit');
  const between = (a: string, b: string) => lanes.filter((c) => {
    const ws = [worldOf.get(c.from), worldOf.get(c.to)];
    return ws.includes(a) && ws.includes(b);
  });
  /** Sol to Verdan: the viewer holds both ends of one, one end of the other. Rust to Nexus: sealed. */
  const [corridor, open] = between('sol', 'verdan') as [Connection, Connection];
  const sealed = between('rust', 'nexus_station')[0]!;

  function laneState(): GameState {
    const state = gameState();
    for (const id of Object.keys(state.territories)) state.territories[id]!.owner_id = 'ai_1';
    state.territories[corridor.from]!.owner_id = 'me';
    state.territories[corridor.to]!.owner_id = 'me';
    state.territories[open.from]!.owner_id = 'me';
    (state as unknown as { lane_blockades: object }).lane_blockades = {
      [orbitLaneId(sealed.from, sealed.to)]: { owner_id: 'ai_1', turns_remaining: 1 },
    };
    return state;
  }

  const lane = (c: Connection) =>
    screen.getByTestId('galaxy-split-lanes').querySelector(`g[data-lane="${orbitLaneId(c.from, c.to)}"]`)!;
  const stroke = (c: Connection) => lane(c).querySelector('line')!.getAttribute('stroke');

  it('runs every lane from gateway to gateway, across the gap between panes', () => {
    show();
    const drawn = screen.getByTestId('galaxy-split-lanes').querySelectorAll('g[data-lane]');
    expect(drawn).toHaveLength(lanes.length);
    // Sol III's pane is top left, Verdan Reach's top right: each end is its
    // pane's corner, below the header and inside the map's border, plus where
    // the map drew the gateway.
    const paneWidth = Math.floor((1000 - SPLIT_GAP_PX) / 2);
    const at = (world: string) => world === 'sol'
      ? [1 + DRAWN_AT.x, SPLIT_HEADER_PX + 1 + DRAWN_AT.y]
      : [paneWidth + SPLIT_GAP_PX + 1 + DRAWN_AT.x, SPLIT_HEADER_PX + 1 + DRAWN_AT.y];
    const line = lane(corridor).querySelector('line')!;
    expect([line.getAttribute('x1'), line.getAttribute('y1')].map(Number)).toEqual(at(worldOf.get(corridor.from)!));
    expect([line.getAttribute('x2'), line.getAttribute('y2')].map(Number)).toEqual(at(worldOf.get(corridor.to)!));
  });

  it("draws each lane as the chart does: the viewer's corridor, an open lane, a seal", () => {
    show({ gameState: laneState() });
    expect(stroke(corridor)).toBe('#c0392b');
    expect(stroke(open)).toBe(LANE_COLORS.open);
    expect(stroke(sealed)).toBe(LANE_COLORS.sealed);
    // The rest the viewer holds no end of.
    expect(stroke(between('verdan', 'rust')[0]!)).toBe(LANE_COLORS.closed);
  });

  it("makes the picked gateway's lane stand out", () => {
    useUiStore.setState({ attackSource: open.from });
    show({ gameState: laneState() });
    expect(lane(open)).toHaveAttribute('data-picked', 'true');
    expect(lane(open)).toHaveAttribute('opacity', '1');
    expect(lane(open).querySelector('line')).toHaveAttribute('stroke-width', String(1.8 + 1.2));
    expect(lane(corridor)).not.toHaveAttribute('data-picked');
    expect(lane(corridor)).toHaveAttribute('opacity', '0.75');
  });

  it('shows every unsealed lane locked to a viewer who cannot cross', () => {
    show({ gameState: laneState(), laneAccessAllowed: false });
    expect(stroke(corridor)).toBe(LANE_COLORS.gated);
    expect(stroke(open)).toBe(LANE_COLORS.gated);
    expect(stroke(sealed)).toBe(LANE_COLORS.sealed);
  });
});

describe('GalaxySplitView: globe panes', () => {
  interface Connection { from: string; to: string; type: string }
  const worldOf = new Map(
    (galaxy.territories as Array<{ territory_id: string; world_id: string }>).map((t) => [t.territory_id, t.world_id]),
  );
  const solToVerdan = (galaxy.connections as Connection[]).find((c) => c.type === 'orbit'
    && new Set([worldOf.get(c.from), worldOf.get(c.to)]).size === 2
    && [c.from, c.to].every((id) => ['sol', 'verdan'].includes(worldOf.get(id)!)))!;
  const solGate = worldOf.get(solToVerdan.from) === 'sol' ? solToVerdan.from : solToVerdan.to;

  const events: never[] = [];
  function globeProps(over: Partial<SplitPaneGlobeProps> = {}): SplitPaneGlobeProps {
    return {
      onTerritoryClick,
      events,
      onEventDone: vi.fn(),
      autoSpin: true,
      cameraFollow: false,
      selfPlayerId: 'me',
      validSourceOwnerId: 'me',
      connectionHintMode: 'borders',
      onGlobeReady: vi.fn(),
      skipAnimationsRef: { current: null },
      ...over,
    };
  }
  const lane = (c: Connection) =>
    screen.getByTestId('galaxy-split-lanes').querySelector(`g[data-lane="${orbitLaneId(c.from, c.to)}"]`)!;

  it("draws each world as its own globe in the Globe view, dressed as that world", async () => {
    const props = globeProps();
    show({ globeProps: props });
    await screen.findByTestId('globe-nexus_station');
    expect([...globes.keys()]).toEqual(['sol', 'verdan', 'rust', 'nexus_station']);
    expect(maps.size).toBe(0);
    const paneWidth = Math.floor((1000 - SPLIT_GAP_PX) / 2);
    const paneHeight = Math.floor((700 - SPLIT_GAP_PX) / 2) - SPLIT_HEADER_PX;
    for (const g of globes.values()) {
      expect(g).toMatchObject({
        mapData: galaxy,
        width: paneWidth,
        height: paneHeight,
        targetsAcrossWorlds: true,
        ownWorldEffectsOnly: true,
        showOrbitStubs: false,
        ambientEnabled: false,
        // Four at a time: each hands its WebGL context back when it goes.
        releaseContextOnUnmount: true,
        // The single globe's props, passed through untouched.
        onTerritoryClick,
        events,
        autoSpin: true,
        cameraFollow: false,
        selfPlayerId: 'me',
        validSourceOwnerId: 'me',
        // Procedural worlds carry no bump map.
        bumpImageUrl: '',
      });
      // The view's own, for the whole of it.
      expect(g.onGlobeReady).not.toBe(props.onGlobeReady);
      expect(g.skipAnimationsRef).not.toBe(props.skipAnimationsRef);
    }
    // Each in its own world's surface, atmosphere and void.
    expect(globes.get('verdan')).toMatchObject({
      globeImageUrl: 'procedural:verdan',
      atmosphereColor: '#7fe7a3',
      atmosphereAltitude: 0.24,
      backgroundColor: 'rgb(8, 24, 18)',
    });
    expect(globes.get('rust')).toMatchObject({ globeImageUrl: 'procedural:rust', atmosphereColor: '#d97a3c' });
  });

  it('runs the lanes to the globes, dimmed and to the edge where a gateway is round the back', async () => {
    turnedAway.add(solGate);
    show({ gameState: gameState(), globeProps: globeProps() });
    await screen.findByTestId('globe-nexus_station');
    const g = lane(solToVerdan);
    expect(g).toHaveAttribute('data-out-of-sight', 'true');
    expect(g).toHaveAttribute('opacity', String(0.75 * 0.5));
    // A globe has no border: its canvas starts at its pane's corner.
    const paneWidth = Math.floor((1000 - SPLIT_GAP_PX) / 2);
    const line = g.querySelector('line')!;
    const ends = [[line.getAttribute('x1'), line.getAttribute('y1')], [line.getAttribute('x2'), line.getAttribute('y2')]]
      .map((p) => p.map(Number));
    const solEnd = worldOf.get(solToVerdan.from) === 'sol' ? ends[0] : ends[1];
    const verdanEnd = worldOf.get(solToVerdan.from) === 'sol' ? ends[1] : ends[0];
    expect(solEnd).toEqual([20, SPLIT_HEADER_PX + 30]);
    expect(verdanEnd).toEqual([paneWidth + SPLIT_GAP_PX + 100, SPLIT_HEADER_PX + 50]);
    // The gateway in sight keeps its dot; the one round the back has none.
    const dots = [...g.querySelectorAll('circle')].map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    expect(dots).toEqual([verdanEnd]);
    // A lane with both gateways in sight is drawn as on the flat maps.
    const other = (galaxy.connections as Connection[]).find((c) => c.type === 'orbit'
      && [c.from, c.to].every((id) => ['rust', 'nexus_station'].includes(worldOf.get(id)!)))!;
    expect(lane(other)).not.toHaveAttribute('data-out-of-sight');
    expect(lane(other)).toHaveAttribute('opacity', '0.75');
    expect(lane(other).querySelectorAll('circle')).toHaveLength(2);
  });

  it('tells the turn clock once every globe is drawn', async () => {
    const props = globeProps();
    show({ globeProps: props });
    await screen.findByTestId('globe-nexus_station');
    const ready = (w: string) => act(() => { (globes.get(w)!.onGlobeReady as () => void)(); });
    ready('sol');
    ready('verdan');
    ready('rust');
    expect(props.onGlobeReady).not.toHaveBeenCalled();
    ready('nexus_station');
    expect(props.onGlobeReady).toHaveBeenCalledTimes(1);
    ready('sol');
    expect(props.onGlobeReady).toHaveBeenCalledTimes(1);
  });

  it("skips every globe's queued animations from the page's one control", async () => {
    const props = globeProps();
    const { unmount } = render(
      <GalaxySplitView mapData={galaxy} gameState={gameState()} width={1000} height={700} mapProps={mapProps} globeProps={props} onOpenWorld={() => {}} />,
    );
    await screen.findByTestId('globe-nexus_station');
    act(() => { props.skipAnimationsRef!.current!(); });
    expect([...globeSkips.values()].map((skip) => (skip as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1, 1]);
    unmount();
    expect(props.skipAnimationsRef!.current).toBeNull();
  });

  it('shows one message where the browser has no WebGL, ready at once', () => {
    webgl.available = false;
    const props = globeProps();
    show({ globeProps: props });
    // Neither the globes nor the flat maps can draw: PixiJS needs WebGL too.
    expect(globes.size).toBe(0);
    expect(maps.size).toBe(0);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent("This browser can't draw the map");
    expect(screen.queryByTestId('galaxy-split-lanes')).toBeNull();
    // The turn clock is not left waiting on globes that will never draw.
    expect(props.onGlobeReady).toHaveBeenCalledTimes(1);
    expect(props.skipAnimationsRef!.current).toBeNull();
  });

  it('shows the same message in the 2D view', () => {
    webgl.available = false;
    show();
    expect(maps.size).toBe(0);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
