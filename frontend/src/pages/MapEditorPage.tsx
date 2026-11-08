import React, { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import BrandWordmark from '../components/ui/BrandWordmark';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Save, Plus, MousePointer, Pencil, Globe2, Link, Trash2, Check, ArrowLeft, Undo2, Redo2, AlertTriangle, CheckCircle2, History } from 'lucide-react';
import axios from 'axios';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import { isMobileViewport } from '../utils/device';
import type {
  EditorTerritory,
  EditorConnection,
  EditorRegion,
  EditorTool,
} from '../components/editor/GlobeMapEditor';
import { GlobeMapEditorLazy, preloadGlobeEditorChunk } from '../utils/globeLoader';
import {
  clearEditorDraft,
  describeDraftAge,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftSnapshot,
} from '../utils/mapEditorDraft';

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

/** Mirrors the server's SAFE_DESCRIPTION_REGEX so a bad character is caught while typing, not at save. */
const SAFE_DESCRIPTION = /^[\p{L}\p{N} '’._\-:()&,!?\n\r"/]*$/u;

function regionCountLabel(n: number): string {
  return `${n} territor${n === 1 ? 'y' : 'ies'}`;
}

/** " — 3 territories, 2 connections." for the recovery banner, or just the full stop. */
function draftSummary(d: EditorDraftSnapshot): string {
  const t = d.territories.length;
  if (t === 0) return '.';
  const c = d.connections.length;
  return ` — ${t} territor${t === 1 ? 'y' : 'ies'}, ${c} connection${c === 1 ? '' : 's'}.`;
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
  // What the Connect tool draws next: a land border, or a sea lane (dashed in game).
  const [connectType, setConnectType] = useState<'land' | 'sea'>('land');
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [mapName, setMapName] = useState('My Custom Map');
  const [mapDescription, setMapDescription] = useState('');
  const [eraTheme, setEraTheme] = useState('');
  // Moderation state of the saved map (drives the status pill + submit button).
  const [moderationStatus, setModerationStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Publish-quality warnings from the last save — what review would block on.
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  // When the server last ran those checks for us; null until the first save.
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const skipDirtyRef = useRef(true); // suppress dirty on initial mount and load
  // Unsaved work this browser kept from an earlier visit, offered back once.
  const [pendingDraft, setPendingDraft] = useState<EditorDraftSnapshot | null>(null);

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  interface EditorSnapshot {
    territories: EditorTerritory[];
    connections: EditorConnection[];
    regions: EditorRegion[];
    mapName: string;
    mapDescription: string;
    eraTheme: string;
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
  const eraThemeRef = useRef(eraTheme);
  eraThemeRef.current = eraTheme;

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
    eraTheme: eraThemeRef.current,
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
    setEraTheme(snap.eraTheme);
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
   
  }, [territories, connections, regions, mapName, mapDescription, eraTheme]);

  // Local recovery: a second after any unsaved change, keep a snapshot in this
  // browser. A successful save clears it; a crash or closed tab leaves it for
  // the next visit to offer back.
  useEffect(() => {
    if (!isDirty) return;
    const handle = window.setTimeout(() => {
      writeEditorDraft(mapId ?? null, {
        v: 1,
        savedAt: Date.now(),
        mapName,
        mapDescription,
        eraTheme,
        territories,
        connections,
        regions,
      });
    }, 1000);
    return () => window.clearTimeout(handle);
  }, [isDirty, mapId, mapName, mapDescription, eraTheme, territories, connections, regions]);

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

  // Seed history with the initial empty state on first render (new maps),
  // and offer back any unsaved new map this browser kept.
  useEffect(() => {
    if (!mapId) {
      historyRef.current = [takeSnapshot()];
      historyIndexRef.current = 0;
      updateUndoRedoFlags();
      setPendingDraft(readEditorDraft(null));
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
      setPendingDraft(readEditorDraft(mapId));
      // Seed history after load — use setTimeout so state has settled
      setTimeout(() => {
        historyRef.current = [takeSnapshot()];
        historyIndexRef.current = 0;
        updateUndoRedoFlags();
      }, 0);
    }).catch(() => toast.error('Failed to load map'));
  }, [mapId]);  

  const restorePendingDraft = useCallback(() => {
    if (!pendingDraft) return;
    recordUndo();
    skipDirtyRef.current = false;
    setTerritories(pendingDraft.territories);
    setConnections(pendingDraft.connections);
    setRegions(pendingDraft.regions);
    setMapName(pendingDraft.mapName);
    setMapDescription(pendingDraft.mapDescription);
    setEraTheme(pendingDraft.eraTheme);
    setSelectedTerritoryId(null);
    setIsDirty(true);
    setPendingDraft(null);
    toast.success('Unsaved changes restored');
  }, [pendingDraft, recordUndo]);

  const discardPendingDraft = useCallback(() => {
    clearEditorDraft(mapId ?? null);
    setPendingDraft(null);
  }, [mapId]);

  // Switching tools drops a half-made connection but keeps a half-drawn
  // polygon: the points stay where they are until Finish, Escape or a tool
  // that consumes them, so the author can rotate, select or pick a country
  // mid-shape and come back to it.
  const switchTool = useCallback((tool: EditorTool) => {
    setActiveTool(tool);
    setConnectSource(null);
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
  const connectTypeRef = useRef(connectType);
  connectTypeRef.current = connectType;

  const sameEdge = (c: EditorConnection, from: string, to: string) =>
    (c.from === from && c.to === to) || (c.from === to && c.to === from);

  const removeConnection = useCallback((from: string, to: string) => {
    recordUndo();
    setConnections((prev) => prev.filter((c) => !sameEdge(c, from, to)));
  }, [recordUndo]);

  const toggleConnectionType = useCallback((from: string, to: string) => {
    recordUndo();
    setConnections((prev) => prev.map((c) =>
      sameEdge(c, from, to) ? { ...c, type: c.type === 'sea' ? 'land' : 'sea' } : c,
    ));
  }, [recordUndo]);

  // A click on a connection line on the globe: Delete removes it, Connect
  // switches it between land and sea. Other tools leave it alone.
  const handleConnectionClick = useCallback((from: string, to: string) => {
    const tool = activeToolRef.current;
    if (tool === 'delete') removeConnection(from, to);
    else if (tool === 'connect') toggleConnectionType(from, to);
  }, [removeConnection, toggleConnectionType]);

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
          setConnections((prev) => [...prev, { from: src, to: id, type: connectTypeRef.current }]);
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

  // Removing a region moves its territories to another one rather than
  // leaving them pointing at nothing; the last region stays.
  const removeRegion = (regionId: string) => {
    const fallback = regions.find((r) => r.region_id !== regionId);
    if (!fallback) return;
    const moved = territories.filter((t) => t.region_id === regionId).length;
    recordUndo();
    setTerritories((prev) => prev.map((t) => (t.region_id === regionId ? { ...t, region_id: fallback.region_id } : t)));
    setRegions((prev) => prev.filter((r) => r.region_id !== regionId));
    if (moved > 0) toast(`${moved} territor${moved === 1 ? 'y' : 'ies'} moved to ${fallback.name}`);
  };

  const territoryCountByRegion = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of territories) counts.set(t.region_id, (counts.get(t.region_id) ?? 0) + 1);
    return counts;
  }, [territories]);

  const territoryNameById = React.useMemo(
    () => new Map(territories.map((t) => [t.territory_id, t.name] as const)),
    [territories],
  );

  const descriptionInvalid = !SAFE_DESCRIPTION.test(mapDescription);

  // The map document endpoint has no moderation fields; the author's own
  // listing does. One fetch drives the status pill and the submit button.
  useEffect(() => {
    if (!mapId) {
      setModerationStatus(null);
      return;
    }
    api.get<Array<{ map_id: string; moderation_status: string; era_theme: string | null }>>('/maps/me')
      .then((res) => {
        const mine = res.data.find((m) => m.map_id === mapId);
        if (mine) {
          setModerationStatus(mine.moderation_status);
          if (mine.era_theme) setEraTheme(mine.era_theme);
        }
      })
      .catch(() => {});
  }, [mapId]);

  const handleSubmitForReview = async () => {
    if (!mapId || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post<{ message: string }>(`/maps/${mapId}/publish`, {});
      toast.success(res.data.message);
      setModerationStatus('pending');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to submit for review');
        const details = err.response?.data?.errors as string[] | undefined;
        if (details?.length) setSaveWarnings(details);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Saving never gates on size: a two-territory draft is a draft. The floor a
  // playable map needs comes back from the server as the warnings list.
  const handleSave = async () => {
    if (mapName.trim().length === 0) {
      toast.error('Give the map a name first');
      return;
    }
    if (descriptionInvalid) {
      toast.error('The description has a character the server will not accept');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: mapName,
        description: mapDescription,
        // Era matching in the hub filters on this; without it a community map
        // can never appear under its era.
        era_theme: eraTheme || undefined,
        territories,
        connections,
        regions,
      };
      if (mapId) {
        const res = await api.put<{ message: string; warnings?: string[] }>(`/maps/${mapId}`, payload);
        toast.success(res.data.message || 'Map updated!');
        setSaveWarnings(res.data.warnings ?? []);
        setCheckedAt(Date.now());
        // Editing an approved map unlists it pending re-review.
        if (moderationStatus === 'approved') setModerationStatus('pending');
        clearEditorDraft(mapId);
      } else {
        const res = await api.post<{ map_id: string; message: string; warnings?: string[] }>('/maps', payload);
        toast.success(res.data.message || 'Map saved!');
        setSaveWarnings(res.data.warnings ?? []);
        setCheckedAt(Date.now());
        setModerationStatus('draft');
        // The unsaved-map slot is spoken for by the saved copy from here on.
        clearEditorDraft(null);
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
  const selectedConnections = selectedTerritoryId
    ? connections.filter((c) => c.from === selectedTerritoryId || c.to === selectedTerritoryId)
    : [];

  const toolHints: Record<EditorTool, string> = {
    select: 'Click a territory to select and edit its properties',
    draw: drawingPoints.length > 0
      ? `${drawingPoints.length} point${drawingPoints.length > 1 ? 's' : ''} placed — click to add more, drag to rotate, then press Finish`
      : 'Click the globe to place each corner of the territory; drag to rotate',
    country_pick: 'Click a country to add it as a territory',
    connect: connectSource
      ? `Click a second territory to add a ${connectType === 'sea' ? 'sea lane' : 'land border'}`
      : 'Click a territory to start a connection, or an existing line to switch it between land and sea',
    delete: 'Click a territory or a connection line to remove it',
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
      <div className="min-h-12 pt-safe-1 pb-1 bg-bf-surface border-b border-bf-border flex items-center px-4 gap-4 shrink-0">
        <BrandWordmark to="/lobby" className="text-sm" />
        <span className="text-bf-border">|</span>
        <input
          className="bg-transparent border-none text-bf-gold font-display text-lg focus:outline-none w-64"
          value={mapName}
          onFocus={recordUndo}
          onChange={(e) => setMapName(e.target.value)}
          placeholder="Map Name"
        />
        {/* Era tag: the hub's era filter matches on this — untagged maps never
            surface under an era. */}
        <select
          className="bg-bf-dark border border-bf-border rounded-lg text-xs text-bf-text py-1 px-2"
          value={eraTheme}
          onChange={(e) => { recordUndo(); setEraTheme(e.target.value); }}
          title="Era theme (used by the community hub's era filter)"
        >
          <option value="">No era tag</option>
          {Object.entries(ERA_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <div className="flex-1" />
        {moderationStatus && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full border ${
              moderationStatus === 'approved'
                ? 'bg-green-600/20 border-green-400/40 text-green-300'
                : moderationStatus === 'pending'
                  ? 'bg-amber-600/20 border-amber-400/40 text-amber-300'
                  : moderationStatus === 'rejected'
                    ? 'bg-red-600/20 border-red-400/40 text-red-300'
                    : 'bg-slate-600/20 border-slate-400/40 text-slate-300'
            }`}
            title="Moderation status — community maps are reviewed before they are listed"
          >
            {moderationStatus === 'pending' ? 'In review' : moderationStatus}
          </span>
        )}
        {mapId && (moderationStatus === 'draft' || moderationStatus === 'rejected') && (
          <button
            onClick={() => void handleSubmitForReview()}
            disabled={submitting || isDirty}
            title={isDirty
              ? 'Save your changes first'
              : saveWarnings.length > 0
                ? `Review will block on the ${saveWarnings.length} item${saveWarnings.length === 1 ? '' : 's'} listed under "Before you publish"`
                : 'Send this map to moderation review'}
            className="btn-secondary text-sm py-1.5 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
        )}
        <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-2 py-1.5">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Map'}
        </button>
      </div>

      {/* Unsaved work this browser kept from an earlier visit. */}
      {pendingDraft && (
        <div className="bg-bf-gold/10 border-b border-bf-gold/30 px-4 py-2 text-xs text-bf-text shrink-0 flex items-center gap-3">
          <History className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
          <span className="flex-1">
            Unsaved changes from <span className="text-bf-gold">{describeDraftAge(pendingDraft.savedAt)}</span> were
            found on this device
            <span className="text-bf-muted">{draftSummary(pendingDraft)}</span>
          </span>
          <button onClick={restorePendingDraft} className="btn-primary text-xs py-1 px-3">Restore</button>
          <button onClick={discardPendingDraft} className="btn-secondary text-xs py-1 px-3">Discard</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar */}
        <div className="w-14 bg-bf-surface border-r border-bf-border flex flex-col items-center py-4 gap-3 shrink-0">
          {TOOLS.map(({ tool, icon, title }) => (
            <button
              key={tool}
              title={tool === 'draw' && drawingPoints.length > 0 && activeTool !== 'draw'
                ? `${title} — ${drawingPoints.length} point${drawingPoints.length > 1 ? 's' : ''} waiting`
                : title}
              onClick={() => switchTool(tool)}
              className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                activeTool === tool ? 'bg-bf-gold text-bf-dark' : 'bg-bf-dark text-bf-muted hover:bg-bf-border'
              }`}
            >
              {icon}
              {tool === 'draw' && drawingPoints.length > 0 && activeTool !== 'draw' && (
                <span
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-bf-gold border border-bf-surface"
                  aria-hidden
                />
              )}
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
              onConnectionClick={handleConnectionClick}
            />
          </Suspense>

          {/* Hint bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-bf-surface/90 backdrop-blur border border-bf-border rounded-lg px-4 py-2 text-sm text-bf-muted flex items-center gap-3">
            <span>{toolHints[activeTool]}</span>
            {activeTool === 'connect' && (
              <div className="flex items-center gap-0.5 rounded-md border border-bf-border p-0.5" role="radiogroup" aria-label="Connection type">
                {(['land', 'sea'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={connectType === t}
                    onClick={() => setConnectType(t)}
                    className={`px-2 py-0.5 rounded text-xs ${connectType === t ? 'bg-bf-gold text-bf-dark' : 'text-bf-muted hover:text-bf-text'}`}
                  >
                    {t === 'land' ? 'Land border' : 'Sea lane'}
                  </button>
                ))}
              </div>
            )}
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
          {/* Map details: what the hub card shows beside the name and era. */}
          <div className="p-4 border-b border-bf-border">
            <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-3">Map</h3>
            <label className="label text-xs" htmlFor="map-editor-description">Description</label>
            <textarea
              id="map-editor-description"
              className={`input text-sm py-1.5 resize-none ${descriptionInvalid ? 'border-red-500/60' : ''}`}
              rows={3}
              maxLength={512}
              value={mapDescription}
              onFocus={recordUndo}
              onChange={(e) => setMapDescription(e.target.value)}
              placeholder="What is this map about? Shown on its card in the Map Hub."
            />
            <p className={`text-[11px] mt-1 ${descriptionInvalid ? 'text-red-300' : 'text-bf-muted text-right'}`}>
              {descriptionInvalid
                ? 'Letters, numbers and basic punctuation only'
                : `${mapDescription.length}/512`}
            </p>
          </div>

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
                <div>
                  <label className="label text-xs">Connections ({selectedConnections.length})</label>
                  {selectedConnections.length === 0 ? (
                    <p className="text-[11px] text-bf-muted">None yet. Use the Connect tool to link it to a neighbour.</p>
                  ) : (
                    <ul className="space-y-1">
                      {selectedConnections.map((c) => {
                        const otherId = c.from === selectedTerritoryId ? c.to : c.from;
                        const other = territoryNameById.get(otherId) ?? otherId;
                        return (
                          <li key={`${c.from}|${c.to}`} className="flex items-center gap-1.5 text-xs">
                            <span className="flex-1 truncate text-bf-text" title={other}>{other}</span>
                            <button
                              type="button"
                              onClick={() => toggleConnectionType(c.from, c.to)}
                              title="Switch between a land border and a sea lane"
                              className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${
                                c.type === 'sea' ? 'border-sky-500/40 text-sky-300' : 'border-bf-border text-bf-muted'
                              }`}
                            >
                              {c.type}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeConnection(c.from, c.to)}
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
                      className="bg-transparent text-sm text-bf-text flex-1 min-w-0 focus:outline-none"
                      value={region.name}
                      onFocus={recordUndo}
                      onChange={(e) => setRegions((prev) =>
                        prev.map((r) => r.region_id === region.region_id ? { ...r, name: e.target.value } : r)
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => removeRegion(region.region_id)}
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
                    <span
                      className={`ml-auto text-[11px] ${
                        (territoryCountByRegion.get(region.region_id) ?? 0) < 2 && region.bonus > 0
                          ? 'text-amber-300'
                          : 'text-bf-muted'
                      }`}
                      title="A region with a bonus pays only once it holds two or more territories"
                    >
                      {regionCountLabel(territoryCountByRegion.get(region.region_id) ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Publish checks from the last save: the full list, not three of
              them in a strip. Review blocks on exactly these. */}
          {checkedAt !== null && (
            <div className="p-4 border-t border-bf-border">
              {saveWarnings.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden />
                    <h3 className="text-xs font-medium text-amber-300 uppercase tracking-wider">Before you publish</h3>
                    <span className="ml-auto text-[11px] text-bf-muted">{saveWarnings.length}</span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-amber-100/90 list-disc pl-4">
                    {saveWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-bf-muted">
                    Your draft is saved. Review blocks on these, so fix them before you submit.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-green-300">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span>Passes every publish check.</span>
                </div>
              )}
            </div>
          )}

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
