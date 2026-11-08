import { create } from 'zustand';
import type {
  EditorConnection,
  EditorRegion,
  EditorTerritory,
  EditorTool,
} from '../components/editor/editorGlobeData';

/**
 * The map editor's document and tool state, with its undo history.
 *
 * Everything the page used to juggle in refs lives here so the actions are
 * plain, testable functions: add a territory with the connections the globe
 * worked out for it, paint a region, bridge islands, apply a template. The
 * page is the view and the glue to the globe; geometry (which territories
 * touch, what a drawn ring overlaps) is computed in editorGeo.ts and handed
 * in as data.
 *
 * Undo: every mutating action records the content BEFORE it runs. Text inputs
 * record once on focus (`beginEdit`) so a typed name is one undo step.
 */

export interface MapEditorContent {
  territories: EditorTerritory[];
  connections: EditorConnection[];
  regions: EditorRegion[];
  mapName: string;
  mapDescription: string;
  eraTheme: string;
}

export type ConnectKind = 'land' | 'sea';

export const DEFAULT_MAP_NAME = 'My Custom Map';
export const DEFAULT_REGION_BONUS = 3;
const HISTORY_LIMIT = 50;

export function emptyContent(): MapEditorContent {
  return {
    territories: [],
    connections: [],
    regions: [{ region_id: 'region_1', name: 'Region 1', bonus: DEFAULT_REGION_BONUS }],
    mapName: DEFAULT_MAP_NAME,
    mapDescription: '',
    eraTheme: '',
  };
}

