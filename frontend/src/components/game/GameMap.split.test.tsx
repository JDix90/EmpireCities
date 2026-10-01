/**
 * The 2D map as a Split pane (GalaxySplitView): its view held still, and its
 * targets read across the lanes to the other worlds. PixiJS is the shared fake
 * (test/fakePixi.ts), which records each territory's border colour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('pixi.js', async () => (await import('../../test/fakePixi')).pixi.module);
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import GameMap from './GameMap';
import { pixi } from '../../test/fakePixi';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { HIGHLIGHT_PIXI } from '../../constants/highlightColors';
import { orbitLaneId } from '../../utils/galaxyLanes';

interface Territory { territory_id: string; world_id: string }
interface Connection { from: string; to: string; type: string }
const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Territory[];
  connections: Connection[];
};
const worldOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.world_id]));
const lanes = galaxy.connections.filter((c) => c.type === 'orbit');

/** A lane from Sol to Verdan Reach: the viewer's gateway on Sol, the AI's across it. */
const lane = lanes.find((c) => new Set([worldOf.get(c.from), worldOf.get(c.to)]).size === 2
  && [c.from, c.to].some((id) => worldOf.get(id) === 'sol')
  && [c.from, c.to].some((id) => worldOf.get(id) === 'verdan'))!;
const solGate = worldOf.get(lane.from) === 'sol' ? lane.from : lane.to;
/** Every Sol system a lane leaves from. */
const solGates = new Set(
  lanes.flatMap((c) => [c.from, c.to]).filter((id) => worldOf.get(id) === 'sol'),
);

/** Sol is all the viewer's; every other world is the AI's. Corridors on, as in a default game. */
function gameState(over: Record<string, unknown> = {}) {
  const territories: Record<string, { owner_id: string; unit_count: number }> = {};
  for (const t of galaxy.territories) {
    territories[t.territory_id] = { owner_id: t.world_id === 'sol' ? 'me' : 'ai_1', unit_count: 3 };
  }
  return {
    game_id: 'g1', era: 'galaxy_age', map_id: 'era_galaxy', phase: 'attack', turn_number: 5,
    current_player_index: 0,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Admiral Chen', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: { galaxy_corridors_enabled: true },
    ...over,
  };
}

const NO_EVENTS: never[] = [];
function pane(props: Partial<Parameters<typeof GameMap>[0]> = {}) {
  return render(
    <GameMap
      mapData={galaxy as unknown as Parameters<typeof GameMap>[0]['mapData']}
      onTerritoryClick={() => {}}
      width={480}
      height={320}
      mapVisualEvents={NO_EVENTS}
      {...props}
    />,
  );
}

/** Territory shapes (the ones with hover handlers) last drawn with this border colour. */
function bordered(color: number): number {
  return pixi.created.graphicsList
    .filter((g) => g.handlers.includes('pointerover'))
    .filter((g) => g.ops.some((op) => op.split(':')[2] === String(color)))
    .length;
}

beforeEach(() => {
  pixi.created.graphics = 0;
  pixi.created.graphicsList.length = 0;
  pixi.created.tickers.length = 0;
  pixi.created.apps.length = 0;
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
  act(() => {
    useGameStore.setState({ gameState: null });
    useUiStore.setState({ selectedTerritory: null, attackSource: null });
  });
});

describe('a Split pane: targets across lanes', () => {
  it("lights the system a gateway on another world can strike", () => {
    act(() => { useUiStore.setState({ attackSource: solGate }); });
    pane({ activeWorldId: 'verdan', targetsAcrossWorlds: true });
    expect(bordered(HIGHLIGHT_PIXI.attackTarget)).toBe(1);
  });

  it('leaves the single-world map as it was: only its own world lights', () => {
    act(() => { useUiStore.setState({ attackSource: solGate }); });
    pane({ activeWorldId: 'verdan' });
    expect(bordered(HIGHLIGHT_PIXI.attackTarget)).toBe(0);
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
    pane({ activeWorldId: 'verdan', targetsAcrossWorlds: true });
    expect(bordered(HIGHLIGHT_PIXI.attackTarget)).toBe(0);
  });

  it("outlines the gateways a player can act from across a lane", () => {
    // Every Sol system is the viewer's, so Sol's only enemies are across its lanes.
    pane({ activeWorldId: 'sol', targetsAcrossWorlds: true, validSourceOwnerId: 'me' });
    expect(bordered(HIGHLIGHT_PIXI.validSource)).toBe(solGates.size);
  });

  it('outlines none of them on the single-world map, which cannot see across', () => {
    pane({ activeWorldId: 'sol', validSourceOwnerId: 'me' });
    expect(bordered(HIGHLIGHT_PIXI.validSource)).toBe(0);
  });
});

describe('a Split pane: held still', () => {
  const stage = () => {
    const app = pixi.created.apps[0]!;
    return { view: app.view, mapContainer: app.stage.children[0]! };
  };

  it('ignores the wheel, a drag and a double tap, and leaves the wheel to the page', () => {
    pane({ activeWorldId: 'sol', lockCamera: true });
    const { view, mapContainer } = stage();
    expect(fireEvent.wheel(view, { deltaY: -100 })).toBe(true);
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 160, clientY: 140 });
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 160, clientY: 140 });
    expect([mapContainer.scale.x, mapContainer.x, mapContainer.y]).toEqual([1, 0, 0]);
  });

  it('ignores a pinch, and the one-finger drag left when a finger lifts', () => {
    pane({ activeWorldId: 'sol', lockCamera: true });
    const { view, mapContainer } = stage();
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 260, clientY: 100 });
    expect(mapContainer.scale.x).toBe(1);
    fireEvent.pointerUp(view, { pointerId: 2, clientX: 260, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 150, clientY: 130 });
    expect([mapContainer.x, mapContainer.y]).toEqual([0, 0]);
  });

  it('an unlocked map still zooms and pans', () => {
    pane({ activeWorldId: 'sol' });
    const { view, mapContainer } = stage();
    expect(fireEvent.wheel(view, { deltaY: -100 })).toBe(false);
    expect(mapContainer.scale.x).toBeCloseTo(1.1);
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 160, clientY: 140 });
    expect([mapContainer.x, mapContainer.y]).toEqual([60, 40]);
  });
});

describe('a Split pane: the lanes are the view\'s to draw', () => {
  /** The lane stubs' labels ("→ Rust"), which sit with the names. */
  const stubLabels = () => {
    const labels = pixi.created.apps[0]!.stage.children[1]!;
    return labels.children
      .map((c) => (c as unknown as { text?: string }).text)
      .filter((t): t is string => typeof t === 'string' && t.startsWith('→'));
  };

  it("reports where it drew each of its world's systems, on its canvas", () => {
    const report = vi.fn();
    pane({ activeWorldId: 'verdan', onTerritoryCenters: report });
    const centers = report.mock.calls.at(-1)![0] as ReadonlyMap<string, { x: number; y: number }>;
    const verdan = galaxy.territories.filter((t) => t.world_id === 'verdan').map((t) => t.territory_id);
    expect([...centers.keys()].sort()).toEqual([...verdan].sort());
    for (const p of centers.values()) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(480);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(320);
    }
  });

  it('draws its lane stubs by default, and none when the view draws the lanes', () => {
    pane({ activeWorldId: 'verdan' });
    // Verdan Reach has two lanes to Sol III and two to Rust Belt.
    expect(stubLabels()).toHaveLength(4);
    pixi.created.apps.length = 0;
    pane({ activeWorldId: 'verdan', showOrbitStubs: false });
    expect(stubLabels()).toEqual([]);
  });
});
