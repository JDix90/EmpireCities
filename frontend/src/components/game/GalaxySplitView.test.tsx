import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Each pane's map as GalaxySplitView last rendered it, by world, in the order the panes render. */
const maps = vi.hoisted(() => new Map<string, Record<string, unknown>>());
/** Where every mock map says it drew each of its systems. */
const DRAWN_AT = { x: 100, y: 50 };
vi.mock('./GameMap', async () => {
  const { useEffect } = await import('react');
  return {
    default: (props: Record<string, unknown>) => {
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

import GalaxySplitView, { SPLIT_GAP_PX, SPLIT_HEADER_PX, type SplitPaneMapProps } from './GalaxySplitView';
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
  onTerritoryClick.mockReset();
  useUiStore.setState({ selectedTerritory: null, attackSource: null });
});

afterEach(() => {
  useUiStore.setState({ selectedTerritory: null, attackSource: null });
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
