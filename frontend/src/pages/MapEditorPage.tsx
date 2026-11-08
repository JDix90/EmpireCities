import React, { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import BrandWordmark from '../components/ui/BrandWordmark';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Save, MousePointer, Pencil, Globe2, Link, Trash2, Check, ArrowLeft, Undo2, Redo2, History,
  PaintBucket, Maximize2, Download, LayoutTemplate, Keyboard, Plus,
} from 'lucide-react';
import axios from 'axios';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import { isMobileViewport } from '../utils/device';
import { GlobeMapEditorLazy, preloadGlobeEditorChunk } from '../utils/globeLoader';
import type { GlobeFocus } from '../components/editor/GlobeMapEditor';
import {
  TerritoryPolygonCache,
  regionColorHex,
  type EditorTerritory,
  type EditorTool,
  type PolyGeom,
} from '../components/editor/editorGlobeData';
import { useEditorCountries } from '../hooks/useEditorCountries';
import {
  DEFAULT_MAP_NAME,
  emptyContent,
  newEditorId,
  useMapEditorStore,
  type MapEditorContent,
} from '../store/mapEditorStore';
import { evaluateMapHealth, type MapHealthIssue } from '@borderfall/shared';
import {
  bridgeComponents,
  closeRing,
  findNeighbors,
  geometryBbox,
  geometryLabelPoint,
  largestExteriorRing,
  ringOverlaps,
  ringSelfIntersects,
  trimRing,
  type GeoBbox,
  type Ring,
  type RingOverlap,
  type TerritoryGeom,
} from '../components/editor/editorGeo';
import { buildContinentTemplate, continentOptions, type CountryInfo } from '../components/editor/editorTemplates';
import {
  clearEditorDraft,
  describeDraftAge,
  readEditorDraft,
  sanitizeEditorContent,
  writeEditorDraft,
  type EditorDraftSnapshot,
} from '../utils/mapEditorDraft';
import MapHealthPanel, { type MapHealthFix } from '../components/editor/MapHealthPanel';
import EditorStartScreen from '../components/editor/EditorStartScreen';
import CountrySearch from '../components/editor/CountrySearch';
import EditorGuide, { type GuideStep } from '../components/editor/EditorGuide';
import TerritoryPanel from '../components/editor/TerritoryPanel';
import RegionsPanel from '../components/editor/RegionsPanel';

