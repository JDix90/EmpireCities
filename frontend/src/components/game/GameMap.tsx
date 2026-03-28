import React, { useEffect, useRef, useMemo } from 'react';
import * as PIXI from 'pixi.js';
import { useGameStore } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { scalePolygon } from '../../services/mapService';

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
  type: 'land' | 'sea';
}

interface GameMapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: MapTerritory[];
  connections: MapConnection[];
}

interface GameMapProps {
  mapData: GameMapData;
  onTerritoryClick: (territoryId: string) => void;
  width?: number;
  height?: number;
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

export default function GameMap({ mapData, onTerritoryClick, width = 900, height = 600 }: GameMapProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const territoryGraphicsRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const labelContainerRef = useRef<PIXI.Container | null>(null);

  const { gameState, selectedTerritory, attackSource } = useGameStore();
  const { user } = useAuthStore();

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
    const labelContainer = new PIXI.Container();
    labelContainerRef.current = labelContainer;
    stage.addChild(mapContainer);
    stage.addChild(labelContainer);

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

      g.on('pointerdown', () => onTerritoryClick(territory.territory_id));
      g.on('pointerover', () => {
        if (!territoryGraphicsRef.current.get(territory.territory_id)) return;
        g.alpha = 0.85;
      });
      g.on('pointerout', () => {
        g.alpha = 1.0;
      });

      mapContainer.addChild(g);
      territoryGraphicsRef.current.set(territory.territory_id, g);

      // Territory name label
      const label = new PIXI.Text(territory.name, {
        fontSize: 10,
        fill: 0xaaaaaa,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 80,
      });
      label.anchor.set(0.5);
      label.position.set(cx, cy - 12);
      labelContainer.addChild(label);
    }

    // Pan handling
    (app.view as HTMLCanvasElement).addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      stageStart = { x: mapContainer.x, y: mapContainer.y };
    });

    (app.view as HTMLCanvasElement).addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      mapContainer.x = stageStart.x + (e.clientX - dragStart.x);
      mapContainer.y = stageStart.y + (e.clientY - dragStart.y);
      labelContainer.x = mapContainer.x;
      labelContainer.y = mapContainer.y;
    });

    (app.view as HTMLCanvasElement).addEventListener('mouseup', () => { isDragging = false; });

    // Zoom handling
    (app.view as HTMLCanvasElement).addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.3, Math.min(4, mapContainer.scale.x * zoomFactor));
      mapContainer.scale.set(newScale);
      labelContainer.scale.set(newScale);
    });

    return () => {
      app.destroy(true);
      appRef.current = null;
      territoryGraphicsRef.current.clear();
    };
  }, [mapData, canvasW, canvasH, width, height]);

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

      // Highlight selected territory
      if (territory.territory_id === selectedTerritory || territory.territory_id === attackSource) {
        borderColor = 0xffd700;
      }

      const scaledPolygon = scalePolygon(territory.polygon as [number, number][], canvasW, canvasH, width, height);
      drawTerritory(g, scaledPolygon, fillColor, borderColor);
    }
  }, [gameState, selectedTerritory, attackSource, mapData, canvasW, canvasH, width, height]);

  return (
    <div
      ref={canvasRef}
      className="w-full h-full overflow-hidden rounded-lg border border-cc-border"
      style={{ cursor: 'grab' }}
    />
  );
}

function drawTerritory(
  g: PIXI.Graphics,
  points: [number, number][],
  fillColor: number,
  borderColor: number
): void {
  g.clear();
  if (points.length < 3) return;

  g.lineStyle(1.5, borderColor, 1);
  g.beginFill(fillColor, 0.85);
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i][0], points[i][1]);
  }
  g.closePath();
  g.endFill();
}
