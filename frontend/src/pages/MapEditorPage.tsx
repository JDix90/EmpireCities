import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Save, Plus, MousePointer, Pencil, Globe2, Link, Trash2, Check } from 'lucide-react';
import axios from 'axios';
import GlobeMapEditor, {
  type EditorTerritory,
  type EditorConnection,
  type EditorRegion,
  type EditorTool,
} from '../components/editor/GlobeMapEditor';

const REGION_COLORS = [
  '#c9a84c', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a',
];

const TOOLS: { tool: EditorTool; icon: React.ReactNode; title: string }[] = [
  { tool: 'select', icon: <MousePointer className="w-4 h-4" />, title: 'Select' },
  { tool: 'draw', icon: <Pencil className="w-4 h-4" />, title: 'Draw Territory' },
  { tool: 'country_pick', icon: <Globe2 className="w-4 h-4" />, title: 'Pick Country' },
  { tool: 'connect', icon: <Link className="w-4 h-4" />, title: 'Connect' },
  { tool: 'delete', icon: <Trash2 className="w-4 h-4" />, title: 'Delete' },
];

function computeCentroid(ring: [number, number][]): [number, number] {
  if (ring.length === 0) return [0, 0];
  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of ring) {
    lngSum += lng;
    latSum += lat;
  }
  return [lngSum / ring.length, latSum / ring.length];
}

function extractExteriorRing(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): [number, number][] {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates[0] as [number, number][];
  }
  // For MultiPolygon, pick the largest polygon by vertex count
  let best = geometry.coordinates[0]?.[0] ?? [];
  for (const poly of geometry.coordinates) {
    if (poly[0] && poly[0].length > best.length) best = poly[0];
  }
  return best as [number, number][];
}

