/**
 * PixiJS replaced by a small fake that records what the 2D map asks of it:
 * how its WebGL context is created, when its ticker runs, how many Graphics
 * it allocates, and the line styles each one draws. Shared by the map tests:
 *
 *   vi.mock('pixi.js', async () => (await import('../../test/fakePixi')).pixi.module);
 *   import { pixi } from '../../test/fakePixi';
 */
export const pixi = (() => {
  const created = { graphics: 0, graphicsList: [] as FakeGraphics[], tickers: [] as FakeTicker[], apps: [] as FakeApplication[] };
  /** Set `supported` false for a browser without WebGL: the Application throws as PixiJS's does. */
  const webgl = { supported: true };

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
      if (!webgl.supported) throw new Error('Unable to auto-detect a suitable renderer.');
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
    webgl,
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
})();
