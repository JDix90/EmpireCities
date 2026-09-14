import { useCallback, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { BUILDING_SPECS, type TerrainGrid } from '@borderfall/warfront-sim';
import { buildTerrainImage } from '../../warfront/terrainImage';
import {
  HIGHLIGHT_ALPHA,
  SHADOW_ALPHA,
  SHADOW_DROP,
  buildingGlyph,
  healthBucket,
  healthColor,
  highlightOf,
  ownerColor,
  shade,
  unitGlyph,
  type Outline,
} from '../../warfront/glyphs';
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
 * What stands on the terrain is drawn the same way the terrain is: a contact shadow so it
 * sits on the ground rather than over it, a silhouette per kind (see glyphs.ts), and a
 * highlight thrown from the north-west, which is where the map's own light comes from.
 * The shapes themselves live in glyphs.ts and are unit-tested there; this file is only
 * the PixiJS that puts them on screen.
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
  /** Building currently selected, drawn with a ring like a selected unit. */
  selectedBuildingId?: number | null;
  /** True while the player is choosing where to put a building: the cursor becomes a site. */
  placing?: boolean;
  onSelectPoint?: (worldX: number, worldY: number, additive: boolean) => void;
  onSelectRect?: (rect: WorldRect, additive: boolean) => void;
  onOrder?: (worldX: number, worldY: number) => void;
  onCameraChange?: (camera: Camera) => void;
  onHoverCell?: (cellIndex: number) => void;
  /** Reports simulation progress for the HUD, at most a few times a second. */
  onFrame?: (info: { ticks: number; units: number }) => void;
  /**
   * Cell to centre on. Carries a nonce because jumping to the SAME cell twice — the
   * alert key pressed repeatedly — must move the camera back each time, which a bare
   * cell number cannot express.
   */
  focus?: { cell: number; nonce: number } | null;
}

const BACKGROUND = 0x080c14;
const WHEEL_ZOOM_STEP = 1.0015;
const KEY_PAN_PX_PER_FRAME = 12;
/** Reporting every frame would re-render React 60 times a second for a tick counter. */
const FRAMES_PER_HUD_UPDATE = 10;

const SELECTION_RING = 0xffffff;
const SELECTION_SHADE = 0x0b0f16;
const GOAL_MARKER = 0xffffff;
const HEALTH_BAR_WIDTH_PX = 15;
/** How dark a thing's own outline is, as a fraction of its owner's colour. */
const OUTLINE_SHADE = 0.4;
/** And its marks — the furrows, the shaft, the beam — a shade darker again. */
const MARK_SHADE = 0.3;

/** Draws an open polyline from a glyph mark. */
function stroke(g: PIXI.Graphics, mark: Outline): void {
  g.moveTo(mark[0], mark[1]);
  for (let i = 2; i < mark.length; i += 2) g.lineTo(mark[i], mark[i + 1]);
}

/** The ellipse that stops a thing floating over the ground it is standing on. */
function contactShadow(g: PIXI.Graphics, extent: number): void {
  g.lineStyle(0);
  g.beginFill(0x000000, SHADOW_ALPHA)
    .drawEllipse(SHADOW_DROP, extent * 0.62, extent * 0.98, extent * 0.42)
    .endFill();
}

/** A ring that reads on light mountain and dark sea alike: white outside, ink inside. */
function selectionRing(g: PIXI.Graphics, extent: number): void {
  g.lineStyle(1, SELECTION_SHADE, 0.9).drawCircle(0, 0, extent + 5);
  g.lineStyle(2, SELECTION_RING, 0.95).drawCircle(0, 0, extent + 3.5);
}

/** Hit points, only ever drawn on something that has lost some. */
function healthBar(g: PIXI.Graphics, top: number, fraction: number): void {
  const width = HEALTH_BAR_WIDTH_PX;
  g.lineStyle(0);
  g.beginFill(0x000000, 0.7).drawRect(-width / 2 - 1, top - 1, width + 2, 4).endFill();
  g.beginFill(healthColor(fraction), 1).drawRect(-width / 2, top, width * fraction, 2).endFill();
}

function drawUnit(g: PIXI.Graphics, kind: number, owner: number, selected: boolean, tenths: number): void {
  const { outline, radius } = unitGlyph(kind);
  const base = ownerColor(owner);
  g.clear();
  contactShadow(g, radius);
  if (selected) selectionRing(g, radius);
  g.lineStyle(1.25, shade(base, OUTLINE_SHADE), 1)
    .beginFill(base, 1)
    .drawPolygon([...outline])
    .endFill();
  g.lineStyle(0).beginFill(0xffffff, HIGHLIGHT_ALPHA).drawPolygon(highlightOf(outline, radius)).endFill();
  if (tenths < 10) healthBar(g, radius + 3, tenths / 10);
}