const TOOLS: { tool: EditorTool; icon: React.ReactNode; title: string; shortcut: string }[] = [
  { tool: 'select', icon: <MousePointer className="w-4 h-4" />, title: 'Select', shortcut: 'V' },
  { tool: 'country_pick', icon: <Globe2 className="w-4 h-4" />, title: 'Pick Country', shortcut: 'P' },
  { tool: 'draw', icon: <Pencil className="w-4 h-4" />, title: 'Draw Territory', shortcut: 'D' },
  { tool: 'connect', icon: <Link className="w-4 h-4" />, title: 'Connect', shortcut: 'C' },
  { tool: 'paint', icon: <PaintBucket className="w-4 h-4" />, title: 'Paint Region', shortcut: 'R' },
  { tool: 'delete', icon: <Trash2 className="w-4 h-4" />, title: 'Delete', shortcut: 'X' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['V · P · D · C · R · X', 'Select · Pick Country · Draw · Connect · Paint · Delete'],
  ['Enter / Backspace', 'Finish the outline / remove its last point'],
  ['Esc', 'Deselect, cancel a connection, clear the outline'],
  ['F', 'Fit the whole map in view'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+S', 'Save'],
  ['?', 'This list'],
];

/** Mirrors the server's SAFE_DESCRIPTION_REGEX so a bad character is caught while typing, not at save. */
const SAFE_DESCRIPTION = /^[\p{L}\p{N} '’._\-:()&,!?\n\r"/]*$/u;

const act = () => useMapEditorStore.getState();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A camera altitude that shows the whole box, with a little air around it. */
function altitudeForBbox(b: GeoBbox, pad = 1.4): number {
  const midLat = (b.minLat + b.maxLat) / 2;
  const span = Math.max(b.maxLat - b.minLat, (b.maxLng - b.minLng) * Math.cos((midLat * Math.PI) / 180));
  return clamp((span / 45) * pad, 0.35, 2.5);
}

function listNames(names: string[], limit = 3): string {
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
}

/** " — 3 territories, 2 connections." for the recovery banner, or just the full stop. */
function draftSummary(d: EditorDraftSnapshot): string {
  const t = d.territories.length;
  if (t === 0) return '.';
  const c = d.connections.length;
  return ` — ${t} territor${t === 1 ? 'y' : 'ies'}, ${c} connection${c === 1 ? '' : 's'}.`;
}

function slugFilename(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map'}.json`;
}

export default function MapEditorPage() {
  const { mapId } = useParams<{ mapId?: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const eraRef = useRef<HTMLSelectElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // ── The document and tool state ──────────────────────────────────────────
  const territories = useMapEditorStore((s) => s.territories);
  const connections = useMapEditorStore((s) => s.connections);
  const regions = useMapEditorStore((s) => s.regions);
  const mapName = useMapEditorStore((s) => s.mapName);
  const mapDescription = useMapEditorStore((s) => s.mapDescription);
  const eraTheme = useMapEditorStore((s) => s.eraTheme);
  const activeTool = useMapEditorStore((s) => s.activeTool);
  const selectedTerritoryId = useMapEditorStore((s) => s.selectedTerritoryId);
  const connectSource = useMapEditorStore((s) => s.connectSource);
  const connectType = useMapEditorStore((s) => s.connectType);
  const paintRegionId = useMapEditorStore((s) => s.paintRegionId);
  const drawingPoints = useMapEditorStore((s) => s.drawingPoints);
  const highlightedTerritoryIds = useMapEditorStore((s) => s.highlightedTerritoryIds);
  const isDirty = useMapEditorStore((s) => s.isDirty);
  const canUndo = useMapEditorStore((s) => s.past.length > 0);
  const canRedo = useMapEditorStore((s) => s.future.length > 0);

  // ── Country data and territory geometry ──────────────────────────────────
  const { ready: countriesReady, isoToFeatures, countryData, countries } = useEditorCountries();
  const countryByCode = useMemo(() => new Map(countries.map((c) => [c.code, c] as const)), [countries]);
  const continents = useMemo(() => continentOptions(countries), [countries]);

  const polygonCacheRef = useRef(new TerritoryPolygonCache());
  const territoryPolygons = useMemo(
    () => polygonCacheRef.current.build(territories, isoToFeatures),
    [territories, isoToFeatures],
  );
  const geometryById = useMemo(
    () => new Map(territoryPolygons.map((p) => [p.id, p.geometry] as const)),
    [territoryPolygons],
  );
  const territoryGeoms = useMemo(
    (): TerritoryGeom[] => territoryPolygons.map((p) => ({ id: p.id, geometry: p.geometry })),
    [territoryPolygons],
  );
  const usedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const t of territories) t.iso_codes?.forEach((c) => set.add(c));
    return set;
  }, [territories]);

  // ── Live map health: the publish rules, plus advice ──────────────────────
  const report = useMemo(
    () => evaluateMapHealth({
      name: mapName,
      description: mapDescription,
      era_theme: eraTheme,
      territories,
      connections,
      regions,
    }),
    [mapName, mapDescription, eraTheme, territories, connections, regions],
  );

  // ── Page state ───────────────────────────────────────────────────────────
  const [moderationStatus, setModerationStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // What publish reported on the last save; shown only where the live rules see nothing.
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const [pendingDraft, setPendingDraft] = useState<EditorDraftSnapshot | null>(null);
  const [overlapPrompt, setOverlapPrompt] = useState<{ ring: Ring; overlaps: RingOverlap[] } | null>(null);
  const [focus, setFocus] = useState<GlobeFocus | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [startOpen, setStartOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [globeSize, setGlobeSize] = useState({ w: 800, h: 600 });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  useEffect(() => {
    preloadGlobeEditorChunk();
  }, []);

  // The store outlives the page: start clean, and leave clean.
  useEffect(() => () => act().reset(), []);

  // A new map: empty store, any unsaved new map this browser kept, and the
  // start screen when there is nothing to show.
  useEffect(() => {
    if (mapId) return;
    act().reset();
    const draft = readEditorDraft(null);
    setPendingDraft(draft);
    setStartOpen(!draft);
    setServerWarnings([]);
    setModerationStatus(null);
  }, [mapId]);

  // An existing map: the saved copy is where history starts.
  useEffect(() => {
    if (!mapId) return;
    let cancelled = false;
    api.get(`/maps/${mapId}`).then((res) => {
      if (cancelled) return;
      const data = res.data.map ?? res.data;
      act().replaceContent({
        mapName: data.name ?? DEFAULT_MAP_NAME,
        mapDescription: data.description ?? '',
        eraTheme: typeof data.era_theme === 'string' ? data.era_theme : '',
        territories: data.territories ?? [],
        connections: data.connections ?? [],
        regions: data.regions ?? [],
      });
      setPendingDraft(readEditorDraft(mapId));
      setStartOpen(false);
    }).catch(() => toast.error('Failed to load map'));
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  // The map document endpoint has no moderation fields; the author's own
  // listing does. One fetch drives the status pill and the submit button.
  useEffect(() => {
    if (!mapId) return;
    api.get<Array<{ map_id: string; moderation_status: string }>>('/maps/me')
      .then((res) => {
        const mine = res.data.find((m) => m.map_id === mapId);
        if (mine) setModerationStatus(mine.moderation_status);
      })
      .catch(() => {});
  }, [mapId]);

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
    const measure = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setGlobeSize({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ── Camera ───────────────────────────────────────────────────────────────
  const flyTo = useCallback((lat: number, lng: number, altitude: number) => {
    setFocus({ lat, lng, altitude, nonce: Date.now() });
  }, []);

  const focusBbox = useCallback((b: GeoBbox, pad?: number) => {
    flyTo((b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2, altitudeForBbox(b, pad));
  }, [flyTo]);

  const focusTerritory = useCallback((id: string) => {
    const g = geometryById.get(id);
    if (g) focusBbox(geometryBbox(g), 2);
  }, [geometryById, focusBbox]);

  const fitView = useCallback(() => {
    if (territoryGeoms.length === 0) return;
    const box: GeoBbox = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
    for (const t of territoryGeoms) {
      const b = geometryBbox(t.geometry);
      box.minLng = Math.min(box.minLng, b.minLng);
      box.minLat = Math.min(box.minLat, b.minLat);
      box.maxLng = Math.max(box.maxLng, b.maxLng);
      box.maxLat = Math.max(box.maxLat, b.maxLat);
    }
    focusBbox(box);
  }, [territoryGeoms, focusBbox]);

  // A template or a loaded map asks for a fit once its geometry is on screen.
  useEffect(() => {
    if (fitNonce > 0) fitView();
  }, [fitNonce]); // fitView itself changes with every edit; only the request should trigger it

  // ── Adding territories, with the connections the globe can see ───────────
  const neighborsOf = useCallback((geometry: PolyGeom, excludeId?: string) => {
    const others = excludeId ? territoryGeoms.filter((t) => t.id !== excludeId) : territoryGeoms;
    return findNeighbors(geometry, others);
  }, [territoryGeoms]);

  const nameOf = useCallback((id: string) => act().territories.find((t) => t.territory_id === id)?.name ?? id, []);

  const handleCountryPick = useCallback((code: string, name: string, geometry: PolyGeom) => {
    const s = act();
    if (s.territories.some((t) => t.iso_codes?.includes(code))) {
      toast.error(`${name} is already on the map`);
      return;
    }
    const info = countryByCode.get(code);
    const neighbors = neighborsOf(geometry);
    const id = newEditorId('t');
    const territory: EditorTerritory = {
      territory_id: id,
      name,
      polygon: largestExteriorRing(geometry),
      center_point: info?.label ?? geometryLabelPoint(geometry),
      region_id: s.paintRegionId ?? s.regions[0]?.region_id ?? 'region_1',
      iso_codes: [code],
    };
    s.addTerritory(territory, neighbors.map((n) => ({ from: id, to: n.id, type: n.type })));
    toast.success(
      neighbors.length > 0
        ? `${name} added — connected to ${listNames(neighbors.map((n) => nameOf(n.id)))}`
        : `${name} added`,
    );
  }, [countryByCode, neighborsOf, nameOf]);

  const pickFromSearch = useCallback((c: CountryInfo) => {
    handleCountryPick(c.code, c.name, c.geometry);
    focusBbox(geometryBbox(c.geometry), 2);
  }, [handleCountryPick, focusBbox]);

  const createDrawnTerritory = useCallback((ring: Ring) => {
    const s = act();
    const geometry: PolyGeom = { type: 'Polygon', coordinates: [closeRing(ring)] };
    const neighbors = neighborsOf(geometry);
    const id = newEditorId('t');
    s.addTerritory({
      territory_id: id,
      name: `Territory ${s.territories.length + 1}`,
      polygon: ring,
      center_point: geometryLabelPoint(geometry),
      region_id: s.paintRegionId ?? s.regions[0]?.region_id ?? 'region_1',
      geo_polygon: ring,
    }, neighbors.map((n) => ({ from: id, to: n.id, type: n.type })));
    s.clearDrawing();
    setOverlapPrompt(null);
    toast.success(
      neighbors.length > 0
        ? `Territory created — connected to ${listNames(neighbors.map((n) => nameOf(n.id)))}`
        : 'Territory created',
    );
  }, [neighborsOf, nameOf]);

  // Finish checks the outline before it becomes a territory: a bow-tie draws
  // as shards, and a shape over existing territories is almost always a slip.
  const finishDrawing = useCallback(() => {
    const points = act().drawingPoints;
    if (points.length < 3) {
      toast.error('Need at least 3 points to create a territory');
      return;
    }
    if (ringSelfIntersects(points)) {
      toast.error('The outline crosses itself — Backspace removes the last point');
      return;
    }
    const overlaps = ringOverlaps(points, territoryGeoms);
    if (overlaps.length > 0) {
      setOverlapPrompt({ ring: points, overlaps });
      return;
    }
    createDrawnTerritory(points);
  }, [territoryGeoms, createDrawnTerritory]);

  const resolveOverlap = useCallback((mode: 'trim' | 'keep') => {
    if (!overlapPrompt) return;
    if (mode === 'keep') {
      createDrawnTerritory(overlapPrompt.ring);
      return;
    }
    const cutters = overlapPrompt.overlaps
      .map((o) => geometryById.get(o.id))
      .filter((g): g is PolyGeom => !!g);
    const trimmed = trimRing(overlapPrompt.ring, cutters);
    if (!trimmed || ringSelfIntersects(trimmed)) {
      toast.error('Nothing usable is left once the overlap is cut away');
      setOverlapPrompt(null);
      return;
    }
    createDrawnTerritory(trimmed);
  }, [overlapPrompt, geometryById, createDrawnTerritory]);

  // ── Globe events ─────────────────────────────────────────────────────────
  const handleTerritoryClick = useCallback((id: string) => {
    const s = act();
    switch (s.activeTool) {
      case 'delete':
        s.removeTerritory(id);
        break;
      case 'connect': {
        const src = s.connectSource;
        if (!src) {
          s.setConnectSource(id);
          toast('Click another territory to connect', { icon: '🔗' });
        } else if (src !== id) {
          if (!s.addConnection(src, id, s.connectType)) toast('Those two are already connected');
          s.setConnectSource(null);
        }
        break;
      }
      case 'paint':
        if (s.paintRegionId) s.paintTerritory(id);
        else toast('Pick a region bucket in the Regions panel first', { icon: '🪣' });
        break;
      default:
        s.toggleSelect(id);
    }
  }, []);

  const handleGlobeClick = useCallback((lng: number, lat: number) => {
    const s = act();
    if (s.activeTool === 'draw') s.addDrawingPoint([lng, lat]);
    else s.select(null);
  }, []);

  // A click on a connection line: Delete removes it, Connect switches it
  // between land and sea. Other tools leave it alone.
  const handleConnectionClick = useCallback((from: string, to: string) => {
    const s = act();
    if (s.activeTool === 'delete') s.removeConnection(from, to);
    else if (s.activeTool === 'connect') s.toggleConnectionType(from, to);
  }, []);

  // ── Connection helpers for the panels ────────────────────────────────────
  const connectNeighbors = useCallback((ids: string[]) => {
    const edges = ids.flatMap((id) => {
      const g = geometryById.get(id);
      return g ? neighborsOf(g, id).map((n) => ({ from: id, to: n.id, type: n.type })) : [];
    });
    const added = act().addConnections(edges);
    toast(added > 0
      ? `Added ${added} connection${added === 1 ? '' : 's'}`
      : 'No neighbours within reach — use the Connect tool for a longer sea lane');
  }, [geometryById, neighborsOf]);

  const bridgeIslands = useCallback(() => {
    const edges = bridgeComponents(report.components, geometryById);
    const added = act().addConnections(edges.map((e) => ({ from: e.from, to: e.to, type: 'sea' as const })));
    toast(added > 0 ? `Added ${added} sea lane${added === 1 ? '' : 's'}` : 'Nothing to bridge');
  }, [report.components, geometryById]);

  // ── Templates, remix, import, export ─────────────────────────────────────
  const applyContent = useCallback((content: MapEditorContent, message: string) => {
    act().replaceContent(content, { undoable: true });
    setStartOpen(false);
    setServerWarnings([]);
    setFitNonce((n) => n + 1);
    toast.success(message);
  }, []);

  const applyContinent = useCallback((continent: string, includeSmall: boolean) => {
    setTemplateBusy(true);
    // Let the busy state paint before the geometry work.
    window.setTimeout(() => {
      try {
        const t = buildContinentTemplate(countries, continent, { includeSmall });
        applyContent(
          { ...emptyContent(), ...t, mapName: continent },
          `${continent}: ${t.territories.length} territories, ${t.connections.length} connections, ${t.regions.length} regions`,
        );
      } finally {
        setTemplateBusy(false);
      }
    }, 20);
  }, [countries, applyContent]);

  const remixMap = useCallback(async (remixId: string, name: string) => {
    setTemplateBusy(true);
    try {
      const res = await api.get(`/maps/${remixId}`);
      const data = res.data.map ?? res.data;
      const content = sanitizeEditorContent({ ...data, name: `${data.name ?? name} (remix)` });
      const editable = content?.territories.every(
        (t) => (t.iso_codes && t.iso_codes.length > 0) || (t.geo_polygon && t.geo_polygon.length >= 3),
      );
      if (!content || !editable) {
        toast.error('That map uses hand-tuned geometry the editor cannot edit yet');
        return;
      }
      const converted = (data.territories as Array<Record<string, unknown>>).some(
        (t) => t.geo_config || t.admin1 || t.clip_bbox,
      );
      applyContent(content, `Remixing ${name}`);
      if (converted) toast('Some territories used clipped geometry; they now use their outline', { icon: 'ℹ️' });
    } catch {
      toast.error('Could not load that map');
    } finally {
      setTemplateBusy(false);
    }
  }, [applyContent]);

  const importFile = useCallback(async (file: File) => {
    try {
      const content = sanitizeEditorContent(JSON.parse(await file.text()));
      if (!content) {
        toast.error('That file is not a map this editor can read');
        return;
      }
      applyContent(content, `Imported ${content.mapName}`);
    } catch {
      toast.error('That file is not valid JSON');
    }
  }, [applyContent]);

  const exportJson = useCallback(() => {
    const s = act();
    const doc = {
      name: s.mapName,
      description: s.mapDescription,
      era_theme: s.eraTheme || undefined,
      territories: s.territories,
      connections: s.connections,
      regions: s.regions,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = slugFilename(s.mapName);
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Draft recovery ───────────────────────────────────────────────────────
  const restorePendingDraft = useCallback(() => {
    if (!pendingDraft) return;
    const { v: _v, savedAt: _savedAt, ...content } = pendingDraft;
    act().replaceContent(content, { undoable: true });
    setPendingDraft(null);
    setStartOpen(false);
    toast.success('Unsaved changes restored');
  }, [pendingDraft]);

  const discardPendingDraft = useCallback(() => {
    clearEditorDraft(mapId ?? null);
    setPendingDraft(null);
    if (!mapId && act().territories.length === 0) setStartOpen(true);
  }, [mapId]);

  // ── Save and submit ──────────────────────────────────────────────────────
  const descriptionInvalid = !SAFE_DESCRIPTION.test(mapDescription);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    const s = act();
    if (s.mapName.trim().length === 0) {
      toast.error('Give the map a name first');
      nameRef.current?.focus();
      return;
    }
    if (!SAFE_DESCRIPTION.test(s.mapDescription)) {
      toast.error('The description has a character the server will not accept');
      descriptionRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        name: s.mapName,
        description: s.mapDescription,
        era_theme: s.eraTheme || undefined,
        territories: s.territories,
        connections: s.connections,
        regions: s.regions,
      };
      if (mapId) {
        const res = await api.put<{ message: string; warnings?: string[] }>(`/maps/${mapId}`, payload);
        toast.success(res.data.message || 'Map updated!');
        setServerWarnings(res.data.warnings ?? []);
        if (moderationStatus === 'approved') setModerationStatus('pending');
        clearEditorDraft(mapId);
        act().markSaved();
      } else {
        const res = await api.post<{ map_id: string; message: string; warnings?: string[] }>('/maps', payload);
        toast.success(res.data.message || 'Map saved!');
        setServerWarnings(res.data.warnings ?? []);
        setModerationStatus('draft');
        clearEditorDraft(null);
        act().markSaved();
        navigate(`/editor/${res.data.map_id}`);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to save map');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [mapId, moderationStatus, navigate]);

  const handleSubmitForReview = useCallback(async () => {
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
        if (details?.length) setServerWarnings(details);
      }
    } finally {
      setSubmitting(false);
    }
  }, [mapId, submitting]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (meta && key === 's') {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (typing) return;
      if (meta && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        act().undo();
        return;
      }
      if (meta && ((key === 'z' && e.shiftKey) || key === 'y')) {
        e.preventDefault();
        act().redo();
        return;
      }
      if (meta || e.altKey) return;

      const s = act();
      switch (e.key) {
        case 'Escape':
          if (overlapPrompt) setOverlapPrompt(null);
          else {
            s.select(null);
            s.setConnectSource(null);
            s.clearDrawing();
          }
          setShowShortcuts(false);
          break;
        case 'Enter':
          if (s.activeTool === 'draw' && s.drawingPoints.length >= 3) {
            e.preventDefault();
            finishDrawing();
          }
          break;
        case 'Backspace':
          if (s.activeTool === 'draw' && s.drawingPoints.length > 0) {
            e.preventDefault();
            s.popDrawingPoint();
          }
          break;
        case '?':
          setShowShortcuts((v) => !v);
          break;
        default: {
          const toolByKey: Record<string, EditorTool> = { v: 'select', p: 'country_pick', d: 'draw', c: 'connect', r: 'paint', x: 'delete' };
          if (toolByKey[key]) s.setTool(toolByKey[key]);
          else if (key === 'f') fitView();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, finishDrawing, fitView, overlapPrompt]);

  // ── Map health panel wiring ──────────────────────────────────────────────
  const idsOfIssue = useCallback((issue: MapHealthIssue): string[] => {
    if (issue.territoryIds?.length) return issue.territoryIds;
    if (issue.regionIds?.length) {
      const set = new Set(issue.regionIds);
      return act().territories.filter((t) => set.has(t.region_id)).map((t) => t.territory_id);
    }
    return [];
  }, []);

  const hoverIssue = useCallback((issue: MapHealthIssue | null) => {
    act().setHighlight(issue ? idsOfIssue(issue) : []);
  }, [idsOfIssue]);

  const clickIssue = useCallback((issue: MapHealthIssue) => {
    const [first] = idsOfIssue(issue);
    if (!first) return;
    act().select(first);
    focusTerritory(first);
  }, [idsOfIssue, focusTerritory]);

  const fixes = useMemo((): MapHealthFix[] => [
    { code: 'empty_region', label: 'Remove region', run: (issue) => issue.regionIds?.forEach((id) => act().removeRegion(id)) },
    { code: 'thin_bonus_region', label: 'Fold into another region', run: (issue) => issue.regionIds?.forEach((id) => act().removeRegion(id)) },
    { code: 'disconnected', label: 'Bridge with sea lanes', run: () => bridgeIslands() },
    { code: 'isolated_territory', label: 'Connect neighbours', run: (issue) => connectNeighbors(issue.territoryIds ?? []) },
    { code: 'too_few_territories', label: 'Pick countries', run: () => act().setTool('country_pick') },
    { code: 'too_few_connections', label: 'Connect tool', run: () => act().setTool('connect') },
    { code: 'name_short', label: 'Name it', run: () => nameRef.current?.focus() },
    { code: 'no_description', label: 'Write one', run: () => descriptionRef.current?.focus() },
    { code: 'no_era_tag', label: 'Choose an era', run: () => eraRef.current?.focus() },
  ], [bridgeIslands, connectNeighbors]);

  // Publish's own findings, only where the live rules see nothing to say.
  const serverOnly = report.ready ? serverWarnings : [];

  // ── Guide ────────────────────────────────────────────────────────────────
  const regionSizes = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of territories) m.set(t.region_id, (m.get(t.region_id) ?? 0) + 1);
    return m;
  }, [territories]);

  const guideSteps: GuideStep[] = [
    {
      id: 'territories',
      title: 'Add at least six territories',
      detail: 'Pick countries on the globe (P), search for one in the bar below, or draw your own (D). A continent template does it in one click.',
      done: territories.length >= 6,
    },
    {
      id: 'connect',
      title: 'Connect every territory',
      detail: 'Borders connect as you add countries. Use Connect (C) for a sea lane, or "Bridge with sea lanes" in Map health.',
      done: territories.length >= 2 && report.components.length === 1 && connections.length >= 5,
    },
    {
      id: 'regions',
      title: 'Group into regions with bonuses',
      detail: 'Add a region, pick its bucket, and paint territories into it (R). A bonus pays only with two or more.',
      done: regions.length >= 2 && regions.every((r) => (regionSizes.get(r.region_id) ?? 0) >= 2),
    },
    {
      id: 'describe',
      title: 'Name and describe the map',
      detail: 'The name is in the top bar; the description goes on the hub card.',
      done: mapName.trim() !== DEFAULT_MAP_NAME && mapName.trim().length >= 3 && mapDescription.trim().length > 0,
    },
    {
      id: 'save',
      title: 'Save, then submit for review',
      detail: 'Save (Ctrl+S) keeps a draft on your account. Submit sends it to a moderator; approved maps appear in the Map Hub.',
      done: !!mapId && !isDirty,
    },
  ];

  // ── Hint bar copy ────────────────────────────────────────────────────────
  const paintRegion = regions.find((r) => r.region_id === paintRegionId);
  const toolHints: Record<EditorTool, string> = {
    select: 'Click a territory to edit it. Drag to rotate, scroll to zoom',
    draw: drawingPoints.length > 0
      ? `${drawingPoints.length} point${drawingPoints.length > 1 ? 's' : ''} placed — click to add more, drag to rotate, Enter to finish`
      : 'Click the globe to place each corner of the territory; drag to rotate',
    country_pick: 'Click a country to add it, or search for one',
    connect: connectSource
      ? `Click a second territory to add a ${connectType === 'sea' ? 'sea lane' : 'land border'}`
      : 'Click two territories to connect them, or an existing line to switch it between land and sea',
    paint: paintRegion
      ? `Click territories to move them into ${paintRegion.name}`
      : 'Choose a region below, then click territories to move them into it',
    delete: 'Click a territory or a connection line to remove it',
  };

  const canCloseStart = territories.length > 0 || !!mapId;

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
          <RouterLink to="/lobby" className="btn-secondary mt-6 flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Lobby
          </RouterLink>
        </div>
      )}

      {/* Top Bar */}
      <div className="min-h-12 pt-safe-1 pb-1 bg-bf-surface border-b border-bf-border flex items-center px-4 gap-4 shrink-0">
        <BrandWordmark to="/lobby" className="text-sm" />
        <span className="text-bf-border">|</span>
        <input
          ref={nameRef}
          className="bg-transparent border-none text-bf-gold font-display text-lg focus:outline-none w-64"
          value={mapName}
          onFocus={() => act().beginEdit()}
          onChange={(e) => act().setMapName(e.target.value)}
          placeholder="Map Name"
          aria-label="Map name"
        />
        {/* Era tag: the hub's era filter matches on this — untagged maps never
            surface under an era. */}
        <select
          ref={eraRef}
          className="bg-bf-dark border border-bf-border rounded-lg text-xs text-bf-text py-1 px-2"
          value={eraTheme}
          onChange={(e) => act().setEraTheme(e.target.value)}
          title="Era theme (used by the community hub's era filter)"
          aria-label="Era theme"
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
            disabled={submitting || isDirty || !report.ready}
            title={isDirty
              ? 'Save your changes first'
              : !report.ready
                ? `Map health lists ${report.blockers.length} thing${report.blockers.length === 1 ? '' : 's'} review will block on`
                : 'Send this map to moderation review'}
            className="btn-secondary text-sm py-1.5 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit for review'}
          </button>
        )}
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="btn-primary text-sm flex items-center gap-2 py-1.5"
          title="Save (Ctrl+S)"
        >
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : isDirty ? 'Save Map' : 'Saved'}
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
          {TOOLS.map(({ tool, icon, title, shortcut }) => {
            const pendingPoints = tool === 'draw' && drawingPoints.length > 0 && activeTool !== 'draw';
            return (
              <button
                key={tool}
                title={pendingPoints
                  ? `${title} (${shortcut}) — ${drawingPoints.length} point${drawingPoints.length > 1 ? 's' : ''} waiting`
                  : `${title} (${shortcut})`}
                aria-label={title}
                aria-pressed={activeTool === tool}
                onClick={() => act().setTool(tool)}
                className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  activeTool === tool ? 'bg-bf-gold text-bf-dark' : 'bg-bf-dark text-bf-muted hover:bg-bf-border'
                }`}
              >
                {icon}
                {pendingPoints && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-bf-gold border border-bf-surface" aria-hidden />
                )}
              </button>
            );
          })}
          <div className="mt-2 border-t border-bf-border w-full pt-2 flex flex-col items-center gap-2">
            <button
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              onClick={() => act().undo()}
              disabled={!canUndo}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border disabled:opacity-30"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              onClick={() => act().redo()}
              disabled={!canRedo}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border disabled:opacity-30"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 border-t border-bf-border w-full pt-2 flex flex-col items-center gap-2">
            <button
              title="Fit the map in view (F)"
              aria-label="Fit the map in view"
              onClick={fitView}
              disabled={territories.length === 0}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border disabled:opacity-30"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              title="Start from a template, a remix or a file"
              aria-label="Templates"
              onClick={() => setStartOpen(true)}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border"
            >
              <LayoutTemplate className="w-4 h-4" />
            </button>
            <button
              title="Export as JSON"
              aria-label="Export as JSON"
              onClick={exportJson}
              disabled={territories.length === 0}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors bg-bf-dark text-bf-muted hover:bg-bf-border disabled:opacity-30"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              aria-pressed={showShortcuts}
              onClick={() => setShowShortcuts((v) => !v)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                showShortcuts ? 'bg-bf-gold text-bf-dark' : 'bg-bf-dark text-bf-muted hover:bg-bf-border'
              }`}
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Globe Canvas */}
        <div ref={containerRef} className="flex-1 overflow-hidden relative">
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-bf-muted animate-pulse">Loading editor globe…</div>}>
            <GlobeMapEditorLazy
              territories={territories}
              territoryPolygons={territoryPolygons}
              countryData={countryData}
              connections={connections}
              regions={regions}
              selectedTerritoryId={selectedTerritoryId}
              connectSource={connectSource}
              highlightedIds={highlightedTerritoryIds}
              activeTool={activeTool}
              drawingPoints={drawingPoints}
              focus={focus}
              width={globeSize.w}
              height={globeSize.h}
              onTerritoryClick={handleTerritoryClick}
              onGlobeClickCoords={handleGlobeClick}
              onCountryPick={handleCountryPick}
              onConnectionClick={handleConnectionClick}
            />
          </Suspense>

          {/* Hint bar: what the tool does, and its controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[90%] bg-bf-surface/90 backdrop-blur border border-bf-border rounded-lg px-4 py-2 text-sm text-bf-muted flex items-center gap-3 flex-wrap justify-center">
            {overlapPrompt ? (
              <>
                <span className="text-bf-text">
                  This shape overlaps {listNames(overlapPrompt.overlaps.map((o) => `${nameOf(o.id)} (${Math.round(o.fraction * 100)}%)`))}.
                </span>
                <button onClick={() => resolveOverlap('trim')} className="btn-primary text-xs py-1 px-3">Trim overlap</button>
                <button onClick={() => resolveOverlap('keep')} className="btn-secondary text-xs py-1 px-3">Keep anyway</button>
                <button onClick={() => setOverlapPrompt(null)} className="text-xs text-bf-muted hover:text-bf-text">Cancel</button>
              </>
            ) : (
              <>
                <span>{toolHints[activeTool]}</span>
                {activeTool === 'country_pick' && countriesReady && (
                  <CountrySearch countries={countries} usedCodes={usedCodes} onPick={pickFromSearch} className="w-64" />
                )}
                {activeTool === 'connect' && (
                  <div className="flex items-center gap-0.5 rounded-md border border-bf-border p-0.5" role="radiogroup" aria-label="Connection type">
                    {(['land', 'sea'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={connectType === t}
                        onClick={() => act().setConnectType(t)}
                        className={`px-2 py-0.5 rounded text-xs ${connectType === t ? 'bg-bf-gold text-bf-dark' : 'text-bf-muted hover:text-bf-text'}`}
                      >
                        {t === 'land' ? 'Land border' : 'Sea lane'}
                      </button>
                    ))}
                  </div>
                )}
                {activeTool === 'paint' && (
                  <div className="flex items-center gap-1 flex-wrap" role="radiogroup" aria-label="Region to paint">
                    {regions.map((r, idx) => (
                      <button
                        key={r.region_id}
                        type="button"
                        role="radio"
                        aria-checked={paintRegionId === r.region_id}
                        onClick={() => act().setPaintRegion(r.region_id)}
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs ${
                          paintRegionId === r.region_id ? 'border-bf-gold text-bf-text' : 'border-bf-border text-bf-muted hover:text-bf-text'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: regionColorHex(idx) }} aria-hidden />
                        <span>{r.name}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => act().setPaintRegion(act().addRegion())}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-bf-border text-xs text-bf-muted hover:text-bf-text"
                    >
                      <Plus className="w-3 h-3" aria-hidden />
                      <span>New region</span>
                    </button>
                  </div>
                )}
                {activeTool === 'draw' && drawingPoints.length > 0 && (
                  <div className="flex items-center gap-2">
                    {drawingPoints.length >= 3 && (
                      <button onClick={finishDrawing} className="btn-primary text-xs py-1 px-3 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Finish
                      </button>
                    )}
                    <button onClick={() => act().popDrawingPoint()} className="text-xs text-bf-muted hover:text-bf-text" title="Remove the last point (Backspace)">
                      Undo point
                    </button>
                    <button onClick={() => act().clearDrawing()} className="text-xs text-bf-muted hover:text-bf-text" title="Clear the outline (Esc)">
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {showShortcuts && (
            <div className="absolute top-4 right-4 z-10 w-80 rounded-lg border border-bf-border bg-bf-surface/95 backdrop-blur shadow-xl p-3 text-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium uppercase tracking-wider text-bf-muted">Shortcuts</span>
                <button onClick={() => setShowShortcuts(false)} className="text-bf-muted hover:text-bf-text" aria-label="Close">✕</button>
              </div>
              <dl className="space-y-1.5">
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={keys} className="flex gap-3">
                    <dt className="font-mono text-bf-gold shrink-0 w-32">{keys}</dt>
                    <dd className="text-bf-text">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <EditorGuide steps={guideSteps} />

          <EditorStartScreen
            open={startOpen}
            countriesReady={countriesReady}
            continents={continents}
            busy={templateBusy}
            canClose={canCloseStart}
            onClose={() => setStartOpen(false)}
            onBlank={() => {
              setStartOpen(false);
              act().setTool('country_pick');
            }}
            onContinent={applyContinent}
            onRemix={(id, name) => void remixMap(id, name)}
            onImportFile={(file) => void importFile(file)}
          />
        </div>

        {/* Right Panel */}
        <div className="w-72 bg-bf-surface border-l border-bf-border flex flex-col shrink-0 overflow-y-auto">
          {/* Map details: what the hub card shows beside the name and era. */}
          <div className="p-4 border-b border-bf-border">
            <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-3">Map</h3>
            <label className="label text-xs" htmlFor="map-editor-description">Description</label>
            <textarea
              id="map-editor-description"
              ref={descriptionRef}
              className={`input text-sm py-1.5 resize-none ${descriptionInvalid ? 'border-red-500/60' : ''}`}
              rows={3}
              maxLength={512}
              value={mapDescription}
              onFocus={() => act().beginEdit()}
              onChange={(e) => act().setMapDescription(e.target.value)}
              placeholder="What is this map about? Shown on its card in the Map Hub."
            />
            <p className={`text-[11px] mt-1 ${descriptionInvalid ? 'text-red-300' : 'text-bf-muted text-right'}`}>
              {descriptionInvalid
                ? 'Letters, numbers and basic punctuation only'
                : `${mapDescription.length}/512`}
            </p>
          </div>

          <TerritoryPanel onConnectNeighbors={(id) => connectNeighbors([id])} onFocus={focusTerritory} />

          <RegionsPanel />

          <MapHealthPanel
            report={report}
            serverOnly={serverOnly}
            onHoverIssue={hoverIssue}
            onClickIssue={clickIssue}
            fixes={fixes}
          />

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
