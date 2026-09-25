/**
 * The 2D map's side of the phone frame budget (docs/MOBILE_UX_PLAN.md M-13
 * phase 2), with PixiJS replaced by a small fake that records what the map
 * asks of it: how its WebGL context is created, when its ticker runs, and
 * how many Graphics it allocates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pixi = vi.hoisted(() => {
  const created = { graphics: 0, graphicsList: [] as FakeGraphics[], tickers: [] as FakeTicker[], apps: [] as FakeApplication[] };

  class Point {
    x = 0;
    y = 0;
    set(x = 0, y: number = x) { this.x = x; this.y = y; }
  }
  class FakeContainer {
    children: FakeContainer[] = [];
    parent: FakeContainer | null = null;
    x = 0; y = 0; alpha = 1; visible = true; zIndex = 0; rotation = 0; tint = 0xffffff;
    eventMode = 'auto'; cursor = ''; hitArea: unknown = null; sortableChildren = false; interactive = false;
    width = 10; height = 10; destroyed = false; mask: unknown = null; name = '';
    position = new Point(); scale = new Point(); pivot = new Point(); anchor = new Point();
    constructor() { this.scale.set(1, 1); }
    addChild<T extends FakeContainer>(...kids: T[]): T { for (const k of kids) { this.children.push(k); k.parent = this; } return kids[0]; }
    addChildAt<T extends FakeContainer>(k: T, i: number): T { this.children.splice(i, 0, k); k.parent = this; return k; }
    removeChild<T extends FakeContainer>(k: T): T { this.children = this.children.filter((c) => c !== k); return k; }
    removeChildren(): FakeContainer[] { const out = this.children; this.children = []; return out; }
    destroy() { this.destroyed = true; }
    on() { return this; }
    off() { return this; }
    once() { return this; }
    removeAllListeners() { return this; }
    sortChildren() {}
    getBounds() { return { x: 0, y: 0, width: this.width, height: this.height }; }
    getLocalBounds() { return this.getBounds(); }
    toLocal<P>(p: P) { return p; }
    toGlobal<P>(p: P) { return p; }
  }
  class FakeGraphics extends FakeContainer {
    /** How often it was cleared: each clear is a redraw PixiJS must triangulate again. */
    clears = 0;
    /** The line styles drawn since the last clear, as `line:width:color:alpha`. */
    ops: string[] = [];
    /** Pointer events it listens for: territory shapes are the ones with hover handlers. */
    handlers: string[] = [];
    clear() { this.clears += 1; this.ops = []; return this; }
    lineStyle(width?: number, color?: number, alpha?: number) { this.ops.push(`line:${width}:${color}:${alpha}`); return this; }
    on(event?: string) { if (event) this.handlers.push(event); return this; }
    constructor() {
      super();
      created.graphics += 1;
      // Every drawing call (lineStyle, beginFill, drawCircle, …) chains.
      const proxy = new Proxy(this, {
        get(target, prop, receiver) {
          if (prop in target) return Reflect.get(target, prop, receiver);
          return () => receiver;
        },
      });
      created.graphicsList.push(proxy);
      return proxy;
    }
  }
  class FakeText extends FakeContainer {
    text: string;
    style: Record<string, unknown>;
    resolution = 1;
    constructor(text = '', style: Record<string, unknown> = {}) { super(); this.text = text; this.style = { ...style }; }
  }
  class FakeRectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    contains() { return false; }
  }
  class FakeTicker {
    started = false;
    destroyed = false;
    maxFPS = 0;
    fns: Array<(delta: number) => void> = [];
    constructor() { created.tickers.push(this); }
    add(fn: (delta: number) => void) { this.fns.push(fn); return this; }
    remove(fn: (delta: number) => void) { this.fns = this.fns.filter((f) => f !== fn); return this; }
    start() { if (!this.destroyed) this.started = true; }
    stop() { this.started = false; }
    destroy() { this.started = false; this.destroyed = true; this.fns = []; }
    tick(delta = 1) { for (const fn of [...this.fns]) fn(delta); }
  }
  class FakeApplication {
    options: Record<string, unknown>;
    stage = new FakeContainer();
    ticker = new FakeTicker();
    view: HTMLCanvasElement;
    renderer = { resize: () => {}, render: () => {} };
    screen: { width: number; height: number };
    destroyed = false;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.view = document.createElement('canvas');
      (this.view as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
      this.screen = { width: Number(options.width), height: Number(options.height) };
      if (options.autoStart !== false) this.ticker.start();
      created.apps.push(this);
    }
    render() {}
    destroy() { this.destroyed = true; this.ticker.stop(); }
  }
  return {
    created,
    module: {
      Application: FakeApplication,
      Container: FakeContainer,
      Graphics: FakeGraphics,
      Text: FakeText,
      Rectangle: FakeRectangle,
      Ticker: FakeTicker,
      Point,
    },
  };
});

