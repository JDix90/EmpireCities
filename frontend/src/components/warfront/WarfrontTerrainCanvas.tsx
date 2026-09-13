import { useCallback, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import type { TerrainGrid } from '@borderfall/warfront-sim';
import { buildTerrainImage } from '../../warfront/terrainImage';
import type { SimRunner, UnitView } from '../../warfront/simRunner';
import { DRAG_THRESHOLD_PX, normalizeRect, type WorldRect } from '../../warfront/selection';
import {
  clampCamera,
  centerOn,
  fitCamera,
  panCamera,
  screenToWorld,
  worldToScreen,
  zoomCameraAt,
  type Camera,
} from '../../warfront/camera';

/**
 * The Warfront tactical plane: terrain, units, selection and orders.
 *
 * Terrain is one nearest-neighbour sprite baked from the grid — see terrainImage.ts for
 * why. Units are drawn in SCREEN space rather than as children of that sprite, so a unit
 * stays the same readable size at every zoom level instead of shrinking to a sub-pixel
 * speck when the whole of Gaul is on screen.
 *
 * Input follows the RTS convention rather than the map-viewer one: left selects (click
 * or box), right orders, middle-drag or WASD pans, wheel zooms. This component owns the
 * CAMERA keys only; the page owns selection keys, because it owns the selection.
 *
 * The arithmetic lives in ../../warfront/{camera,selection,simRunner}.ts, all pure and
 * unit-tested — PixiJS needs a GPU context jsdom has not got.
 */

export interface WarfrontTerrainCanvasProps {
  grid: TerrainGrid;
  /** Drives the simulation; null renders terrain only. */
  runner?: SimRunner | null;
  selectedIds?: ReadonlySet<number>;
  onSelectPoint?: (worldX: number, worldY: number, additive: boolean) => void;
  onSelectRect?: (rect: WorldRect, additive: boolean) => void;
  onOrder?: (worldX: number, worldY: number) => void;
  onCameraChange?: (camera: Camera) => void;
  onHoverCell?: (cellIndex: number) => void;
  /** Reports simulation progress for the HUD, at most a few times a second. */
  onFrame?: (info: { ticks: number; units: number }) => void;
  /** Cell to centre on when the plane first mounts. */
  focusCell?: number | null;
}

const BACKGROUND = 0x0a0e1a;
const WHEEL_ZOOM_STEP = 1.0015;
const UNIT_RADIUS_PX = 5;
const KEY_PAN_PX_PER_FRAME = 12;
/** Reporting every frame would re-render React 60 times a second for a tick counter. */
const FRAMES_PER_HUD_UPDATE = 10;

const OWNER_COLORS = [0xe8c46a, 0x6aa9e8, 0xe86a6a, 0x7fe86a, 0xc99ae8, 0x6ae8d2];
const SELECTION_RING = 0xffffff;
const GOAL_MARKER = 0xffffff;

function ownerColor(owner: number): number {
  return OWNER_COLORS[(owner - 1 + OWNER_COLORS.length) % OWNER_COLORS.length];
}

export default function WarfrontTerrainCanvas({
  grid,
  runner = null,
  selectedIds,
  onSelectPoint,
  onSelectRect,
  onOrder,
  onCameraChange,
  onHoverCell,
  onFrame,
  focusCell = null,
}: WarfrontTerrainCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const unitLayerRef = useRef<PIXI.Container | null>(null);
  const overlayRef = useRef<PIXI.Graphics | null>(null);
  const unitGraphicsRef = useRef(new Map<number, PIXI.Graphics>());
  const cameraRef = useRef<Camera>({ x: grid.width / 2, y: grid.height / 2, scale: 1 });
  const viewportRef = useRef({ width: 1, height: 1 });
  const worldRef = useRef({ width: grid.width, height: grid.height });
  const [ready, setReady] = useState(false);

  worldRef.current = { width: grid.width, height: grid.height };

  // Live refs for values the render loop reads, so the loop never restarts on a prop
  // change (restarting it would tear down the GPU context every render).
  const runnerRef = useRef(runner);
  const selectedRef = useRef<ReadonlySet<number>>(selectedIds ?? new Set());
  const onFrameRef = useRef(onFrame);
  const onCameraChangeRef = useRef(onCameraChange);
  runnerRef.current = runner;
  selectedRef.current = selectedIds ?? new Set();
  onFrameRef.current = onFrame;
  onCameraChangeRef.current = onCameraChange;

  const applyCamera = useCallback(() => {
    const sprite = spriteRef.current;
    if (!sprite) return;
    const camera = cameraRef.current;
    const viewport = viewportRef.current;
    sprite.scale.set(camera.scale);
    sprite.position.set(viewport.width / 2 - camera.x * camera.scale, viewport.height / 2 - camera.y * camera.scale);
    onCameraChangeRef.current?.(camera);
  }, []);

  const setCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next;
      applyCamera();
    },
    [applyCamera],
  );

  // Mount PixiJS once per grid.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    viewportRef.current = { width, height };

    const app = new PIXI.Application({
      width,
      height,
      backgroundColor: BACKGROUND,
      // Cells are hard-edged blocks; antialiasing only blurs the grid.
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
    });
    host.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;

    const image = buildTerrainImage(grid);
    const texture = PIXI.Texture.fromBuffer(image.rgba, image.width, image.height);
    // NEAREST keeps a cell a crisp square when zoomed in; the default would smear the
    // fords and passes, which are one cell wide, into their neighbours.
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    const sprite = new PIXI.Sprite(texture);
    sprite.eventMode = 'none';
    app.stage.addChild(sprite);
    spriteRef.current = sprite;

    const unitLayer = new PIXI.Container();
    unitLayer.eventMode = 'none';
    app.stage.addChild(unitLayer);
    unitLayerRef.current = unitLayer;

    const overlay = new PIXI.Graphics();
    overlay.eventMode = 'none';
    app.stage.addChild(overlay);
    overlayRef.current = overlay;

    cameraRef.current = fitCamera(worldRef.current, viewportRef.current);
    applyCamera();
    setReady(true);

    return () => {
      setReady(false);
      unitGraphicsRef.current.clear();
      spriteRef.current = null;
      unitLayerRef.current = null;
      overlayRef.current = null;
      appRef.current = null;
      texture.destroy(true);
      app.destroy(true);
    };
    // Deliberately keyed on the grid alone: re-running on a callback's identity would
    // tear down and rebuild the GPU context on every parent render.
  }, [grid, applyCamera]);

  // Centre on the requested cell once the plane exists (the mustering point, an alert).
  useEffect(() => {
    if (!ready || focusCell == null || focusCell < 0) return;
    setCamera(
      centerOn(
        { ...cameraRef.current, scale: Math.max(cameraRef.current.scale, 3) },
        worldRef.current,
        viewportRef.current,
        grid.colOf(focusCell) + 0.5,
        grid.rowOf(focusCell) + 0.5,
      ),
    );
  }, [ready, focusCell, grid, setCamera]);

  // The render loop: advance the simulation by real elapsed time, then draw.
  useEffect(() => {
    const app = appRef.current;
    if (!app || !ready) return;
    let frame = 0;

    const tick = () => {
      const sim = runnerRef.current;
      const unitLayer = unitLayerRef.current;
      if (!unitLayer) return;

      if (sim) sim.advance(app.ticker.deltaMS);

      const units: UnitView[] = sim ? sim.positions() : [];
      const camera = cameraRef.current;
      const viewport = viewportRef.current;
      const selected = selectedRef.current;
      const graphics = unitGraphicsRef.current;

      const seen = new Set<number>();
      for (const unit of units) {
        seen.add(unit.id);
        let g = graphics.get(unit.id);
        if (!g) {
          g = new PIXI.Graphics();
          graphics.set(unit.id, g);
          unitLayer.addChild(g);
        }
        const isSelected = selected.has(unit.id);
        // Redraw only when the look changes; position is set every frame.
        const key = `${unit.owner}:${isSelected ? 1 : 0}`;
        if (g.name !== key) {
          g.name = key;
          g.clear();
          if (isSelected) g.lineStyle(2, SELECTION_RING, 1).drawCircle(0, 0, UNIT_RADIUS_PX + 3);
          g.lineStyle(1, 0x101418, 1).beginFill(ownerColor(unit.owner), 1).drawCircle(0, 0, UNIT_RADIUS_PX).endFill();
        }
        const p = worldToScreen(camera, viewport, unit.x, unit.y);
        g.position.set(p.x, p.y);
        g.visible =
          p.x >= -UNIT_RADIUS_PX &&
          p.y >= -UNIT_RADIUS_PX &&
          p.x <= viewport.width + UNIT_RADIUS_PX &&
          p.y <= viewport.height + UNIT_RADIUS_PX;
      }
      for (const [id, g] of graphics) {
        if (seen.has(id)) continue;
        g.destroy();
        graphics.delete(id);
      }

      // Goal markers for selected units that are still walking, so an order is visibly
      // received even when the unit is off screen or barely moving.
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.clear();
        if (sim) {
          for (const id of selected) {
            const unit = sim.sim.entities.get(id);
            if (!unit || !unit.moving) continue;
            const gp = worldToScreen(camera, viewport, unit.goalX / 65536, unit.goalY / 65536);
            overlay.lineStyle(1, GOAL_MARKER, 0.7);
            overlay.moveTo(gp.x - 5, gp.y);
            overlay.lineTo(gp.x + 5, gp.y);
            overlay.moveTo(gp.x, gp.y - 5);
            overlay.lineTo(gp.x, gp.y + 5);
          }
        }
        const box = boxRef.current;
        if (box && box.active) {
          overlay.lineStyle(1, SELECTION_RING, 0.9);
          overlay.beginFill(SELECTION_RING, 0.08);
          overlay.drawRect(
            Math.min(box.x0, box.x1),
            Math.min(box.y0, box.y1),
            Math.abs(box.x1 - box.x0),
            Math.abs(box.y1 - box.y0),
          );
          overlay.endFill();
        }
      }

      // Keyboard panning, applied per frame so it is smooth rather than stepwise.
      const keys = keysRef.current;
      let kx = 0;
      let ky = 0;
      if (keys.has('a') || keys.has('arrowleft')) kx += KEY_PAN_PX_PER_FRAME;
      if (keys.has('d') || keys.has('arrowright')) kx -= KEY_PAN_PX_PER_FRAME;
      if (keys.has('w') || keys.has('arrowup')) ky += KEY_PAN_PX_PER_FRAME;
      if (keys.has('s') || keys.has('arrowdown')) ky -= KEY_PAN_PX_PER_FRAME;
      if (kx !== 0 || ky !== 0) setCamera(panCamera(cameraRef.current, worldRef.current, viewportRef.current, kx, ky));

      frame += 1;
      if (sim && frame % FRAMES_PER_HUD_UPDATE === 0) {
        onFrameRef.current?.({ ticks: sim.ticks, units: units.length });
      }
    };

    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
    };
  }, [ready, setCamera]);

  // Camera keys only. Selection keys belong to the page, which owns the selection.
  const keysRef = useRef(new Set<string>());
  useEffect(() => {
    const isCameraKey = (k: string) => ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k);
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!isCameraKey(k) || e.ctrlKey || e.metaKey || e.altKey) return;
      keysRef.current.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    const blur = () => keysRef.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Follow container resizes so the plane keeps filling its pane.
  useEffect(() => {
    const host = hostRef.current;
    const app = appRef.current;
    if (!host || !app || !ready) return;
    const observer = new ResizeObserver(() => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      viewportRef.current = { width, height };
      app.renderer.resize(width, height);
      setCamera(clampCamera(cameraRef.current, worldRef.current, viewportRef.current));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [ready, setCamera]);

  const panRef = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<{ x0: number; y0: number; x1: number; y1: number; active: boolean } | null>(null);

  const localPoint = (e: { clientX: number; clientY: number; currentTarget: EventTarget & HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = localPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) {
      boxRef.current = { x0: point.x, y0: point.y, x1: point.x, y1: point.y, active: false };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const point = localPoint(e);
    if (onHoverCell) {
      const w = screenToWorld(cameraRef.current, viewportRef.current, point.x, point.y);
      const col = Math.floor(w.x);
      const row = Math.floor(w.y);
      onHoverCell(grid.inBounds(col, row) ? grid.index(col, row) : -1);
    }
    const pan = panRef.current;
    if (pan) {
      setCamera(panCamera(cameraRef.current, worldRef.current, viewportRef.current, e.clientX - pan.x, e.clientY - pan.y));
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const box = boxRef.current;
    if (box) {
      box.x1 = point.x;
      box.y1 = point.y;
      if (Math.abs(box.x1 - box.x0) > DRAG_THRESHOLD_PX || Math.abs(box.y1 - box.y0) > DRAG_THRESHOLD_PX) {
        box.active = true;
      }
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    panRef.current = null;
    const box = boxRef.current;
    boxRef.current = null;
    if (!box || e.button !== 0) return;
    const camera = cameraRef.current;
    const viewport = viewportRef.current;
    const additive = e.shiftKey;
    if (box.active) {
      const a = screenToWorld(camera, viewport, box.x0, box.y0);
      const b = screenToWorld(camera, viewport, box.x1, box.y1);
      onSelectRect?.(normalizeRect(a.x, a.y, b.x, b.y), additive);
    } else {
      const w = screenToWorld(camera, viewport, box.x0, box.y0);
      onSelectPoint?.(w.x, w.y, additive);
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const point = localPoint(e);
    const w = screenToWorld(cameraRef.current, viewportRef.current, point.x, point.y);
    onOrder?.(w.x, w.y);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const point = localPoint(e);
    // Exponential in the delta so a trackpad's many small events and a mouse wheel's
    // few large ones cover the same distance per unit of scroll.
    const factor = Math.pow(WHEEL_ZOOM_STEP, -e.deltaY);
    setCamera(zoomCameraAt(cameraRef.current, worldRef.current, viewportRef.current, point.x, point.y, factor));
  };

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current;
    setCamera(zoomCameraAt(cameraRef.current, worldRef.current, viewport, viewport.width / 2, viewport.height / 2, factor));
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        data-testid="warfront-plane"
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerLeave={(e) => {
          finishPointer(e);
          onHoverCell?.(-1);
        }}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.4)}
          className="h-8 w-8 rounded border border-bf-border bg-bf-dark/80 text-bf-text hover:border-bf-gold"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.4)}
          className="h-8 w-8 rounded border border-bf-border bg-bf-dark/80 text-bf-text hover:border-bf-gold"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Fit map"
          onClick={() => setCamera(fitCamera(worldRef.current, viewportRef.current))}
          className="h-8 w-8 rounded border border-bf-border bg-bf-dark/80 text-[10px] text-bf-text hover:border-bf-gold"
        >
          fit
        </button>
      </div>
    </div>
  );
}
