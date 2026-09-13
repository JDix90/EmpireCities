import { useCallback, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import type { TerrainGrid } from '@borderfall/warfront-sim';
import { buildTerrainImage } from '../../warfront/terrainImage';
import {
  clampCamera,
  fitCamera,
  panCamera,
  screenToWorld,
  zoomCameraAt,
  type Camera,
} from '../../warfront/camera';

/**
 * The Warfront tactical plane: the terrain grid as one nearest-neighbour sprite, with
 * drag-to-pan and wheel-to-zoom.
 *
 * Kept deliberately thin. The arithmetic lives in ../../warfront/camera.ts and the
 * colours in ../../warfront/terrainImage.ts, both pure and unit-tested; PixiJS needs a
 * GPU context that jsdom has not got, so anything that must be tested stays out of here.
 *
 * Only ever mounted inside the admin-gated Warfront route, and the page that renders it
 * is lazy-loaded, so none of this reaches a player's bundle.
 */

export interface WarfrontTerrainCanvasProps {
  grid: TerrainGrid;
  /** Reports camera changes so the page can show the zoom level. */
  onCameraChange?: (camera: Camera) => void;
  /** Reports the cell under the pointer, or -1 when the pointer leaves the plane. */
  onHoverCell?: (cellIndex: number) => void;
}

const BACKGROUND = 0x0a0e1a;
const WHEEL_ZOOM_STEP = 1.0015;

export default function WarfrontTerrainCanvas({ grid, onCameraChange, onHoverCell }: WarfrontTerrainCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const cameraRef = useRef<Camera>({ x: grid.width / 2, y: grid.height / 2, scale: 1 });
  const viewportRef = useRef({ width: 1, height: 1 });
  const worldRef = useRef({ width: grid.width, height: grid.height });
  const [ready, setReady] = useState(false);

  worldRef.current = { width: grid.width, height: grid.height };

  /** Pushes the camera onto the sprite transform. The sprite is one pixel per cell. */
  const applyCamera = useCallback(() => {
    const sprite = spriteRef.current;
    if (!sprite) return;
    const camera = cameraRef.current;
    const viewport = viewportRef.current;
    sprite.scale.set(camera.scale);
    sprite.position.set(viewport.width / 2 - camera.x * camera.scale, viewport.height / 2 - camera.y * camera.scale);
    onCameraChange?.(camera);
  }, [onCameraChange]);

  const setCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next;
      applyCamera();
    },
    [applyCamera],
  );

  // Mount PixiJS once per grid. The terrain image is baked here rather than during
  // render: it is ~600k cells and must not be rebuilt on a pan.
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

    cameraRef.current = fitCamera(worldRef.current, viewportRef.current);
    applyCamera();
    setReady(true);

    return () => {
      setReady(false);
      spriteRef.current = null;
      appRef.current = null;
      texture.destroy(true);
      app.destroy(true);
    };
    // Deliberately keyed on the grid alone: re-running on the camera callback's identity
    // would tear down and rebuild the GPU context on every parent render.
  }, [grid]);

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

  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const localPoint = (e: { clientX: number; clientY: number; currentTarget: EventTarget & HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (onHoverCell) {
      const point = localPoint(e);
      const w = screenToWorld(cameraRef.current, viewportRef.current, point.x, point.y);
      const col = Math.floor(w.x);
      const row = Math.floor(w.y);
      onHoverCell(grid.inBounds(col, row) ? grid.index(col, row) : -1);
    }
    const drag = dragRef.current;
    if (!drag) return;
    setCamera(panCamera(cameraRef.current, worldRef.current, viewportRef.current, e.clientX - drag.x, e.clientY - drag.y));
    dragRef.current = { x: e.clientX, y: e.clientY };
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
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
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(e) => {
          endDrag(e);
          onHoverCell?.(-1);
        }}
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