let idCounter = 0;
/** Unique within a session and acceptable to the server's id pattern. */
export function newEditorId(prefix: 't' | 'region'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export const sameEdge = (c: EditorConnection, from: string, to: string): boolean =>
  (c.from === from && c.to === to) || (c.from === to && c.to === from);

export interface MapEditorState extends MapEditorContent {
  activeTool: EditorTool;
  selectedTerritoryId: string | null;
  /** First end of the connection the Connect tool is making. */
  connectSource: string | null;
  connectType: ConnectKind;
  /** The region the Paint tool assigns. */
  paintRegionId: string | null;
  drawingPoints: [number, number][];
  /** Territories the Map Health panel is pointing at. */
  highlightedTerritoryIds: string[];
  past: MapEditorContent[];
  future: MapEditorContent[];
  isDirty: boolean;

  // Tools and selection
  setTool: (tool: EditorTool) => void;
  select: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  setConnectSource: (id: string | null) => void;
  setConnectType: (type: ConnectKind) => void;
  setPaintRegion: (regionId: string | null) => void;
  setHighlight: (ids: string[]) => void;

  // Document fields (text inputs call beginEdit on focus)
  beginEdit: () => void;
  setMapName: (name: string) => void;
  setMapDescription: (description: string) => void;
  setEraTheme: (era: string) => void;

  // Territories
  addTerritory: (territory: EditorTerritory, connections?: EditorConnection[]) => void;
  removeTerritory: (id: string) => void;
  renameTerritory: (id: string, name: string) => void;
  setTerritoryRegion: (id: string, regionId: string) => void;
  paintTerritory: (id: string) => void;

  // Connections
  addConnection: (from: string, to: string, type?: EditorConnection['type']) => boolean;
  addConnections: (edges: EditorConnection[]) => number;
  removeConnection: (from: string, to: string) => void;
  toggleConnectionType: (from: string, to: string) => void;

  // Regions
  addRegion: (name?: string, bonus?: number) => string;
  removeRegion: (regionId: string) => { moved: number; fallbackName: string } | null;
  renameRegion: (regionId: string, name: string) => void;
  setRegionBonus: (regionId: string, bonus: number) => void;

  // Drawing
  addDrawingPoint: (point: [number, number]) => void;
  popDrawingPoint: () => void;
  clearDrawing: () => void;

  // Whole document
  replaceContent: (content: MapEditorContent, options?: { undoable?: boolean }) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

const pickContent = (s: MapEditorContent): MapEditorContent => ({
  territories: s.territories,
  connections: s.connections,
  regions: s.regions,
  mapName: s.mapName,
  mapDescription: s.mapDescription,
  eraTheme: s.eraTheme,
});

/** The history fields after recording the current content as an undo step. */
const withUndo = (s: MapEditorState): Pick<MapEditorState, 'past' | 'future'> => ({
  past: [...s.past.slice(-(HISTORY_LIMIT - 1)), pickContent(s)],
  future: [],
});

const initialState = (): Omit<MapEditorState, keyof MapEditorActions> => ({
  ...emptyContent(),
  activeTool: 'select',
  selectedTerritoryId: null,
  connectSource: null,
  connectType: 'land',
  paintRegionId: null,
  drawingPoints: [],
  highlightedTerritoryIds: [],
  past: [],
  future: [],
  isDirty: false,
});

type MapEditorActions = Pick<
  MapEditorState,
  | 'setTool' | 'select' | 'toggleSelect' | 'setConnectSource' | 'setConnectType' | 'setPaintRegion' | 'setHighlight'
  | 'beginEdit' | 'setMapName' | 'setMapDescription' | 'setEraTheme'
  | 'addTerritory' | 'removeTerritory' | 'renameTerritory' | 'setTerritoryRegion' | 'paintTerritory'
  | 'addConnection' | 'addConnections' | 'removeConnection' | 'toggleConnectionType'
  | 'addRegion' | 'removeRegion' | 'renameRegion' | 'setRegionBonus'
  | 'addDrawingPoint' | 'popDrawingPoint' | 'clearDrawing'
  | 'replaceContent' | 'markSaved' | 'undo' | 'redo' | 'reset'
>;

export const useMapEditorStore = create<MapEditorState>((set, get) => ({
  ...initialState(),

  // ── Tools and selection ───────────────────────────────────────────────────
  // Switching tools drops a half-made connection but keeps a half-drawn
  // polygon, so the author can rotate, select or pick mid-shape and come back.
  setTool: (tool) => set({ activeTool: tool, connectSource: null }),
  select: (id) => set({ selectedTerritoryId: id }),
  toggleSelect: (id) => set((s) => ({ selectedTerritoryId: s.selectedTerritoryId === id ? null : id })),
  setConnectSource: (id) => set({ connectSource: id }),
  setConnectType: (type) => set({ connectType: type }),
  setPaintRegion: (regionId) => set({ paintRegionId: regionId }),
  setHighlight: (ids) => set((s) => (
    s.highlightedTerritoryIds.length === ids.length && s.highlightedTerritoryIds.every((v, i) => v === ids[i])
      ? s
      : { highlightedTerritoryIds: ids }
  )),

  // ── Document fields ───────────────────────────────────────────────────────
  beginEdit: () => set((s) => withUndo(s)),
  setMapName: (mapName) => set({ mapName, isDirty: true }),
  setMapDescription: (mapDescription) => set({ mapDescription, isDirty: true }),
  setEraTheme: (eraTheme) => set((s) => ({ ...withUndo(s), eraTheme, isDirty: true })),

  // ── Territories ───────────────────────────────────────────────────────────
  addTerritory: (territory, connections = []) => set((s) => {
    const known = new Set(s.territories.map((t) => t.territory_id));
    known.add(territory.territory_id);
    const fresh = connections.filter((c) =>
      c.from !== c.to && known.has(c.from) && known.has(c.to) && !s.connections.some((e) => sameEdge(e, c.from, c.to)),
    );
    return {
      ...withUndo(s),
      territories: [...s.territories, territory],
      connections: [...s.connections, ...fresh],
      selectedTerritoryId: territory.territory_id,
      isDirty: true,
    };
  }),

  removeTerritory: (id) => set((s) => ({
    ...withUndo(s),
    territories: s.territories.filter((t) => t.territory_id !== id),
    connections: s.connections.filter((c) => c.from !== id && c.to !== id),
    selectedTerritoryId: s.selectedTerritoryId === id ? null : s.selectedTerritoryId,
    connectSource: s.connectSource === id ? null : s.connectSource,
    highlightedTerritoryIds: s.highlightedTerritoryIds.filter((h) => h !== id),
    isDirty: true,
  })),

  renameTerritory: (id, name) => set((s) => ({
    territories: s.territories.map((t) => (t.territory_id === id ? { ...t, name } : t)),
    isDirty: true,
  })),

  setTerritoryRegion: (id, regionId) => set((s) => {
    const target = s.territories.find((t) => t.territory_id === id);
    if (!target || target.region_id === regionId || !s.regions.some((r) => r.region_id === regionId)) return s;
    return {
      ...withUndo(s),
      territories: s.territories.map((t) => (t.territory_id === id ? { ...t, region_id: regionId } : t)),
      isDirty: true,
    };
  }),

  paintTerritory: (id) => {
    const regionId = get().paintRegionId;
    if (regionId) get().setTerritoryRegion(id, regionId);
  },

  // ── Connections ───────────────────────────────────────────────────────────
  addConnection: (from, to, type = 'land') => {
    const s = get();
    if (from === to) return false;
    const known = new Set(s.territories.map((t) => t.territory_id));
    if (!known.has(from) || !known.has(to)) return false;
    if (s.connections.some((c) => sameEdge(c, from, to))) return false;
    set({ ...withUndo(s), connections: [...s.connections, { from, to, type }], isDirty: true });
    return true;
  },

  addConnections: (edges) => {
    const s = get();
    const known = new Set(s.territories.map((t) => t.territory_id));
    const fresh: EditorConnection[] = [];
    for (const e of edges) {
      if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue;
      if (s.connections.some((c) => sameEdge(c, e.from, e.to))) continue;
      if (fresh.some((c) => sameEdge(c, e.from, e.to))) continue;
      fresh.push(e);
    }
    if (fresh.length === 0) return 0;
    set({ ...withUndo(s), connections: [...s.connections, ...fresh], isDirty: true });
    return fresh.length;
  },

  removeConnection: (from, to) => set((s) => ({
    ...withUndo(s),
    connections: s.connections.filter((c) => !sameEdge(c, from, to)),
    isDirty: true,
  })),

  toggleConnectionType: (from, to) => set((s) => ({
    ...withUndo(s),
    connections: s.connections.map((c) =>
      sameEdge(c, from, to) ? { ...c, type: c.type === 'sea' ? 'land' : 'sea' } : c,
    ),
    isDirty: true,
  })),

  // ── Regions ───────────────────────────────────────────────────────────────
  addRegion: (name, bonus = DEFAULT_REGION_BONUS) => {
    const s = get();
    const region_id = newEditorId('region');
    set({
      ...withUndo(s),
      regions: [...s.regions, { region_id, name: name ?? `Region ${s.regions.length + 1}`, bonus }],
      isDirty: true,
    });
    return region_id;
  },

  // Its territories move to another region first; the last region stays.
  removeRegion: (regionId) => {
    const s = get();
    const fallback = s.regions.find((r) => r.region_id !== regionId);
    if (!fallback || !s.regions.some((r) => r.region_id === regionId)) return null;
    const moved = s.territories.filter((t) => t.region_id === regionId).length;
    set({
      ...withUndo(s),
      territories: s.territories.map((t) => (t.region_id === regionId ? { ...t, region_id: fallback.region_id } : t)),
      regions: s.regions.filter((r) => r.region_id !== regionId),
      paintRegionId: s.paintRegionId === regionId ? null : s.paintRegionId,
      isDirty: true,
    });
    return { moved, fallbackName: fallback.name };
  },

  renameRegion: (regionId, name) => set((s) => ({
    regions: s.regions.map((r) => (r.region_id === regionId ? { ...r, name } : r)),
    isDirty: true,
  })),

  setRegionBonus: (regionId, bonus) => set((s) => ({
    regions: s.regions.map((r) => (r.region_id === regionId ? { ...r, bonus } : r)),
    isDirty: true,
  })),

  // ── Drawing ───────────────────────────────────────────────────────────────
  addDrawingPoint: (point) => set((s) => ({ drawingPoints: [...s.drawingPoints, point] })),
  popDrawingPoint: () => set((s) => ({ drawingPoints: s.drawingPoints.slice(0, -1) })),
  clearDrawing: () => set({ drawingPoints: [] }),

  // ── Whole document ────────────────────────────────────────────────────────
  // Undoable for a template or a restored snapshot (the author chose it);
  // not for loading the saved map, which is where history starts.
  replaceContent: (content, options = {}) => set((s) => ({
    ...(options.undoable ? withUndo(s) : { past: [], future: [] }),
    ...content,
    selectedTerritoryId: null,
    connectSource: null,
    paintRegionId: null,
    drawingPoints: [],
    highlightedTerritoryIds: [],
    isDirty: options.undoable === true,
  })),

  markSaved: () => set({ isDirty: false }),

  undo: () => set((s) => {
    const previous = s.past[s.past.length - 1];
    if (!previous) return s;
    return {
      ...previous,
      past: s.past.slice(0, -1),
      future: [pickContent(s), ...s.future],
      selectedTerritoryId: previous.territories.some((t) => t.territory_id === s.selectedTerritoryId)
        ? s.selectedTerritoryId
        : null,
      connectSource: null,
      isDirty: true,
    };
  }),

  redo: () => set((s) => {
    const [next, ...rest] = s.future;
    if (!next) return s;
    return {
      ...next,
      past: [...s.past, pickContent(s)],
      future: rest,
      selectedTerritoryId: next.territories.some((t) => t.territory_id === s.selectedTerritoryId)
        ? s.selectedTerritoryId
        : null,
      connectSource: null,
      isDirty: true,
    };
  }),

  reset: () => set(initialState()),
}));

/** The saveable document, for the API payload and the local draft snapshot. */
export function selectContent(s: MapEditorState): MapEditorContent {
  return pickContent(s);
}