export default function MapEditorPage() {
  const { mapId } = useParams<{ mapId?: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [territories, setTerritories] = useState<EditorTerritory[]>([]);
  const [connections, setConnections] = useState<EditorConnection[]>([]);
  const [regions, setRegions] = useState<EditorRegion[]>([
    { region_id: 'region_1', name: 'Region 1', bonus: 3 },
  ]);

  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [mapName, setMapName] = useState('My Custom Map');
  const [mapDescription, setMapDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [globeSize, setGlobeSize] = useState({ w: 800, h: 600 });

  // Measure available space for the globe
  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setGlobeSize({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Load existing map
  useEffect(() => {
    if (!mapId) return;
    api.get(`/maps/${mapId}`).then((res) => {
      const data = res.data.map ?? res.data;
      setMapName(data.name);
      setMapDescription(data.description ?? '');
      setTerritories(data.territories ?? []);
      setConnections(data.connections ?? []);
      setRegions(data.regions ?? []);
    }).catch(() => toast.error('Failed to load map'));
  }, [mapId]);

  // Reset tool-specific state when switching tools
  const switchTool = useCallback((tool: EditorTool) => {
    setActiveTool(tool);
    setConnectSource(null);
    setDrawingPoints([]);
  }, []);

  // Escape key deselects and cancels drawing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTerritoryId(null);
        setConnectSource(null);
        setDrawingPoints([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Territory click dispatch — uses functional updaters to avoid stale closures
  // in react-globe.gl's cached event handlers
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const connectSourceRef = useRef(connectSource);
  connectSourceRef.current = connectSource;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  const handleTerritoryClick = useCallback((id: string) => {
    const tool = activeToolRef.current;
    if (tool === 'delete') {
      setTerritories((prev) => prev.filter((t) => t.territory_id !== id));
      setConnections((prev) => prev.filter((c) => c.from !== id && c.to !== id));
      setSelectedTerritoryId((prev) => (prev === id ? null : prev));
    } else if (tool === 'connect') {
      const src = connectSourceRef.current;
      if (!src) {
        setConnectSource(id);
        toast('Click another territory to connect', { icon: '🔗' });
      } else if (src !== id) {
        const exists = connectionsRef.current.some(
          (c) => (c.from === src && c.to === id) || (c.from === id && c.to === src)
        );
        if (!exists) {
          setConnections((prev) => [...prev, { from: src, to: id, type: 'land' }]);
        }
        setConnectSource(null);
      }
    } else {
      // select/country_pick/draw: toggle selection
      setSelectedTerritoryId((prev) => (prev === id ? null : id));
    }
  }, []);

  // Globe background click
  const handleGlobeClick = useCallback((lng: number, lat: number) => {
    const tool = activeToolRef.current;
    if (tool === 'draw') {
      setDrawingPoints((prev) => [...prev, [lng, lat]]);
    } else {
      // Clicking empty globe space deselects
      setSelectedTerritoryId(null);
    }
  }, []);

  // Finish the current free-drawn polygon
  const finishDrawing = useCallback(() => {
    if (drawingPoints.length < 3) {
      toast.error('Need at least 3 points to create a territory');
      return;
    }
    const center = computeCentroid(drawingPoints);
    const newTerritory: EditorTerritory = {
      territory_id: `t_${Date.now()}`,
      name: `Territory ${territories.length + 1}`,
      polygon: drawingPoints,
      center_point: center,
      region_id: regions[0]?.region_id ?? 'region_1',
      geo_polygon: drawingPoints,
    };
    setTerritories((prev) => [...prev, newTerritory]);
    setDrawingPoints([]);
    setSelectedTerritoryId(newTerritory.territory_id);
    toast.success('Territory created!');
  }, [drawingPoints, territories.length, regions]);

  // Country-pick: add a country as a territory
  const handleCountryPick = useCallback((isoCode: string, name: string, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => {
    const alreadyUsed = territories.some((t) => t.iso_codes?.includes(isoCode));
    if (alreadyUsed) {
      toast.error(`${name} is already on the map`);
      return;
    }
    const ring = extractExteriorRing(geometry);
    const center = computeCentroid(ring);
    const newTerritory: EditorTerritory = {
      territory_id: `t_${Date.now()}`,
      name,
      polygon: ring,
      center_point: center,
      region_id: regions[0]?.region_id ?? 'region_1',
      iso_codes: [isoCode],
    };
    setTerritories((prev) => [...prev, newTerritory]);
    setSelectedTerritoryId(newTerritory.territory_id);
    toast.success(`${name} added!`);
  }, [territories, regions]);

  const addRegion = () => {
    const id = `region_${Date.now()}`;
    setRegions((prev) => [...prev, { region_id: id, name: `Region ${prev.length + 1}`, bonus: 3 }]);
  };

  const handleSave = async () => {
    if (territories.length < 6) {
      toast.error('A map needs at least 6 territories');
      return;
    }
    if (connections.length < 5) {
      toast.error('A map needs at least 5 connections');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: mapName,
        description: mapDescription,
        territories,
        connections,
        regions,
      };
      if (mapId) {
        await api.put(`/maps/${mapId}`, payload);
        toast.success('Map updated!');
      } else {
        const res = await api.post('/maps', payload);
        toast.success('Map saved!');
        navigate(`/editor/${res.data.map_id}`);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to save map');
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedTerritory = territories.find((t) => t.territory_id === selectedTerritoryId);

  const toolHints: Record<EditorTool, string> = {
    select: 'Click a territory to select and edit its properties',
    draw: drawingPoints.length > 0
      ? `${drawingPoints.length} point${drawingPoints.length > 1 ? 's' : ''} placed — click to add more, then press Finish`
      : 'Click on the globe to place polygon vertices',
    country_pick: 'Click a country to add it as a territory',
    connect: connectSource ? 'Click a second territory to create a connection' : 'Click a territory to start a connection',
    delete: 'Click a territory to remove it',
  };

  return (
    <div className="h-screen bg-cc-dark flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="min-h-12 pt-safe bg-cc-surface border-b border-cc-border flex items-center px-4 gap-4 shrink-0 py-1">
        <RouterLink to="/lobby" className="font-display text-cc-gold text-sm tracking-widest hover:text-white transition-colors">
          CHRONOCONQUEST
        </RouterLink>
        <span className="text-cc-border">|</span>
        <input
          className="bg-transparent border-none text-cc-gold font-display text-lg focus:outline-none w-64"
          value={mapName}
          onChange={(e) => setMapName(e.target.value)}
          placeholder="Map Name"
        />
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-2 py-1.5">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Map'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar */}
        <div className="w-14 bg-cc-surface border-r border-cc-border flex flex-col items-center py-4 gap-3 shrink-0">
          {TOOLS.map(({ tool, icon, title }) => (
            <button
              key={tool}
              title={title}
              onClick={() => switchTool(tool)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                activeTool === tool ? 'bg-cc-gold text-cc-dark' : 'bg-cc-dark text-cc-muted hover:bg-cc-border'
              }`}
            >
              {icon}
            </button>
          ))}
        </div>

        {/* Globe Canvas */}
        <div ref={containerRef} className="flex-1 overflow-hidden relative">
          <GlobeMapEditor
            territories={territories}
            connections={connections}
            regions={regions}
            selectedTerritoryId={selectedTerritoryId}
            connectSource={connectSource}
            activeTool={activeTool}
            drawingPoints={drawingPoints}
            width={globeSize.w}
            height={globeSize.h}
            onTerritoryClick={handleTerritoryClick}
            onGlobeClickCoords={handleGlobeClick}
            onCountryPick={handleCountryPick}
          />

          {/* Hint bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-cc-surface/90 backdrop-blur border border-cc-border rounded-lg px-4 py-2 text-sm text-cc-muted flex items-center gap-3">
            <span>{toolHints[activeTool]}</span>
            {activeTool === 'draw' && drawingPoints.length >= 3 && (
              <button
                onClick={finishDrawing}
                className="btn-primary text-xs py-1 px-3 flex items-center gap-1"
              >
                <Check className="w-3 h-3" /> Finish
              </button>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-64 bg-cc-surface border-l border-cc-border flex flex-col shrink-0 overflow-y-auto">
          {/* Territory Properties */}
          {selectedTerritory && (
            <div className="p-4 border-b border-cc-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Territory</h3>
                <button
                  onClick={() => setSelectedTerritoryId(null)}
                  className="text-cc-muted hover:text-cc-text transition-colors text-xs"
                  title="Deselect"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="label text-xs">Name</label>
                  <input
                    className="input text-sm py-1.5"
                    value={selectedTerritory.name}
                    onChange={(e) => setTerritories((prev) =>
                      prev.map((t) => t.territory_id === selectedTerritoryId ? { ...t, name: e.target.value } : t)
                    )}
                  />
                </div>
                <div>
                  <label className="label text-xs">Region</label>
                  <select
                    className="input text-sm py-1.5"
                    value={selectedTerritory.region_id}
                    onChange={(e) => setTerritories((prev) =>
                      prev.map((t) => t.territory_id === selectedTerritoryId ? { ...t, region_id: e.target.value } : t)
                    )}
                  >
                    {regions.map((r) => (
                      <option key={r.region_id} value={r.region_id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                {selectedTerritory.iso_codes && (
                  <div className="text-xs text-cc-muted">
                    ISO: {selectedTerritory.iso_codes.join(', ')}
                  </div>
                )}
                <button
                  onClick={() => {
                    const id = selectedTerritoryId!;
                    setTerritories((prev) => prev.filter((t) => t.territory_id !== id));
                    setConnections((prev) => prev.filter((c) => c.from !== id && c.to !== id));
                    setSelectedTerritoryId(null);
                  }}
                  className="w-full text-xs py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Remove Territory
                </button>
              </div>
            </div>
          )}

          {/* Regions */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Regions</h3>
              <button onClick={addRegion} className="text-cc-gold hover:text-white transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              {regions.map((region, idx) => (
                <div key={region.region_id} className="p-2 bg-cc-dark rounded-lg border border-cc-border">
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: REGION_COLORS[idx % REGION_COLORS.length] }}
                    />
                    <input
                      className="bg-transparent text-sm text-cc-text flex-1 focus:outline-none"
                      value={region.name}
                      onChange={(e) => setRegions((prev) =>
                        prev.map((r) => r.region_id === region.region_id ? { ...r, name: e.target.value } : r)
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-cc-muted">Bonus:</label>
                    <input
                      type="number"
                      className="input text-xs py-0.5 w-16"
                      min={1}
                      max={20}
                      value={region.bonus}
                      onChange={(e) => setRegions((prev) =>
                        prev.map((r) => r.region_id === region.region_id ? { ...r, bonus: Number(e.target.value) } : r)
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="p-4 border-t border-cc-border mt-auto">
            <div className="space-y-1 text-xs text-cc-muted">
              <div className="flex justify-between">
                <span>Territories:</span>
                <span className="text-cc-text">{territories.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Connections:</span>
                <span className="text-cc-text">{connections.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Regions:</span>
                <span className="text-cc-text">{regions.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
