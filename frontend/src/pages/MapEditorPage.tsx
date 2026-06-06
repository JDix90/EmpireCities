import React, { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import BrandWordmark from '../components/ui/BrandWordmark';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Save, Plus, MousePointer, Pencil, Globe2, Link, Trash2, Check, ArrowLeft, Undo2, Redo2 } from 'lucide-react';
import axios from 'axios';
import { isMobileViewport } from '../utils/device';
import type {
  EditorTerritory,
  EditorConnection,
  EditorRegion,
  EditorTool,
} from '../components/editor/GlobeMapEditor';
import { GlobeMapEditorLazy, preloadGlobeEditorChunk } from '../utils/globeLoader';

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
  const [isDirty, setIsDirty] = useState(false);
  const skipDirtyRef = useRef(true); // suppress dirty on initial mount and load

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  interface EditorSnapshot {
    territories: EditorTerritory[];
    connections: EditorConnection[];
    regions: EditorRegion[];
    mapName: string;
    mapDescription: string;
  }
  const historyRef = useRef<EditorSnapshot[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const territoriesRef = useRef(territories);
  territoriesRef.current = territories;
  const connectionsRef2 = useRef(connections);
  connectionsRef2.current = connections;
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const mapNameRef = useRef(mapName);
  mapNameRef.current = mapName;
  const mapDescRef = useRef(mapDescription);
  mapDescRef.current = mapDescription;

  const updateUndoRedoFlags = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const takeSnapshot = useCallback((): EditorSnapshot => ({
    territories: structuredClone(territoriesRef.current),
    connections: structuredClone(connectionsRef2.current),
    regions: structuredClone(regionsRef.current),
    mapName: mapNameRef.current,
    mapDescription: mapDescRef.current,
  }), []);

  const pushHistory = useCallback((snap: EditorSnapshot) => {
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > 50) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    updateUndoRedoFlags();
  }, [updateUndoRedoFlags]);

  // Capture snapshot BEFORE a user mutation; call immediately before setState calls.
  const recordUndo = useCallback(() => { pushHistory(takeSnapshot()); }, [pushHistory, takeSnapshot]);

  const applySnapshot = useCallback((snap: EditorSnapshot) => {
    skipDirtyRef.current = true;
    setTerritories(snap.territories);
    setConnections(snap.connections);
    setRegions(snap.regions);
    setMapName(snap.mapName);
    setMapDescription(snap.mapDescription);
    updateUndoRedoFlags();
  }, [updateUndoRedoFlags]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    applySnapshot(historyRef.current[historyIndexRef.current]!);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    applySnapshot(historyRef.current[historyIndexRef.current]!);
  }, [applySnapshot]);

  // Keyboard: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (meta && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
  const [globeSize, setGlobeSize] = useState({ w: 800, h: 600 });

  // Mark dirty whenever user changes map content, but not on initial load/save
  useEffect(() => {
    if (skipDirtyRef.current) {
      skipDirtyRef.current = false;
      return;
    }
    setIsDirty(true);
   
  }, [territories, connections, regions, mapName, mapDescription]);

  // Warn on page close/refresh when there are unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    preloadGlobeEditorChunk();
  }, []);

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

  // Seed history with the initial empty state on first render (new maps)
  useEffect(() => {
    if (!mapId) {
      historyRef.current = [takeSnapshot()];
      historyIndexRef.current = 0;
      updateUndoRedoFlags();
    }
  // Only run once on mount
   
  }, []);

  // Load existing map (not dirty until user edits after load)
  useEffect(() => {
    if (!mapId) return;
    api.get(`/maps/${mapId}`).then((res) => {
      const data = res.data.map ?? res.data;
      skipDirtyRef.current = true;
      setMapName(data.name);
      setMapDescription(data.description ?? '');
      setTerritories(data.territories ?? []);
      setConnections(data.connections ?? []);
      setRegions(data.regions ?? []);
      setIsDirty(false);
      // Seed history after load — use setTimeout so state has settled
      setTimeout(() => {
        historyRef.current = [takeSnapshot()];
        historyIndexRef.current = 0;
        updateUndoRedoFlags();
      }, 0);
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
      recordUndo();
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
          recordUndo();
          setConnections((prev) => [...prev, { from: src, to: id, type: 'land' }]);
        }
        setConnectSource(null);
      }
    } else {
      // select/country_pick/draw: toggle selection
      setSelectedTerritoryId((prev) => (prev === id ? null : id));
    }
  }, [recordUndo]);

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
    recordUndo();
    setTerritories((prev) => [...prev, newTerritory]);
    setDrawingPoints([]);
    setSelectedTerritoryId(newTerritory.territory_id);
    toast.success('Territory created!');
  }, [drawingPoints, territories.length, regions, recordUndo]);

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
    recordUndo();
    setTerritories((prev) => [...prev, newTerritory]);
    setSelectedTerritoryId(newTerritory.territory_id);
    toast.success(`${name} added!`);
  }, [territories, regions, recordUndo]);

  const addRegion = () => {
    recordUndo();
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
      skipDirtyRef.current = true;
      setIsDirty(false);
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
    <div className="h-screen bg-bf-dark flex flex-col overflow-hidden">
      {/* Mobile warning — map editing requires a pointer device */}
      {isMobileViewport() && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bf-dark px-6 text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <h2 className="font-display text-xl text-bf-gold mb-2">Desktop Required</h2>
          <p className="text-bf-muted text-sm max-w-xs">
            Map editing requires a mouse or trackpad. Please open the editor on a laptop or desktop.
          </p>
          <RouterLink
            to="/lobby"
            className="btn-secondary mt-6 flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Lobby
          </RouterLink>
        </div>
      )}

      {/* Top Bar */}
      <div className="min-h-12 pt-safe bg-bf-surface border-b border-bf-border flex items-center px-4 gap-4 shrink-0 py-1">
        <BrandWordmark to="/lobby" className="text-sm" />
        <span className="text-bf-border">|</span>
        <input
          className="bg-transparent border-none text-bf-gold font-display text-lg focus:outline-none w-64"
          value={mapName}
          onFocus={recordUndo}
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
        <div className="w-14 bg-bf-surface border-r border-bf-border flex flex-col items-center py-4 gap-3 shrink-0">
          {TOOLS.map(({ tool, icon, title }) => (
            <button
              key={tool}
              title={title}
              onClick={() => switchTool(tool)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                activeTool === tool ? 'bg-bf-gold text-bf-dark' : 'bg-bf-dark text-bf-muted hover:bg-bf-border'
              }`}
            >
              {icon}
            </button>
          ))}
          <div className="mt-2 border-t border-bf-border w-full pt-2 flex flex-col items-center gap-2">
            <button
              title="Undo (Ctrl+Z)"
              onClick={undo}
              disabled={!canUndo}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border disabled:opacity-30"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              title="Redo (Ctrl+Shift+Z)"
              onClick={redo}
              disabled={!canRedo}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border disabled:opacity-30"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Globe Canvas */}
        <div ref={containerRef} className="flex-1 overflow-hidden relative">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-bf-muted animate-pulse">Loading editor globe…</div>}>
            <GlobeMapEditorLazy
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
          </Suspense>

          {/* Hint bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-bf-surface/90 backdrop-blur border border-bf-border rounded-lg px-4 py-2 text-sm text-bf-muted flex items-center gap-3">
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
        <div className="w-64 bg-bf-surface border-l border-bf-border flex flex-col shrink-0 overflow-y-auto">
          {/* Territory Properties */}
          {selectedTerritory && (
            <div className="p-4 border-b border-bf-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider">Territory</h3>
                <button
                  onClick={() => setSelectedTerritoryId(null)}
                  className="text-bf-muted hover:text-bf-text transition-colors text-xs"
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
                    onFocus={recordUndo}
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
                    onChange={(e) => {
                      recordUndo();
                      setTerritories((prev) =>
                        prev.map((t) => t.territory_id === selectedTerritoryId ? { ...t, region_id: e.target.value } : t)
                      );
                    }}
                  >
                    {regions.map((r) => (
                      <option key={r.region_id} value={r.region_id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                {selectedTerritory.iso_codes && (
                  <div className="text-xs text-bf-muted">
                    ISO: {selectedTerritory.iso_codes.join(', ')}
                  </div>
                )}
                <button
                  onClick={() => {
                    const id = selectedTerritoryId!;
                    recordUndo();
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
              <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider">Regions</h3>
              <button onClick={addRegion} className="text-bf-gold hover:text-white transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              {regions.map((region, idx) => (
                <div key={region.region_id} className="p-2 bg-bf-dark rounded-lg border border-bf-border">
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: REGION_COLORS[idx % REGION_COLORS.length] }}
                    />
                    <input
                      className="bg-transparent text-sm text-bf-text flex-1 focus:outline-none"
                      value={region.name}
                      onFocus={recordUndo}
                      onChange={(e) => setRegions((prev) =>
                        prev.map((r) => r.region_id === region.region_id ? { ...r, name: e.target.value } : r)
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-bf-muted">Bonus:</label>
                    <input
                      type="number"
                      className="input text-xs py-0.5 w-16"
                      min={1}
                      max={20}
                      value={region.bonus}
                      onFocus={recordUndo}
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
          <div className="p-4 border-t border-bf-border mt-auto">
            <div className="space-y-1 text-xs text-bf-muted">
              <div className="flex justify-between">
                <span>Territories:</span>
                <span className="text-bf-text">{territories.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Connections:</span>
                <span className="text-bf-text">{connections.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Regions:</span>
                <span className="text-bf-text">{regions.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
