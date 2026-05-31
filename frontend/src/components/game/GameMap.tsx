import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as PIXI from 'pixi.js';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { scalePolygon } from '../../services/mapService';
import { hapticImpact } from '../../utils/haptics';
import { REGION_PIXI_COLORS } from '../../constants/regionColors';
import {
  STRIKE_MAP_STYLES,
  type MapStrikeFlashProps,
} from '../../utils/mapStrikeEffects';
import type { MapVisualEvent } from '../../utils/mapVisualEvents';
import { playMap2dVisualEffect, type TerritoryCentroid } from '../../utils/map2dVisualEffects';
import type { ContestedBorder } from '../../utils/mapAmbientEffects';
import { prefersReducedMotion } from '../../utils/device';

interface MapTerritory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
}

interface MapConnection {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

interface GameMapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: MapTerritory[];
  connections: MapConnection[];
  regions?: Array<{ region_id: string; name: string; bonus: number }>;
}

interface GameMapProps {
  mapData: GameMapData;
  onTerritoryClick: (territoryId: string) => void;
  width?: number;
  height?: number;
  /** If set, draw a pulsing gold ring on this territory (tutorial highlighting). */
  highlightTerritoryId?: string;
  /** Brief territory flash when a strike ability hits (2D map). */
  strikeFlash?: MapStrikeFlashProps | null;
  /** Server-authoritative map visual events (reinforce, combat, fortify). */
  mapVisualEvents?: MapVisualEvent[];
  /** Called when GameMap consumes an event from the queue (mirrors GlobeMap). */
  onMapVisualDone?: (eventId: string) => void;
  /** Shorten animations on low-power devices / replay fast-forward. */
  reducedEffects?: boolean;
  /** Ambient turn-holder glow + contested border pulses. */
  ambientEnabled?: boolean;
  turnHolderPlayerId?: string | null;
  turnHolderColor?: string;
  contestedBorders?: ContestedBorder[];
  /** If provided, GameMap writes a reset-view callback into this ref. */
  resetViewRef?: React.MutableRefObject<(() => void) | null>;
}

const PLAYER_COLORS: Record<string, number> = {
  '#e74c3c': 0xe74c3c,
  '#3498db': 0x3498db,
  '#2ecc71': 0x2ecc71,
  '#f39c12': 0xf39c12,
  '#9b59b6': 0x9b59b6,
  '#1abc9c': 0x1abc9c,
  '#e67e22': 0xe67e22,
  '#ecf0f1': 0xecf0f1,
};

function hexToPixi(hex: string): number {
  return PLAYER_COLORS[hex] ?? 0x888888;
}

