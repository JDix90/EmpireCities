/**
 * Flat map gestures (`map_gestures_v2_enabled`), driven through the canvas's
 * pointer events with PixiJS replaced by the shared fake. A pinch used to
 * scale the board around its top-left corner, panning had no bounds, and the
 * first finger of a pinch could complete a double-tap: on a phone the board
 * slid off-screen and only Reset brought it back.
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
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const spaceAge = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_space_age.json'), 'utf8'));

function gameState() {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  spaceAge.territories.forEach((t: { territory_id: string }, i: number) => {
    territories[t.territory_id] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: 3 };
  });
  return {
    game_id: 'g1', era: 'space_age', map_id: 'era_space_age', phase: 'attack', turn_number: 3,
    current_player_index: 0,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Admiral Chen', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: {},
  };
}

const NO_EVENTS: never[] = [];
const onClick = () => {};
const W = 390;
const H = 600;

function renderMap(gesturesV2: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, map_gestures_v2_enabled: gesturesV2 } }));
  render(
    <GameMap
      mapData={spaceAge}
      onTerritoryClick={onClick}
      width={W}
      height={H}
      mapVisualEvents={NO_EVENTS}
      frameBudget={false}
      reducedEffects={false}
    />,
  );
  const app = pixi.created.apps[0];
  // The first layer the map adds to the stage is the one every gesture moves.
  const board = app.stage.children[0] as unknown as { x: number; y: number; scale: { x: number } };
  return { view: app.view, board };
}

const down = (view: HTMLCanvasElement, pointerId: number, x: number, y: number) =>
  fireEvent.pointerDown(view, { pointerId, clientX: x, clientY: y });
const move = (view: HTMLCanvasElement, pointerId: number, x: number, y: number) =>
  fireEvent.pointerMove(view, { pointerId, clientX: x, clientY: y });
const up = (view: HTMLCanvasElement, pointerId: number, x: number, y: number) =>
  fireEvent.pointerUp(view, { pointerId, clientX: x, clientY: y });

/** Where board point p sits on screen. */
const onScreen = (board: { x: number; y: number; scale: { x: number } }, p: { x: number; y: number }) => ({
  x: board.x + p.x * board.scale.x,
  y: board.y + p.y * board.scale.x,
});

describe('GameMap gestures', () => {
  beforeEach(() => {
    pixi.created.apps.length = 0;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, media: '', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    act(() => { useGameStore.setState({ gameState: gameState() as never }); });
  });
  afterEach(() => {
    act(() => { useGameStore.setState({ gameState: null }); });
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, map_gestures_v2_enabled: false } }));
  });

  it('pinch zooms around the point between the fingers', () => {
    const { view, board } = renderMap(true);
    down(view, 1, 150, 300);
    down(view, 2, 250, 300);
    // Fingers spread to twice the distance, the midpoint drifting right.
    move(view, 2, 350, 300);
    expect(board.scale.x).toBe(2);
    // The land that was between the fingers (200, 300) is between them still.
    expect(onScreen(board, { x: 200, y: 300 })).toEqual({ x: 250, y: 300 });
  });

  it('off, pinch scales around the corner as before', () => {
    const { view, board } = renderMap(false);
    down(view, 1, 150, 300);
    down(view, 2, 250, 300);
    move(view, 2, 350, 300);
    expect(board.scale.x).toBe(2);
    expect({ x: board.x, y: board.y }).toEqual({ x: 0, y: 0 });
  });

  it('a fling keeps a strip of land on screen', () => {
    const { view, board } = renderMap(true);
    down(view, 1, 100, 100);
    move(view, 1, 5000, 5000);
    up(view, 1, 5000, 5000);
    // The land's top-left corner stops 96px inside the canvas's far edges:
    // tighter than the canvas box, since the land does not fill the canvas.
    expect(board.x).toBeLessThanOrEqual(W - 96);
    expect(board.y).toBeLessThanOrEqual(H - 96);
    expect(board.x).toBeGreaterThan(-W);
    expect(board.y).toBeGreaterThan(-H);
    // And the far fling the other way stops too.
    down(view, 1, 300, 300);
    move(view, 1, -5000, -5000);
    up(view, 1, -5000, -5000);
    expect(board.x).toBeGreaterThan(-W);
    expect(board.y).toBeGreaterThan(-H);
  });

  it('off, a fling throws the board off-screen as before', () => {
    const { view, board } = renderMap(false);
    down(view, 1, 100, 100);
    move(view, 1, 5000, 5000);
    expect({ x: board.x, y: board.y }).toEqual({ x: 4900, y: 4900 });
  });

  it('a tap followed by a pinch is not a double-tap', () => {
    const { view, board } = renderMap(true);
    down(view, 1, 100, 100);
    up(view, 1, 100, 100);
    // The pinch's first finger lands where the tap was, moments later.
    down(view, 1, 100, 100);
    down(view, 2, 200, 100);
    move(view, 2, 200, 100);
    up(view, 2, 200, 100);
    up(view, 1, 100, 100);
    expect(board.scale.x).toBe(1);
  });

  it('off, the first finger of that pinch zoomed the board 2x', () => {
    const { view, board } = renderMap(false);
    down(view, 1, 100, 100);
    up(view, 1, 100, 100);
    down(view, 1, 100, 100);
    expect(board.scale.x).toBe(2);
  });

  it('a double-tap zooms 2x around the tap', () => {
    const { view, board } = renderMap(true);
    for (let i = 0; i < 2; i++) {
      down(view, 1, 120, 200);
      up(view, 1, 120, 200);
    }
    expect(board.scale.x).toBe(2);
    expect(onScreen(board, { x: 120, y: 200 })).toEqual({ x: 120, y: 200 });
  });

  it('a drag is not half of a double-tap', () => {
    const { view, board } = renderMap(true);
    down(view, 1, 120, 200);
    move(view, 1, 160, 200);
    up(view, 1, 160, 200);
    down(view, 1, 160, 200);
    up(view, 1, 160, 200);
    expect(board.scale.x).toBe(1);
  });
});
