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
  const created = { graphics: 0, tickers: [] as FakeTicker[], apps: [] as FakeApplication[] };

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
    constructor() {
      super();
      created.graphics += 1;
      // Every drawing call (lineStyle, beginFill, drawCircle, …) chains.
      return new Proxy(this, {
        get(target, prop, receiver) {
          if (prop in target) return Reflect.get(target, prop, receiver);
          return () => receiver;
        },
      });
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

function gameState(firstUnits = 3) {
  const territories: Record<string, { owner_id: string | null; unit_count: number }> = {};
  spaceAge.territories.forEach((t: { territory_id: string }, i: number) => {
    territories[t.territory_id] = { owner_id: i % 2 ? 'ai_1' : 'me', unit_count: 3 };
  });
  territories[earthIds[0]].unit_count = firstUnits;
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

describe('GameMap under the phone frame budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pixi.created.graphics = 0;
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
    act(() => { vi.advanceTimersByTime(400); });
    expect(mainApp().ticker.started).toBe(false);
  });

  it('wakes for a board change and idles again', () => {
    render(el());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mainApp().ticker.started).toBe(false);
    act(() => { useGameStore.setState({ gameState: gameState(7) as never }); });
    expect(mainApp().ticker.started).toBe(true);
    act(() => { vi.advanceTimersByTime(400); });
    expect(mainApp().ticker.started).toBe(false);
  });

  it('keeps rendering for the whole of a gesture, and stops soon after it ends', () => {
    render(el());
    act(() => { vi.advanceTimersByTime(1000); });
    const view = mainApp().view;
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    expect(mainApp().ticker.started).toBe(true);
    act(() => { vi.advanceTimersByTime(3000); }); // a finger resting on the map
    expect(mainApp().ticker.started).toBe(true);
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 140, clientY: 120 });
    act(() => { vi.advanceTimersByTime(1200); });
    expect(mainApp().ticker.started).toBe(false);
  });

  it('keeps rendering while the loss pulse animates, and stops once it clears', () => {
    const view = render(el());
    view.rerender(el({ lossPulseTerritoryIds: [earthIds[0]] }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(mainApp().ticker.started).toBe(true);
    view.rerender(el({ lossPulseTerritoryIds: [] }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mainApp().ticker.started).toBe(false);
  });

  it('never stops the ticker on the desktop', () => {
    render(el({ frameBudget: false }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mainApp().ticker.started).toBe(true);
  });

  describe('the ambient glow', () => {
    const ambient = { ambientEnabled: true, turnHolderPlayerId: 'ai_1', turnHolderColor: '#3498db', connectionHintMode: 'full' as const };
    const standaloneRunning = () => pixi.created.tickers.filter((t) => t !== mainApp().ticker && t.started && t.fns.length > 0);

    it('is drawn still on a phone: no endless shimmer loop', () => {
      render(el(ambient));
      expect(standaloneRunning()).toHaveLength(0);
      act(() => { vi.advanceTimersByTime(1000); });
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
});