vi.mock('pixi.js', () => pixi.module);
vi.mock('../../hooks/useTerritoryGeoSources', () => ({ useTerritoryGeoSources: () => null }));

import GameMap from './GameMap';
import { useGameStore } from '../../store/gameStore';

const spaceAge = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_space_age.json'), 'utf8'));
const earthIds: string[] = spaceAge.territories
  .filter((t: { region_id: string }) => t.region_id !== 'lunar_surface')
  .map((t: { territory_id: string }) => t.territory_id);

function gameState(firstUnits = 3, firstOwner?: string, firstBuildings?: string[]) {
  const territories: Record<string, { owner_id: string | null; unit_count: number; buildings?: string[] }> = {};
  spaceAge.territories.forEach((t: { territory_id: string }, i: number) => {
    territories[t.territory_id] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: 3 };
  });
  territories[earthIds[0]].unit_count = firstUnits;
  if (firstOwner) territories[earthIds[0]].owner_id = firstOwner;
  if (firstBuildings) territories[earthIds[0]].buildings = firstBuildings;
  return {
    game_id: 'g1', era: 'space_age', map_id: 'era_space_age', phase: 'attack', turn_number: 3,
    current_player_index: 1,
    players: [
      { player_id: 'me', player_index: 0, username: 'Me', color: '#c0392b', is_ai: false, is_eliminated: false, cards: [] },
      { player_id: 'ai_1', player_index: 1, username: 'Admiral Chen', color: '#3498db', is_ai: true, is_eliminated: false, cards: [] },
    ],
    territories,
    settings: {},
  };
}

type MapProps = Partial<Parameters<typeof GameMap>[0]>;
// Stable, as GamePage passes it: the prop's default is a fresh array on every
// render, and the effect that reads it sets state.
const NO_EVENTS: never[] = [];
const onClick = () => {};
function el(props: MapProps = {}) {
  return (
    <GameMap
      mapData={spaceAge}
      onTerritoryClick={onClick}
      width={390}
      height={600}
      mapVisualEvents={NO_EVENTS}
      frameBudget
      reducedEffects={false}
      {...props}
    />
  );
}
const mainApp = () => pixi.created.apps[0];
/** Time passing at 30 frames a second: the app ticker ticks whenever it is running. */
function run(ms: number) {
  act(() => {
    for (let t = 0; t < ms; t += 33) {
      vi.advanceTimersByTime(Math.min(33, ms - t));
      const app = mainApp();
      if (app?.ticker.started) app.ticker.tick(1);
    }
  });
}