export default function GameMap({
  mapData,
  onTerritoryClick,
  width = 900,
  height = 600,
  highlightTerritoryId,
  strikeFlash,
  mapVisualEvents = [],
  onMapVisualDone,
  reducedEffects = false,
  resetViewRef,
  ambientEnabled = false,
  turnHolderPlayerId,
  turnHolderColor,
  contestedBorders = [],
}: GameMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const territoryGraphicsRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const labelContainerRef = useRef<PIXI.Container | null>(null);
  const mapContainerRef = useRef<PIXI.Container | null>(null);
  const capitalLayerRef = useRef<PIXI.Container | null>(null);
  const buildingLayerRef = useRef<PIXI.Container | null>(null);
  const buildingTextMapRef = useRef<Map<string, PIXI.Text>>(new Map());
  const highlightRingRef = useRef<PIXI.Graphics | null>(null);
  const highlightLayerRef = useRef<PIXI.Container | null>(null);
  const strikeLayerRef = useRef<PIXI.Container | null>(null);
  const strikeFlashRef = useRef<PIXI.Graphics | null>(null);
  const pulseTickerRef = useRef<PIXI.Ticker | null>(null);
  const strikeTickerRef = useRef<PIXI.Ticker | null>(null);
  const effectsLayerRef = useRef<PIXI.Container | null>(null);
  const borderLayerRef = useRef<PIXI.Container | null>(null);
  const turnGlowLayerRef = useRef<PIXI.Container | null>(null);
  const ambientTickerRef = useRef<PIXI.Ticker | null>(null);
  const mapVisualQueueRef = useRef<MapVisualEvent[]>([]);
  const mapVisualSeenRef = useRef(new Set<string>());
  const mapVisualPlayingRef = useRef(false);
  const [mapVisualDebug, setMapVisualDebug] = useState<{ active: boolean; kind?: string }>({ active: false });
  const onMapVisualDoneRef = useRef(onMapVisualDone);
  onMapVisualDoneRef.current = onMapVisualDone;
  /** Pixi pointer handlers are registered once; keep latest parent callback without re-initing the canvas. */
  const onTerritoryClickRef = useRef(onTerritoryClick);
  onTerritoryClickRef.current = onTerritoryClick;

  const { gameState } = useGameStore();
  const { selectedTerritory, attackSource } = useUiStore();

  // Compute map canvas dimensions (from data or bounding box of all polygons)
  const { canvasW, canvasH } = useMemo(() => {
    if (mapData.canvas_width && mapData.canvas_height) {
      return { canvasW: mapData.canvas_width, canvasH: mapData.canvas_height };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of mapData.territories) {
      for (const [x, y] of t.polygon) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const w = maxX > minX ? maxX - minX : 1200;
    const h = maxY > minY ? maxY - minY : 700;
    return { canvasW: w, canvasH: h };
  }, [mapData]);

  // ── Initialize PixiJS Application ─────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || appRef.current) return;

    const app = new PIXI.Application({
      width,
      height,
      backgroundColor: 0x0a0e1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    canvasRef.current.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;

    // Enable panning and zooming
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = new PIXI.Rectangle(0, 0, width, height);

    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let stageStart = { x: 0, y: 0 };

    const mapContainer = new PIXI.Container();
    mapContainerRef.current = mapContainer;
    const capitalLayer = new PIXI.Container();
    capitalLayerRef.current = capitalLayer;
    const labelContainer = new PIXI.Container();
    labelContainerRef.current = labelContainer;
    const buildingLayer = new PIXI.Container();
    buildingLayerRef.current = buildingLayer;
    buildingTextMapRef.current.clear();
    const effectsLayer = new PIXI.Container();
    effectsLayerRef.current = effectsLayer;
    const turnGlowLayer = new PIXI.Container();
    turnGlowLayerRef.current = turnGlowLayer;
    const borderLayer = new PIXI.Container();
    borderLayerRef.current = borderLayer;
    stage.addChild(mapContainer);
    stage.addChild(labelContainer);
    stage.addChild(buildingLayer);

    // ── Region tint layer (rendered below connections and territories) ────────
    const regionTintLayer = new PIXI.Container();
    mapContainer.addChild(regionTintLayer);

    // Group territories by region and assign a stable color per region
    const regionTerritoryMap = new Map<string, MapTerritory[]>();
    for (const t of mapData.territories) {
      const list = regionTerritoryMap.get(t.region_id) ?? [];
      list.push(t);
      regionTerritoryMap.set(t.region_id, list);
    }
    const orderedRegionIds = mapData.regions
      ? mapData.regions.map((r) => r.region_id)
      : [...regionTerritoryMap.keys()].sort();
    const regionColorMap = new Map<string, number>();
    orderedRegionIds.forEach((rid, i) => {
      regionColorMap.set(rid, REGION_PIXI_COLORS[i % REGION_PIXI_COLORS.length]);
    });

    for (const [regionId, territories] of regionTerritoryMap.entries()) {
      if (regionId === 'sea_routes') continue;
      const color = regionColorMap.get(regionId) ?? 0x888888;

      for (const territory of territories) {
        const scaledPoly = scalePolygon(territory.polygon as [number, number][], canvasW, canvasH, width, height);
        if (scaledPoly.length < 3) continue;
        const g = new PIXI.Graphics();
        g.lineStyle(2.5, color, 0.55);
        g.beginFill(color, 0.10);
        g.moveTo(scaledPoly[0][0], scaledPoly[0][1]);
        for (let i = 1; i < scaledPoly.length; i++) g.lineTo(scaledPoly[i][0], scaledPoly[i][1]);
        g.closePath();
        g.endFill();
        regionTintLayer.addChild(g);
      }

      // Region centroid label (name + bonus) floats above the group
      const region = mapData.regions?.find((r) => r.region_id === regionId);
      if (region && territories.length >= 2) {
        const cx = territories.reduce((s, t) => s + t.center_point[0], 0) / territories.length;
        const cy = territories.reduce((s, t) => s + t.center_point[1], 0) / territories.length;
        const [lcx, lcy] = scalePolygon([[cx, cy]], canvasW, canvasH, width, height)[0];
        const fontSize = Math.min(13, Math.max(8, Math.round(canvasW / 85)));
        const regionLabel = new PIXI.Text(`${region.name}  +${region.bonus}`, {
          fontSize,
          fill: color,
          align: 'center',
          fontWeight: 'bold',
        });
        regionLabel.alpha = 0.82;
        regionLabel.anchor.set(0.5);
        regionLabel.position.set(lcx, lcy - 30);
        labelContainer.addChild(regionLabel);
      }
    }

    // Draw connections first (below territories)
    const connectionGraphics = new PIXI.Graphics();
    mapContainer.addChild(connectionGraphics);

    for (const conn of mapData.connections) {
      const from = mapData.territories.find((t) => t.territory_id === conn.from);
      const to = mapData.territories.find((t) => t.territory_id === conn.to);
      if (!from || !to) continue;

      const [fx, fy] = scalePolygon([from.center_point], canvasW, canvasH, width, height)[0];
      const [tx, ty] = scalePolygon([to.center_point], canvasW, canvasH, width, height)[0];

      connectionGraphics.lineStyle(1, conn.type === 'sea' ? 0x2e7d9e : 0x2d3448, 0.5);
      connectionGraphics.moveTo(fx, fy);
      connectionGraphics.lineTo(tx, ty);
    }

    // Draw territories with scaled coordinates
    for (const territory of mapData.territories) {
      const g = new PIXI.Graphics();
      g.eventMode = 'static';
      g.cursor = 'pointer';

      const scaledPolygon = scalePolygon(territory.polygon as [number, number][], canvasW, canvasH, width, height);
      const [cx, cy] = scalePolygon([territory.center_point], canvasW, canvasH, width, height)[0];

      drawTerritory(g, scaledPolygon, 0x2d3448, 0x4a5568);

      // Tap detection: only fire click if pointer hasn't moved far (avoids conflict with pan)
      let tapDownPos: { x: number; y: number } | null = null;
      let tapDownTime = 0;
      g.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
        tapDownPos = { x: e.globalX, y: e.globalY };
        tapDownTime = Date.now();
      });
      g.on('pointerup', (e: PIXI.FederatedPointerEvent) => {
        if (!tapDownPos) return;
        const dist = Math.hypot(e.globalX - tapDownPos.x, e.globalY - tapDownPos.y);
        const elapsed = Date.now() - tapDownTime;
        if (dist <= 10 && elapsed < 300) {
          hapticImpact();
          onTerritoryClickRef.current(territory.territory_id);
        }
        tapDownPos = null;
      });
      g.on('pointerupoutside', () => { tapDownPos = null; });
      g.on('pointerover', () => {
        if (!territoryGraphicsRef.current.get(territory.territory_id)) return;
        g.alpha = 0.85;
      });
      g.on('pointerout', () => {
        g.alpha = 1.0;
      });

      mapContainer.addChild(g);
      territoryGraphicsRef.current.set(territory.territory_id, g);

      // Territory name label — scale font size with canvas width for mobile readability
      const baseLabelSize = Math.min(16, Math.max(10, Math.round(canvasW / 80)));
      const label = new PIXI.Text(territory.name, {
        fontSize: baseLabelSize,
        fill: 0xaaaaaa,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 80,
      });
      label.anchor.set(0.5);
      label.position.set(cx, cy - 12);
      labelContainer.addChild(label);
    }

    mapContainer.addChild(turnGlowLayer);
    mapContainer.addChild(borderLayer);
    mapContainer.addChild(capitalLayer);
    mapContainer.addChild(effectsLayer);

    // ── Pan & Zoom — Pointer Events (supports mouse, touch, and stylus) ──────
    const canvas = app.view as HTMLCanvasElement;
    // Prevent the browser from intercepting touch gestures on the canvas
    canvas.style.touchAction = 'none';

    const activePointers = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let lastTapTime = 0;
    const initialScale = mapContainer.scale.x;

    const syncLayers = (x: number, y: number) => {
      mapContainer.x = x;   mapContainer.y = y;
      labelContainer.x = x; labelContainer.y = y;
      buildingLayer.x = x;  buildingLayer.y = y;
    };

    const scaleAllLayers = (s: number) => {
      mapContainer.scale.set(s);
      labelContainer.scale.set(s);
      buildingLayer.scale.set(s);
      // Hide labels when zoomed out too far to reduce clutter on small screens
      labelContainer.visible = s >= 0.6;
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        // Double-tap: zoom in 2× centered on tap, or reset if near max zoom
        const now = Date.now();
        if (now - lastTapTime < 300) {
          const currentScale = mapContainer.scale.x;
          if (currentScale >= 3.8) {
            syncLayers(0, 0);
            scaleAllLayers(initialScale);
          } else {
            const newScale = Math.min(4, currentScale * 2);
            const ratio = newScale / currentScale;
            const newX = e.clientX - (e.clientX - mapContainer.x) * ratio;
            const newY = e.clientY - (e.clientY - mapContainer.y) * ratio;
            scaleAllLayers(newScale);
            syncLayers(newX, newY);
          }
        }
        lastTapTime = now;
        isDragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        stageStart = { x: mapContainer.x, y: mapContainer.y };
      }
      if (activePointers.size === 2) {
        isDragging = false;
        const pts = [...activePointers.values()];
        pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        pinchStartScale = mapContainer.scale.x;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        // Pinch-to-zoom
        const pts = [...activePointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        scaleAllLayers(Math.max(0.3, Math.min(4, pinchStartScale * (dist / pinchStartDist))));
        return;
      }
      if (isDragging && activePointers.size === 1) {
        syncLayers(
          stageStart.x + (e.clientX - dragStart.x),
          stageStart.y + (e.clientY - dragStart.y),
        );
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      isDragging = false;
      if (activePointers.size === 1) {
        // Resume single-finger pan from current positions
        const [remaining] = activePointers.values();
        dragStart = { x: remaining.x, y: remaining.y };
        stageStart = { x: mapContainer.x, y: mapContainer.y };
        isDragging = true;
      }
    };

    // Mouse-wheel zoom (desktop)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      scaleAllLayers(Math.max(0.3, Math.min(4, mapContainer.scale.x * zoomFactor)));
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Expose reset-view callback to parent
    if (resetViewRef) {
      resetViewRef.current = () => {
        syncLayers(0, 0);
        scaleAllLayers(initialScale);
      };
    }

    return () => {
      if (resetViewRef) resetViewRef.current = null;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      app.destroy(true);
      appRef.current = null;
      mapContainerRef.current = null;
      capitalLayerRef.current = null;
      buildingLayerRef.current = null;
      effectsLayerRef.current = null;
      buildingTextMapRef.current.clear();
      territoryGraphicsRef.current.clear();
    };
  }, [mapData, canvasW, canvasH, width, height]);

  // Capital markers (2D map)
  useEffect(() => {
    const layer = capitalLayerRef.current;
    if (!layer || !gameState) return;
    layer.removeChildren();
    for (const player of gameState.players) {
      const capId = player.capital_territory_id;
      if (!capId) continue;
      const territory = mapData.territories.find((t) => t.territory_id === capId);
      if (!territory) continue;
      const [cx, cy] = scalePolygon([territory.center_point], canvasW, canvasH, width, height)[0];
      const g = new PIXI.Graphics();
      const fill = hexToPixi(player.color);
      g.lineStyle(2, 0xffd700, 1);
      g.beginFill(fill, 0.95);
      const s = 9;
      g.moveTo(cx, cy - s);
      g.lineTo(cx + s, cy);
      g.lineTo(cx, cy + s);
      g.lineTo(cx - s, cy);
      g.closePath();
      g.endFill();
      layer.addChild(g);
    }
  }, [gameState, mapData, canvasW, canvasH, width, height]);

  // ── Update territory colors when game state changes ────────────────────────
  useEffect(() => {
    if (!gameState || !appRef.current) return;

    for (const territory of mapData.territories) {
      const g = territoryGraphicsRef.current.get(territory.territory_id);
      if (!g) continue;

      const tState = gameState.territories[territory.territory_id];
      if (!tState) continue;

      let fillColor = 0x2d3448; // unowned
      let borderColor = 0x4a5568;

      if (tState.owner_id) {
        const player = gameState.players.find((p) => p.player_id === tState.owner_id);
        if (player) {
          fillColor = hexToPixi(player.color);
          borderColor = 0xffffff;
        }
      }

      const isTurnHolder = Boolean(
        ambientEnabled &&
        turnHolderPlayerId &&
        tState.owner_id === turnHolderPlayerId,
      );
      if (isTurnHolder && turnHolderColor) {
        borderColor = hexToPixi(turnHolderColor);
      }

      // Highlight selected territory
      if (territory.territory_id === selectedTerritory || territory.territory_id === attackSource) {
        borderColor = 0xffd700;
      }

      // Wonder glow: thick golden border for territories with a wonder building
      const hasWonder = (tState.buildings ?? []).some((b: string) => b.startsWith('wonder_'));
      const scaledPolygon = scalePolygon(territory.polygon as [number, number][], canvasW, canvasH, width, height);
      if (hasWonder) {
        // Draw an extra golden ring behind the territory
        g.clear();
        if (scaledPolygon.length >= 3) {
          g.lineStyle(4, 0xffd700, 0.75);
          g.beginFill(0, 0);
          g.moveTo(scaledPolygon[0][0], scaledPolygon[0][1]);
          for (let i = 1; i < scaledPolygon.length; i++) g.lineTo(scaledPolygon[i][0], scaledPolygon[i][1]);
          g.closePath();
          g.endFill();
        }
        borderColor = 0xffd700;
      }
      drawTerritory(g, scaledPolygon, fillColor, borderColor, isTurnHolder ? 3 : hasWonder ? 4 : 1.5);
    }

    // ── Building icons ─────────────────────────────────────────────────────
    const buildingLayer = buildingLayerRef.current;
    if (buildingLayer) {
      for (const territory of mapData.territories) {
        const tState = gameState.territories[territory.territory_id];
        const buildings = tState?.buildings ?? [];
        const existing = buildingTextMapRef.current.get(territory.territory_id);

        if (buildings.length === 0) {
          if (existing) existing.visible = false;
          continue;
        }

        const icons = buildings
          .map((t: string) => {
            if (t.includes('port') || t.includes('naval')) return '⚓';
            if (t.includes('fort') || t.includes('wall') || t.includes('castle')) return '🛡';
            if (t.includes('lab') || t.includes('acad') || t.includes('univ') || t.includes('research')) return '🔬';
            if (t.includes('farm') || t.includes('mine') || t.includes('market') || t.includes('plantation')) return '⚙';
            return '🏛';
          })
          .join('');

        const [cx, cy] = scalePolygon([territory.center_point], canvasW, canvasH, width, height)[0];

        if (existing) {
          existing.text = icons;
          existing.position.set(cx + 14, cy - 14);
          existing.visible = true;
        } else {
          const txt = new PIXI.Text(icons, { fontSize: Math.min(15, Math.max(9, Math.round(canvasW / 80) - 1)), align: 'left' });
          txt.anchor.set(0, 0.5);
          txt.position.set(cx + 14, cy - 14);
          buildingLayer.addChild(txt);
          buildingTextMapRef.current.set(territory.territory_id, txt);
        }
      }
    }
  }, [gameState, selectedTerritory, attackSource, mapData, canvasW, canvasH, width, height, ambientEnabled, turnHolderPlayerId, turnHolderColor]);

  // ── Tutorial highlight ring ────────────────────────────────────────────────
  useEffect(() => {
    const app = appRef.current;
    const mapContainer = mapContainerRef.current;
    if (!app || !mapContainer) return;

    // Ensure highlight layer exists on top of the map container
    if (!highlightLayerRef.current) {
      const layer = new PIXI.Container();
      mapContainer.addChild(layer);
      highlightLayerRef.current = layer;
    }
    const layer = highlightLayerRef.current;
    layer.removeChildren();
    highlightRingRef.current = null;

    if (!highlightTerritoryId) {
      if (pulseTickerRef.current) {
        pulseTickerRef.current.destroy();
        pulseTickerRef.current = null;
      }
      return;
    }

    const territory = mapData.territories.find((t) => t.territory_id === highlightTerritoryId);
    if (!territory) return;

    const [cx, cy] = scalePolygon([territory.center_point], canvasW, canvasH, width, height)[0];
    const ring = new PIXI.Graphics();
    layer.addChild(ring);
    highlightRingRef.current = ring;

    let t = 0;
    if (pulseTickerRef.current) pulseTickerRef.current.destroy();
    const ticker = new PIXI.Ticker();
    pulseTickerRef.current = ticker;
    ticker.add((delta) => {
      t = (t + delta * 0.03) % (Math.PI * 2);
      const scale = 1 + 0.18 * Math.sin(t);
      const alpha = 0.55 + 0.45 * Math.abs(Math.sin(t));
      const r = 20 * scale;
      ring.clear();
      ring.lineStyle(3, 0xffd700, alpha);
      ring.drawCircle(cx, cy, r);
    });
    ticker.start();

    return () => {
      ticker.destroy();
      pulseTickerRef.current = null;
    };
  }, [highlightTerritoryId, mapData, canvasW, canvasH, width, height]);

  // ── Strike ability territory flash (2D map) ───────────────────────────────
  useEffect(() => {
    const app = appRef.current;
    const mapContainer = mapContainerRef.current;
    if (!app || !mapContainer) return;

    if (!strikeLayerRef.current) {
      const layer = new PIXI.Container();
      mapContainer.addChild(layer);
      strikeLayerRef.current = layer;
    }
    const layer = strikeLayerRef.current;
    layer.removeChildren();
    strikeFlashRef.current = null;

    if (strikeTickerRef.current) {
      strikeTickerRef.current.destroy();
      strikeTickerRef.current = null;
    }

    if (!strikeFlash) return;

    const territory = mapData.territories.find((t) => t.territory_id === strikeFlash.territoryId);
    if (!territory) return;

    const style = STRIKE_MAP_STYLES[strikeFlash.abilityId];
    const scaledPolygon = scalePolygon(territory.polygon as [number, number][], canvasW, canvasH, width, height);
    if (scaledPolygon.length < 3) return;

    const g = new PIXI.Graphics();
    layer.addChild(g);
    strikeFlashRef.current = g;

    const started = Date.now();
    const ticker = new PIXI.Ticker();
    strikeTickerRef.current = ticker;
    ticker.add(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= style.mapFlashMs) {
        ticker.destroy();
        strikeTickerRef.current = null;
        layer.removeChildren();
        strikeFlashRef.current = null;
        return;
      }
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(elapsed * 0.014));
      const fillAlpha = 0.35 + 0.4 * pulse;
      const borderAlpha = 0.65 + 0.35 * pulse;
      g.clear();
      g.lineStyle(3, style.ringHex, borderAlpha);
      g.beginFill(style.fillHex, fillAlpha);
      g.moveTo(scaledPolygon[0][0], scaledPolygon[0][1]);
      for (let i = 1; i < scaledPolygon.length; i++) {
        g.lineTo(scaledPolygon[i][0], scaledPolygon[i][1]);
      }
      g.closePath();
      g.endFill();
    });
    ticker.start();

    return () => {
      ticker.destroy();
      strikeTickerRef.current = null;
    };
  }, [strikeFlash, mapData, canvasW, canvasH, width, height]);

  // ── Map visual event queue (reinforce / combat / fortify) ─────────────────
  const territoryCentroids = useMemo(() => {
    const m = new Map<string, TerritoryCentroid>();
    for (const t of mapData.territories) {
      const scaledPolygon = scalePolygon(t.polygon as [number, number][], canvasW, canvasH, width, height);
      const [x, y] = scalePolygon([t.center_point], canvasW, canvasH, width, height)[0]!;
      m.set(t.territory_id, { territoryId: t.territory_id, regionId: t.region_id, x, y, polygon: scaledPolygon });
    }
    return m;
  }, [mapData, canvasW, canvasH, width, height]);

  // ── Ambient contested borders + turn-holder shimmer ───────────────────────
  useEffect(() => {
    const glowLayer = turnGlowLayerRef.current;
    const borderLayer = borderLayerRef.current;
    if (!glowLayer || !borderLayer) return;

    if (ambientTickerRef.current) {
      ambientTickerRef.current.destroy();
      ambientTickerRef.current = null;
    }
    glowLayer.removeChildren();
    borderLayer.removeChildren();

    if (!ambientEnabled || prefersReducedMotion() || reducedEffects) return;

    let phase = 0;
    const ticker = new PIXI.Ticker();
    ambientTickerRef.current = ticker;

    ticker.add((delta) => {
      phase += delta * 0.04;
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(phase));

      glowLayer.removeChildren();
      if (turnHolderPlayerId && turnHolderColor && gameState) {
        const glowColor = hexToPixi(turnHolderColor);
        for (const territory of mapData.territories) {
          const tState = gameState.territories[territory.territory_id];
          if (tState?.owner_id !== turnHolderPlayerId) continue;
          const c = territoryCentroids.get(territory.territory_id);
          if (!c) continue;
          const g = new PIXI.Graphics();
          g.lineStyle(2.5, glowColor, pulse * 0.55);
          g.drawCircle(c.x, c.y, 14 + pulse * 6);
          glowLayer.addChild(g);
        }
      }

      borderLayer.removeChildren();
      for (const edge of contestedBorders) {
        const from = territoryCentroids.get(edge.fromId);
        const to = territoryCentroids.get(edge.toId);
        if (!from || !to) continue;
        const g = new PIXI.Graphics();
        const color = edge.sea ? 0xfacc15 : 0xf87171;
        g.lineStyle(2, color, pulse * 0.75);
        g.moveTo(from.x, from.y);
        g.lineTo(to.x, to.y);
        borderLayer.addChild(g);
      }
    });
    ticker.start();

    return () => {
      ticker.destroy();
      ambientTickerRef.current = null;
      glowLayer.removeChildren();
      borderLayer.removeChildren();
    };
  }, [
    ambientEnabled,
    reducedEffects,
    contestedBorders,
    turnHolderPlayerId,
    turnHolderColor,
    gameState,
    mapData.territories,
    territoryCentroids,
  ]);

  useEffect(() => {
    if (prefersReducedMotion() || reducedEffects) return;

    for (const ev of mapVisualEvents) {
      if (mapVisualSeenRef.current.has(ev.id)) continue;
      mapVisualSeenRef.current.add(ev.id);
      mapVisualQueueRef.current.push(ev);
      onMapVisualDoneRef.current?.(ev.id);
    }

    const playNext = () => {
      if (mapVisualPlayingRef.current) return;
      const layer = effectsLayerRef.current;
      if (!layer) {
        window.setTimeout(playNext, 32);
        return;
      }
      const next = mapVisualQueueRef.current.shift();
      if (!next) {
        setMapVisualDebug({ active: false });
        return;
      }
      mapVisualPlayingRef.current = true;
      setMapVisualDebug({ active: true, kind: next.kind });
      playMap2dVisualEffect(layer, next, territoryCentroids, () => {
        mapVisualPlayingRef.current = false;
        setMapVisualDebug({ active: false });
        playNext();
      });
    };

    playNext();
  }, [mapVisualEvents, territoryCentroids, reducedEffects]);

  return (
    <div
      ref={canvasRef}
      className="w-full h-full overflow-hidden rounded-lg border border-bf-border"
      style={{ cursor: 'grab' }}
      data-testid="map-visual-canvas"
      data-map-visual-active={mapVisualDebug.active ? 'true' : undefined}
      data-last-kind={mapVisualDebug.kind}
      data-map-strike-flash-active={strikeFlash ? 'true' : undefined}
    />
  );
}

function drawTerritory(
  g: PIXI.Graphics,
  points: [number, number][],
  fillColor: number,
  borderColor: number,
  borderWidth = 1.5,
): void {
  g.clear();
  if (points.length < 3) return;

  g.lineStyle(borderWidth, borderColor, 1);
  g.beginFill(fillColor, 0.85);
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i][0], points[i][1]);
  }
  g.closePath();
  g.endFill();
}
