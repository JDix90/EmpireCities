import React from 'react';
import { Crosshair, Network, Scissors } from 'lucide-react';
import { useMapEditorStore } from '../../store/mapEditorStore';

interface TerritoryPanelProps {
  /** Add the land borders and straits this territory shares with the others. */
  onConnectNeighbors: (territoryId: string) => void;
  /** Fly the globe to it. */
  onFocus: (territoryId: string) => void;
  /** Countries the provinces file covers, so a whole country can be split. */
  provinceCountries?: ReadonlySet<string>;
  onSplit?: (territoryId: string) => void;
  splitting?: boolean;
}

/** The selected territory: name, region, its connections, and the ways out. */
export default function TerritoryPanel({
  onConnectNeighbors,
  onFocus,
  provinceCountries,
  onSplit,
  splitting = false,
}: TerritoryPanelProps) {
  const selectedId = useMapEditorStore((s) => s.selectedTerritoryId);
  const territories = useMapEditorStore((s) => s.territories);
  const regions = useMapEditorStore((s) => s.regions);
  const connections = useMapEditorStore((s) => s.connections);

  const territory = territories.find((t) => t.territory_id === selectedId);
  if (!territory || !selectedId) return null;

  const act = useMapEditorStore.getState();
  const nameOf = (id: string) => territories.find((t) => t.territory_id === id)?.name ?? id;
  const mine = connections.filter((c) => c.from === selectedId || c.to === selectedId);

  return (
    <div className="p-4 border-b border-bf-border" data-testid="territory-panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider">Territory</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onFocus(selectedId)}
            className="text-bf-muted hover:text-bf-text transition-colors"
            title="Fly to this territory"
            aria-label="Fly to this territory"
          >
            <Crosshair className="w-3.5 h-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => act.select(null)}
            className="text-bf-muted hover:text-bf-text transition-colors text-xs"
            title="Deselect"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <label className="label text-xs" htmlFor="territory-name">Name</label>
          <input
            id="territory-name"
            className="input text-sm py-1.5"
            value={territory.name}
            onFocus={() => act.beginEdit()}
            onChange={(e) => act.renameTerritory(selectedId, e.target.value)}
          />
        </div>
        <div>
          <label className="label text-xs" htmlFor="territory-region">Region</label>
          <select
            id="territory-region"
            className="input text-sm py-1.5"
            value={territory.region_id}
            onChange={(e) => act.setTerritoryRegion(selectedId, e.target.value)}
          >
            {regions.map((r) => (
              <option key={r.region_id} value={r.region_id}>{r.name}</option>
            ))}
          </select>
        </div>
        {territory.iso_codes && (
          <div className="text-xs text-bf-muted">ISO: {territory.iso_codes.join(', ')}</div>
        )}
        {territory.admin1 && territory.admin1.length > 0 && (
          <div className="text-xs text-bf-muted">
            {territory.admin1.length === 1 ? 'Province: ' : 'Provinces: '}
            {territory.admin1.join(', ')}
          </div>
        )}
        {onSplit && provinceCountries && territory.iso_codes?.length === 1 && provinceCountries.has(territory.iso_codes[0]) && (
          <div>
            <button
              type="button"
              onClick={() => onSplit(selectedId)}
              disabled={splitting}
              className="w-full text-xs py-1.5 rounded border border-bf-gold/40 text-bf-gold hover:bg-bf-gold/10 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Scissors className="w-3.5 h-3.5" aria-hidden />
              <span>{splitting ? 'Loading provinces…' : 'Split into provinces'}</span>
            </button>
            <p className="text-[11px] text-bf-muted mt-1 leading-snug">
              Its states or provinces become territories of their own, in this region, connected along their borders. One undo step.
            </p>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label text-xs mb-0">Connections ({mine.length})</label>
            <button
              type="button"
              onClick={() => onConnectNeighbors(selectedId)}
              className="inline-flex items-center gap-1 text-[11px] text-bf-gold hover:text-white transition-colors"
              title="Add the borders and straits this territory shares with the others"
            >
              <Network className="w-3 h-3" aria-hidden />
              <span>Connect neighbours</span>
            </button>
          </div>
          {mine.length === 0 ? (
            <p className="text-[11px] text-bf-muted">None yet. Connect neighbours, or use the Connect tool.</p>
          ) : (
            <ul className="space-y-1">
              {mine.map((c) => {
                const otherId = c.from === selectedId ? c.to : c.from;
                const other = nameOf(otherId);
                return (
                  <li key={`${c.from}|${c.to}`} className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => act.select(otherId)}
                      className="flex-1 truncate text-left text-bf-text hover:text-bf-gold"
                      title={`Select ${other}`}
                    >
                      {other}
                    </button>
                    <button
                      type="button"
                      onClick={() => act.toggleConnectionType(c.from, c.to)}
                      title="Switch between a land border and a sea lane"
                      className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${
                        c.type === 'sea' ? 'border-sky-500/40 text-sky-300' : 'border-bf-border text-bf-muted'
                      }`}
                    >
                      {c.type}
                    </button>
                    <button
                      type="button"
                      onClick={() => act.removeConnection(c.from, c.to)}
                      title="Remove connection"
                      aria-label={`Remove connection to ${other}`}
                      className="text-bf-muted hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => act.removeTerritory(selectedId)}
          className="w-full text-xs py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Remove Territory
        </button>
      </div>
    </div>
  );
}