function drawBuilding(
  g: PIXI.Graphics,
  kind: number,
  owner: number,
  complete: boolean,
  selected: boolean,
  tenths: number,
  progress: number,
): void {
  const { outline, marks, half } = buildingGlyph(kind);
  const base = ownerColor(owner);
  g.clear();
  contactShadow(g, half);
  if (selected) selectionRing(g, half);
  if (complete) {
    g.lineStyle(1.25, shade(base, OUTLINE_SHADE), 1)
      .beginFill(base, 1)
      .drawPolygon([...outline])
      .endFill();
    g.lineStyle(0).beginFill(0xffffff, HIGHLIGHT_ALPHA).drawPolygon(highlightOf(outline, half)).endFill();
    g.lineStyle(1.2, shade(base, MARK_SHADE), 0.95);
    for (const mark of marks) stroke(g, mark);
    if (tenths < 10) healthBar(g, half + 3, tenths / 10);
    return;
  }
  // A site is the same footprint, hollow, with how far along it is drawn underneath —
  // a builder needs to know whether to stay, and a percentage in a panel is not on the map.
  g.lineStyle(1.25, base, 0.85)
    .beginFill(base, 0.15)
    .drawPolygon([...outline])
    .endFill();
  g.lineStyle(1.1, shade(base, 0.55), 0.6);
  for (const mark of marks) stroke(g, mark);
  const width = HEALTH_BAR_WIDTH_PX;
  g.lineStyle(0);
  g.beginFill(0x000000, 0.7).drawRect(-width / 2 - 1, half + 2, width + 2, 4).endFill();
  g.beginFill(base, 0.95).drawRect(-width / 2, half + 3, (width * progress) / 100, 2).endFill();
}

