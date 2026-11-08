import React, { useMemo } from 'react';
import { PaintBucket, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMapEditorStore } from '../../store/mapEditorStore';
import { regionColorHex } from './editorGlobeData';
import { regionStats, suggestRegionBonus } from './editorGeo';
import { MAP_MIN_BONUS_REGION_TERRITORIES } from '@borderfall/shared';

function countLabel(n: number): string {
  return `${n} territor${n === 1 ? 'y' : 'ies'}`;
}

/**
 * Regions, with the Paint tool a click away: pick a region's bucket and
 * every territory you click joins it. Each card shows how many territories
 * it holds (amber when a bonus region is below the two the game pays on) and
 * the bonus the rule of thumb suggests for its size and borders.
 */
export default function RegionsPanel() {
  const regions = useMapEditorStore((s) => s.regions);
  const territories = useMapEditorStore((s) => s.territories);
  const connections = useMapEditorStore((s) => s.connections);
  const paintRegionId = useMapEditorStore((s) => s.paintRegionId);
  const activeTool = useMapEditorStore((s) => s.activeTool);
  const act = useMapEditorStore.getState();

  const stats = useMemo(() => regionStats(territories, connections), [territories, connections]);

  const startPainting = (regionId: string) => {
    act.setPaintRegion(regionId);
    act.setTool('paint');
  };

  return (
    <div className="p-4" data-testid="regions-panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider">Regions</h3>
        <button
          type="button"
          onClick={() => {
            const id = act.addRegion();
            startPainting(id);
          }}
          className="inline-flex items-center gap-1 text-bf-gold hover:text-white transition-colors text-xs"
          title="Add a region and start painting territories into it"
        >
          <Plus className="w-4 h-4" aria-hidden />
          <span>New</span>
        </button>
      </div>
      <div className="space-y-3">
        {regions.map((region, idx) => {
          const s = stats.get(region.region_id) ?? { size: 0, borders: 0 };
          const suggested = suggestRegionBonus(s.size, s.borders);
          const thin = s.size < MAP_MIN_BONUS_REGION_TERRITORIES && region.bonus > 0;
          const painting = activeTool === 'paint' && paintRegionId === region.region_id;
          return (
            <div
              key={region.region_id}
              className={`p-2 bg-bf-dark rounded-lg border ${painting ? 'border-bf-gold' : 'border-bf-border'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => (painting ? act.setTool('select') : startPainting(region.region_id))}
                  className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                    painting ? 'border-bf-gold bg-bf-gold/20' : 'border-transparent hover:border-bf-border'
                  }`}
                  style={{ color: regionColorHex(idx) }}
                  title={painting ? 'Stop painting' : 'Paint territories into this region'}
                  aria-pressed={painting}
                  aria-label={`Paint territories into ${region.name}`}
                >
                  <PaintBucket className="w-3.5 h-3.5" aria-hidden />
                </button>
                <input
                  className="bg-transparent text-sm text-bf-text flex-1 min-w-0 focus:outline-none"
                  value={region.name}
                  onFocus={() => act.beginEdit()}
                  onChange={(e) => act.renameRegion(region.region_id, e.target.value)}
                  aria-label="Region name"
                />
                <button
                  type="button"
                  onClick={() => {
                    const result = act.removeRegion(region.region_id);
                    if (result && result.moved > 0) toast(`${countLabel(result.moved)} moved to ${result.fallbackName}`);
                  }}
                  disabled={regions.length <= 1}
                  title={regions.length <= 1
                    ? 'A map needs at least one region'
                    : 'Remove region (its territories move to another region)'}
                  aria-label={`Remove region ${region.name}`}
                  className="text-bf-muted hover:text-red-400 transition-colors text-xs disabled:opacity-30 disabled:hover:text-bf-muted"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-bf-muted" htmlFor={`bonus-${region.region_id}`}>Bonus:</label>
                <input
                  id={`bonus-${region.region_id}`}
                  type="number"
                  className="input text-xs py-0.5 w-14"
                  min={1}
                  max={20}
                  value={region.bonus}
                  onFocus={() => act.beginEdit()}
                  onChange={(e) => act.setRegionBonus(region.region_id, Number(e.target.value))}
                />
                {suggested > 0 && suggested !== region.bonus && (
                  <button
                    type="button"
                    onClick={() => {
                      act.beginEdit();
                      act.setRegionBonus(region.region_id, suggested);
                    }}
                    className="text-[11px] text-bf-gold hover:text-white transition-colors"
                    title={`A third of the territories plus half the border territories: ${s.size} territories, ${s.borders} on a border`}
                  >
                    Suggested: {suggested}
                  </button>
                )}
                <span
                  className={`ml-auto text-[11px] ${thin ? 'text-amber-300' : 'text-bf-muted'}`}
                  title="A region with a bonus pays only once it holds two or more territories"
                >
                  {countLabel(s.size)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
