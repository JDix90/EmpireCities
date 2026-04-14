/**
 * Eras of Empire — Map Preview Component
 * Renders a compact SVG preview of a game map showing territories
 * colored by region, with hover tooltips.
 */

import { useState, useEffect, useRef } from 'react';
import { fetchMapById, GameMap, Territory, ERA_METADATA, scalePolygon } from '../../services/mapService';
import { Loader2 } from 'lucide-react';

// Distinct region colors for preview
const REGION_COLORS = [
  '#E74C3C', '#3498DB', '#2ECC71', '#F39C12',
  '#9B59B6', '#1ABC9C', '#E67E22', '#E91E63',
  '#00BCD4', '#8BC34A', '#FF5722', '#607D8B',
];

interface MapPreviewProps {
  mapId: string;
  /** Optional pre-loaded map data — skips the API fetch when provided. */
  mapData?: GameMap | null;
  width?: number;
  height?: number;
  className?: string;
}

export default function MapPreview({ mapId, mapData, width = 480, height = 280, className = '' }: MapPreviewProps) {
  const [map, setMap]             = useState<GameMap | null>(mapData ?? null);
  const [loading, setLoading]     = useState(!mapData);
  const [hovered, setHovered]     = useState<string | null>(null);
  const [tooltip, setTooltip]     = useState<{ x: number; y: number; name: string } | null>(null);
  const svgRef                    = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (mapData) { setMap(mapData); setLoading(false); return; }
    setLoading(true);
    setMap(null);
    fetchMapById(mapId)
      .then(m => { setMap(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mapId, mapData]);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-900 rounded-lg ${className}`}
        style={{ width, height }}
      >
        <Loader2 className="animate-spin text-gray-500" size={24} />
      </div>
    );
  }

  if (!map) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-900 rounded-lg text-gray-500 text-sm ${className}`}
        style={{ width, height }}
      >
        Preview unavailable
      </div>
    );
  }

  const meta = ERA_METADATA[map.era_theme] || ERA_METADATA['ww2'];

  // Build region → color map
  const regionColorMap = new Map<string, string>();
  map.regions.forEach((r, i) => {
    regionColorMap.set(r.region_id, REGION_COLORS[i % REGION_COLORS.length]);
  });

  // Build territory → region name map
  const territoryRegionMap = new Map<string, string>();
  for (const t of map.territories) {
    const region = map.regions.find(r => r.region_id === t.region_id);
    territoryRegionMap.set(t.territory_id, region?.name || '');
  }

  return (
    <div
      className={`relative rounded-lg overflow-hidden ${className}`}
      style={{ width, height, backgroundColor: meta.bgColor }}
    >
      {/* Era label overlay */}
      <div className="absolute top-2 left-2 z-10 text-xs font-bold px-2 py-1 rounded"
           style={{ backgroundColor: meta.color + '33', color: meta.color }}>
        {meta.label} · {meta.year}
      </div>

      {/* Territory count */}
      <div className="absolute top-2 right-2 z-10 text-xs text-gray-400">
        {map.territories.length} territories
      </div>

      {/* SVG Map */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0"
      >
        {/* Connection lines */}
        {map.connections.map((c, i) => {
          const from = map.territories.find(t => t.territory_id === c.from);
          const to   = map.territories.find(t => t.territory_id === c.to);
          if (!from || !to) return null;

          const [fx, fy] = scalePolygon([from.center_point], map.canvas_width, map.canvas_height, width, height)[0];
          const [tx, ty] = scalePolygon([to.center_point],   map.canvas_width, map.canvas_height, width, height)[0];

          return (
            <line
              key={i}
              x1={fx} y1={fy} x2={tx} y2={ty}
              stroke={c.type === 'sea' ? '#3498DB44' : '#FFFFFF22'}
              strokeWidth={c.type === 'sea' ? 0.8 : 0.5}
              strokeDasharray={c.type === 'sea' ? '3,3' : undefined}
            />
          );
        })}

        {/* Territory polygons */}
        {map.territories.map(t => {
          const scaled  = scalePolygon(t.polygon, map.canvas_width, map.canvas_height, width, height);
          const points  = scaled.map(([x, y]) => `${x},${y}`).join(' ');
          const color   = regionColorMap.get(t.region_id) || '#666';
          const isHov   = hovered === t.territory_id;

          return (
            <polygon
              key={t.territory_id}
              points={points}
              fill={isHov ? color : color + 'CC'}
              stroke={isHov ? '#FFFFFF' : '#FFFFFF44'}
              strokeWidth={isHov ? 1.5 : 0.5}
              className="cursor-pointer transition-all duration-100"
              onMouseEnter={(e) => {
                setHovered(t.territory_id);
                const rect = svgRef.current?.getBoundingClientRect();
                if (rect) {
                  const [cx, cy] = scalePolygon([t.center_point], map.canvas_width, map.canvas_height, width, height)[0];
                  setTooltip({ x: cx, y: cy, name: t.name });
                }
              }}
              onMouseLeave={() => {
                setHovered(null);
                setTooltip(null);
              }}
            />
          );
        })}

        {/* Territory center dots */}
        {map.territories.map(t => {
          const [cx, cy] = scalePolygon([t.center_point], map.canvas_width, map.canvas_height, width, height)[0];
          return (
            <circle
              key={`dot-${t.territory_id}`}
              cx={cx} cy={cy} r={1.5}
              fill="white"
              opacity={0.4}
              style={{ pointerEvents: 'none' }}
            />
          );
        })}

        {/* Tooltip */}
        {tooltip && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={Math.min(tooltip.x - 40, width - 90)}
              y={Math.max(tooltip.y - 28, 4)}
              width={Math.min(tooltip.name.length * 6.5 + 12, 160)}
              height={18}
              rx={3}
              fill="#000000CC"
            />
            <text
              x={Math.min(tooltip.x - 34, width - 84)}
              y={Math.max(tooltip.y - 14, 16)}
              fill="white"
              fontSize={10}
              fontFamily="sans-serif"
            >
              {tooltip.name}
            </text>
          </g>
        )}
      </svg>

      {/* Region legend */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 max-w-[70%]">
        {map.regions.slice(0, 6).map((r, i) => (
          <div key={r.region_id} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: REGION_COLORS[i % REGION_COLORS.length] }}
            />
            <span className="text-[9px] text-gray-400 truncate max-w-[60px]">{r.name}</span>
          </div>
        ))}
        {map.regions.length > 6 && (
          <span className="text-[9px] text-gray-500">+{map.regions.length - 6} more</span>
        )}
      </div>
    </div>
  );
}