export default function WarfrontTerrainCanvas({
  grid,
  runner = null,
  selectedIds,
  selectedBuildingId = null,
  placing = false,
  onSelectPoint,
  onSelectRect,
  onOrder,
  onCameraChange,
  onHoverCell,
  onFrame,
  focus = null,
}: WarfrontTerrainCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const unitLayerRef = useRef<PIXI.Container | null>(null);
  const overlayRef = useRef<PIXI.Graphics | null>(null);
  const unitGraphicsRef = useRef(new Map<number, PIXI.Graphics>());
  const buildingLayerRef = useRef<PIXI.Container | null>(null);
  const buildingGraphicsRef = useRef(new Map<number, PIXI.Graphics>());
  const cameraRef = useRef<Camera>({ x: grid.width / 2, y: grid.height / 2, scale: 1 });
  const viewportRef = useRef({ width: 1, height: 1 });
  const worldRef = useRef({ width: grid.width, height: grid.height });
  const [ready, setReady] = useState(false);

  worldRef.current = { width: grid.width, height: grid.height };

  // Live refs for values the render loop reads, so the loop never restarts on a prop
  // change (restarting it would tear down the GPU context every render).
  const runnerRef = useRef(runner);
  const selectedRef = useRef<ReadonlySet<number>>(selectedIds ?? new Set());
  const selectedBuildingRef = useRef<number | null>(selectedBuildingId ?? null);
  const onFrameRef = useRef(onFrame);
  const onCameraChangeRef = useRef(onCameraChange);
  runnerRef.current = runner;
  selectedRef.current = selectedIds ?? new Set();
  selectedBuildingRef.current = selectedBuildingId ?? null;
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

    // Buildings under units: a villager standing on its farm must stay visible.
    const buildingLayer = new PIXI.Container();
    buildingLayer.eventMode = 'none';
    app.stage.addChild(buildingLayer);
    buildingLayerRef.current = buildingLayer;

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
      buildingGraphicsRef.current.clear();
      spriteRef.current = null;
      unitLayerRef.current = null;
      buildingLayerRef.current = null;
      overlayRef.current = null;
      appRef.current = null;
      texture.destroy(true);
      app.destroy(true);
    };
    // Deliberately keyed on the grid alone: re-running on a callback's identity would
    // tear down and rebuild the GPU context on every parent render.
  }, [grid, applyCamera]);

  // Centre on the requested cell once the plane exists (the mustering point, an alert).
  const focusCell = focus?.cell ?? null;
  const focusNonce = focus?.nonce ?? 0;
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
  }, [ready, focusCell, focusNonce, grid, setCamera]);

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

      // Buildings first, read straight from the simulation: they change rarely, so a
      // graphic is rebuilt only when its LOOK changes, not every frame.
      const buildingLayer = buildingLayerRef.current;
      if (buildingLayer && sim) {
        const graphics = buildingGraphicsRef.current;
        const seenBuildings = new Set<number>();
        const selectedBuilding = selectedBuildingRef.current;
        for (const building of sim.sim.buildings.all()) {
          seenBuildings.add(building.id);
          let g = graphics.get(building.id);
          if (!g) {
            g = new PIXI.Graphics();
            graphics.set(building.id, g);
            buildingLayer.addChild(g);
          }
          const spec = BUILDING_SPECS[building.kind];
          const tenths = healthBucket(building.hp, spec?.hp ?? 0);
          // Rebuilt only when the LOOK changes. Health and build progress are bucketed
          // so a building under fire, or one being raised, does not rebuild per tick.
          // `progress` is in TICKS in the simulation; the bar wants a percentage.
          const progress =
            building.complete || !spec ? 100 : Math.min(100, Math.floor((building.progress * 100) / spec.buildTicks));
          const key = [
            building.owner,
            building.kind,
            building.complete ? 1 : 0,
            selectedBuilding === building.id ? 1 : 0,
            tenths,
            building.complete ? -1 : Math.round(progress / 5),
          ].join(':');
          if (g.name !== key) {
            g.name = key;
            drawBuilding(
              g,
              building.kind,
              building.owner,
              building.complete,
              selectedBuilding === building.id,
              tenths,
              progress,
            );
          }
          const bp = worldToScreen(camera, viewport, grid.colOf(building.cell) + 0.5, grid.rowOf(building.cell) + 0.5);
          g.position.set(bp.x, bp.y);
          g.visible = bp.x >= -20 && bp.y >= -20 && bp.x <= viewport.width + 20 && bp.y <= viewport.height + 20;
        }
        for (const [id, g] of graphics) {
          if (seenBuildings.has(id)) continue;
          g.destroy();
          graphics.delete(id);
        }
      }

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
        const { radius } = unitGlyph(unit.kind);
        const tenths = healthBucket(unit.hp, unit.maxHp);
        // Redraw only when the look changes; position is set every frame.
        const key = [unit.owner, unit.kind, isSelected ? 1 : 0, tenths].join(':');
        if (g.name !== key) {
          g.name = key;
          drawUnit(g, unit.kind, unit.owner, isSelected, tenths);
        }
        const p = worldToScreen(camera, viewport, unit.x, unit.y);
        g.position.set(p.x, p.y);
        g.visible =
          p.x >= -radius && p.y >= -radius && p.x <= viewport.width + radius && p.y <= viewport.height + radius;
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
            // A ringed mark rather than a bare cross: a cross of hairlines disappears over
            // the map's own detail, and an order the player cannot see is an order they
            // give twice.
            overlay.lineStyle(1.5, 0x000000, 0.45);
            overlay.drawPolygon([gp.x, gp.y - 6, gp.x + 6, gp.y, gp.x, gp.y + 6, gp.x - 6, gp.y]);
            overlay.lineStyle(1.5, GOAL_MARKER, 0.85);
            overlay.drawPolygon([gp.x, gp.y - 5, gp.x + 5, gp.y, gp.x, gp.y + 5, gp.x - 5, gp.y]);
            overlay.lineStyle(0).beginFill(GOAL_MARKER, 0.8).drawCircle(gp.x, gp.y, 1.4).endFill();
          }
        }
        const box = boxRef.current;
        if (box && box.active) {
          const x = Math.min(box.x0, box.x1);
          const y = Math.min(box.y0, box.y1);
          const w = Math.abs(box.x1 - box.x0);
          const h = Math.abs(box.y1 - box.y0);
          // Inked underneath, so the box reads over snow as well as over open sea.
          overlay.lineStyle(2, SELECTION_SHADE, 0.55).drawRect(x, y, w, h);
          overlay.lineStyle(1, SELECTION_RING, 0.95);
          overlay.beginFill(SELECTION_RING, 0.07);
          overlay.drawRect(x, y, w, h);
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
        className={`h-full w-full touch-none ${placing ? 'cursor-crosshair' : ''}`}
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