describe('GameMap under the phone frame budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pixi.created.graphics = 0;
    pixi.created.graphicsList.length = 0;
    pixi.created.tickers.length = 0;
    pixi.created.apps.length = 0;
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

  it('asks for the low-power GPU without antialiasing on a phone, and keeps the desktop context as it was', () => {
    const phone = render(el());
    expect(mainApp().options).toMatchObject({ antialias: false, powerPreference: 'low-power', autoStart: false });
    phone.unmount();
    pixi.created.apps.length = 0;
    render(el({ frameBudget: false }));
    expect(mainApp().options.antialias).toBe(true);
    expect(mainApp().options).not.toHaveProperty('powerPreference');
    expect(mainApp().options.autoStart).toBe(true);
  });

  it('renders the first frames, then stops the ticker instead of drawing an unchanged map', () => {
    render(el());
    expect(mainApp().ticker.started).toBe(true);
    run(400);
    expect(mainApp().ticker.started).toBe(false);
  });

  it('wakes for a board change for two frames at 20 a second, and idles again', () => {
    render(el());
    run(1000);
    expect(mainApp().ticker.started).toBe(false);
    act(() => { useGameStore.setState({ gameState: gameState(7) as never }); });
    expect(mainApp().ticker.started).toBe(true);
    // Every other player's move is a commit: 100 ms of frames, not 300 (M-14).
    run(90);
    expect(mainApp().ticker.started).toBe(true);
    run(20);
    expect(mainApp().ticker.started).toBe(false);
  });

  it('owes a change its frame when a slow task holds the first one past the deadline', () => {
    render(el());
    run(1000);
    expect(mainApp().ticker.started).toBe(false);
    act(() => { useGameStore.setState({ gameState: gameState(9) as never }); });
    // No frame for 150 ms: the main thread was busy. The change is still owed its frame.
    act(() => { vi.advanceTimersByTime(150); });
    expect(mainApp().ticker.started).toBe(true);
    run(60);
    expect(mainApp().ticker.started).toBe(false);
  });

  it('keeps rendering for the whole of a gesture, and stops soon after it ends', () => {
    render(el());
    run(1000);
    const view = mainApp().view;
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(mainApp().ticker.started).toBe(true);
    run(3000); // a finger resting on the map
    expect(mainApp().ticker.started).toBe(true);
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 140, clientY: 120 });
    run(1200);
    expect(mainApp().ticker.started).toBe(false);
  });

  it('keeps rendering while the loss pulse animates, and stops once it clears', () => {
    const view = render(el());
    view.rerender(el({ lossPulseTerritoryIds: [earthIds[0]] }));
    run(3000);
    expect(mainApp().ticker.started).toBe(true);
    view.rerender(el({ lossPulseTerritoryIds: [] }));
    run(1000);
    expect(mainApp().ticker.started).toBe(false);
  });

  it('never stops the ticker on the desktop', () => {
    render(el({ frameBudget: false }));
    run(5000);
    expect(mainApp().ticker.started).toBe(true);
  });

  describe('the ambient glow', () => {
    const ambient = { ambientEnabled: true, turnHolderPlayerId: 'ai_1', turnHolderColor: '#3498db', connectionHintMode: 'full' as const };
    const standaloneRunning = () => pixi.created.tickers.filter((t) => t !== mainApp().ticker && t.started && t.fns.length > 0);

    it('is drawn still on a phone: no endless shimmer loop', () => {
      render(el(ambient));
      expect(standaloneRunning()).toHaveLength(0);
      run(1000);
      expect(mainApp().ticker.started).toBe(false);
    });

    it('shimmers on the desktop without allocating new graphics on each frame', () => {
      render(el({ ...ambient, frameBudget: false }));
      const [shimmer] = standaloneRunning();
      expect(shimmer).toBeDefined();
      shimmer.tick(1);
      const before = pixi.created.graphics;
      for (let i = 0; i < 10; i++) shimmer.tick(1);
      expect(pixi.created.graphics).toBe(before);
    });
  });

  describe('redraws only what changed (M-14)', () => {
    const territoryShapes = () => pixi.created.graphicsList.filter((g) => g.handlers.includes('pointerover'));
    const clears = (gs: Array<{ clears: number }>) => gs.reduce((n, g) => n + g.clears, 0);

    it('leaves every shape alone when only a unit count changes', () => {
      render(el());
      const shapes = territoryShapes();
      expect(shapes.length).toBeGreaterThan(40);
      const beforeShapes = clears(shapes);
      const beforeAll = clears(pixi.created.graphicsList);
      act(() => { useGameStore.setState({ gameState: gameState(9) as never }); });
      expect(clears(shapes)).toBe(beforeShapes);
      // The unit badges' circles too: the count is text, the circle did not change.
      expect(clears(pixi.created.graphicsList)).toBe(beforeAll);
    });

    it('redraws the territory that changed hands and the frontline around it, not the whole map', () => {
      render(el());
      const shapes = territoryShapes();
      const before = shapes.map((g) => g.clears);
      act(() => { useGameStore.setState({ gameState: gameState(3, 'ai_1') as never }); });
      const redrawn = shapes.filter((g, i) => g.clears > before[i]).length;
      expect(redrawn).toBeGreaterThan(0);
      expect(redrawn).toBeLessThan(shapes.length / 3);
    });

    it('draws every shape of a rebuilt scene', () => {
      const view = render(el());
      const firstScene = pixi.created.graphicsList.length;
      view.rerender(el({ width: 420 }));
      const rebuilt = territoryShapes().filter((g) => pixi.created.graphicsList.indexOf(g) >= firstScene);
      expect(rebuilt.length).toBeGreaterThan(40);
      // Drawn blank when created, then again in its owner's colours.
      expect(rebuilt.every((g) => g.clears >= 2)).toBe(true);
    });
  });

  describe('the wonder halo', () => {
    // HIGHLIGHT_PIXI.wonder (#ffd700): the halo's inner pass, 10 px at 30%.
    const HALO = `line:10:${0xffd700}:0.3`;
    const halos = () => pixi.created.graphicsList.filter((g) => g.ops.includes(HALO));
    const withWonder = (owner?: string) => gameState(3, owner, ['wonder_colossus']);
    const territoryShapes = () => pixi.created.graphicsList.filter((g) => g.handlers.includes('pointerover'));

    it('rings a territory that has a wonder, above every territory shape', () => {
      act(() => { useGameStore.setState({ gameState: withWonder() as never }); });
      render(el());
      expect(halos()).toHaveLength(1);
      const [halo] = halos();
      expect(halo.visible).toBe(true);
      const layer = halo.parent!;
      const map = layer.parent!;
      const shapes = territoryShapes().map((g) => map.children.indexOf(g));
      expect(Math.min(...shapes)).toBeGreaterThanOrEqual(0);
      expect(map.children.indexOf(layer)).toBeGreaterThan(Math.max(...shapes));
    });

    it('survives every redraw of the territory shape', () => {
      act(() => { useGameStore.setState({ gameState: withWonder() as never }); });
      render(el());
      const [halo] = halos();
      const clears = halo.clears;
      // The wonder changes hands: its shape is redrawn in the new owner's colour.
      act(() => { useGameStore.setState({ gameState: withWonder('ai_1') as never }); });
      act(() => { useGameStore.setState({ gameState: gameState(8, 'ai_1', ['wonder_colossus']) as never }); });
      expect(halo.ops).toContain(HALO);
      expect(halo.clears).toBe(clears);
      expect(halo.visible).toBe(true);
    });

    it('hides when the wonder is gone, and comes back without being redrawn', () => {
      act(() => { useGameStore.setState({ gameState: withWonder() as never }); });
      render(el());
      const [halo] = halos();
      const clears = halo.clears;
      act(() => { useGameStore.setState({ gameState: gameState(3) as never }); });
      expect(halo.visible).toBe(false);
      act(() => { useGameStore.setState({ gameState: withWonder() as never }); });
      expect(halo.visible).toBe(true);
      expect(halo.clears).toBe(clears);
      expect(halos()).toHaveLength(1);
    });

    it('draws no halo where there is no wonder', () => {
      render(el());
      expect(halos()).toHaveLength(0);
    });

    it('draws a new halo for a rebuilt scene', () => {
      act(() => { useGameStore.setState({ gameState: withWonder() as never }); });
      const view = render(el());
      const firstScene = pixi.created.graphicsList.length;
      view.rerender(el({ width: 420 }));
      const rebuilt = halos().filter((g) => pixi.created.graphicsList.indexOf(g) >= firstScene);
      expect(rebuilt).toHaveLength(1);
      expect(rebuilt[0].visible).toBe(true);
    });
  });
});
