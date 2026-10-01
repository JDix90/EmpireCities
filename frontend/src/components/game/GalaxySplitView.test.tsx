import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Each pane's map, as GalaxySplitView rendered it. */
const maps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('./GameMap', () => ({
  default: (props: Record<string, unknown>) => {
    maps.push(props);
    const world = props.activeWorldId as string;
    return (
      <button
        type="button"
        data-testid={`map-${world}`}
        onClick={() => (props.onTerritoryClick as (id: string) => void)(`${world}_1`)}
      />
    );
  },
}));

import GalaxySplitView, { SPLIT_GAP_PX, SPLIT_HEADER_PX, type SplitPaneMapProps } from './GalaxySplitView';
import type { GameState } from '../../store/gameStore';

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
  maps.length = 0;
  onTerritoryClick.mockReset();
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
    expect(maps.map((m) => m.activeWorldId)).toEqual(['sol', 'verdan', 'rust', 'nexus_station']);
    for (const m of maps) {
      expect(m).toMatchObject({
        mapData: galaxy,
        width: paneWidth,
        height: paneHeight,
        lockCamera: true,
        targetsAcrossWorlds: true,
        ambientEnabled: false,
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
    expect(maps[0]).toMatchObject({
      width: Math.floor((1000 - SPLIT_GAP_PX) / 2),
      height: 700 - SPLIT_HEADER_PX,
    });
  });
});
