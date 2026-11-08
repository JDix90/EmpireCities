/**
 * Local recovery for the map editor.
 *
 * The editor keeps the work in progress in this browser under a `cc-` key,
 * written a second after each change and cleared by a successful save. A
 * crash, a closed tab or an expired session then costs nothing: the next
 * visit to the same map (or to a fresh editor, for a map never saved) offers
 * the snapshot back. It is a safety net, not storage — the server copy is the
 * map — so a snapshot that will not fit (quota) or does not parse is dropped.
 */

import type { EditorConnection, EditorRegion, EditorTerritory } from '../components/editor/GlobeMapEditor';

const KEY_PREFIX = 'cc-map-editor-draft';

export interface EditorDraftSnapshot {
  v: 1;
  savedAt: number;
  mapName: string;
  mapDescription: string;
  eraTheme: string;
  territories: EditorTerritory[];
  connections: EditorConnection[];
  regions: EditorRegion[];
}

/** One slot per saved map, and one for the map that has not been saved yet. */
export function editorDraftKey(mapId: string | null): string {
  return mapId ? `${KEY_PREFIX}-${mapId}` : KEY_PREFIX;
}

const isPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
  && Number.isFinite(v[0]) && Number.isFinite(v[1]);

const isRing = (v: unknown): v is [number, number][] => Array.isArray(v) && v.every(isPair);

function isTerritory(v: unknown): v is EditorTerritory {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.territory_id === 'string'
    && typeof t.name === 'string'
    && isRing(t.polygon)
    && isPair(t.center_point)
    && typeof t.region_id === 'string'
    && (t.iso_codes === undefined || (Array.isArray(t.iso_codes) && t.iso_codes.every((c) => typeof c === 'string')))
    && (t.admin1 === undefined || (Array.isArray(t.admin1) && t.admin1.every((c) => typeof c === 'string')))
    && (t.geo_polygon === undefined || isRing(t.geo_polygon));
}

function isConnection(v: unknown): v is EditorConnection {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.from === 'string' && typeof c.to === 'string'
    && (c.type === 'land' || c.type === 'sea' || c.type === 'orbit');
}

function isRegion(v: unknown): v is EditorRegion {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.region_id === 'string' && typeof r.name === 'string'
    && typeof r.bonus === 'number' && Number.isFinite(r.bonus);
}

/** The map content fields a snapshot, an export file or an API document carry. */
export interface EditorContentFields {
  mapName: string;
  mapDescription: string;
  eraTheme: string;
  territories: EditorTerritory[];
  connections: EditorConnection[];
  regions: EditorRegion[];
}

/**
 * Well-formed map content from untrusted JSON, or null. Accepts the editor's
 * own field names (mapName) and the API document's (name, description,
 * era_theme), so an exported file and a saved map both import.
 */
export function sanitizeEditorContent(raw: unknown): EditorContentFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const name = typeof d.mapName === 'string' ? d.mapName : typeof d.name === 'string' ? d.name : null;
  if (name === null) return null;
  if (!Array.isArray(d.territories) || !d.territories.every(isTerritory)) return null;
  if (!Array.isArray(d.connections) || !d.connections.every(isConnection)) return null;
  if (!Array.isArray(d.regions) || !d.regions.every(isRegion) || d.regions.length === 0) return null;
  const description = typeof d.mapDescription === 'string' ? d.mapDescription : typeof d.description === 'string' ? d.description : '';
  const era = typeof d.eraTheme === 'string' ? d.eraTheme : typeof d.era_theme === 'string' ? d.era_theme : '';
  return {
    mapName: name,
    mapDescription: description,
    eraTheme: era,
    territories: d.territories.map((t) => ({
      territory_id: t.territory_id,
      name: t.name,
      polygon: t.polygon,
      center_point: t.center_point,
      region_id: t.region_id,
      ...(t.iso_codes ? { iso_codes: t.iso_codes } : {}),
      ...(t.admin1 ? { admin1: t.admin1 } : {}),
      ...(t.geo_polygon ? { geo_polygon: t.geo_polygon } : {}),
    })),
    connections: d.connections.map((c) => ({ from: c.from, to: c.to, type: c.type })),
    regions: d.regions.map((r) => ({ region_id: r.region_id, name: r.name, bonus: r.bonus })),
  };
}

/** The snapshot if one is stored and well-formed; anything else reads as none. */
export function readEditorDraft(mapId: string | null): EditorDraftSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(editorDraftKey(mapId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const d = parsed as Record<string, unknown>;
    if (d.v !== 1 || typeof d.savedAt !== 'number' || !Number.isFinite(d.savedAt)) return null;
    const content = sanitizeEditorContent(d);
    if (!content) return null;
    return { v: 1, savedAt: d.savedAt, ...content };
  } catch {
    return null;
  }
}

export function writeEditorDraft(mapId: string | null, snapshot: EditorDraftSnapshot): void {
  try {
    localStorage.setItem(editorDraftKey(mapId), JSON.stringify(snapshot));
  } catch {
    /* quota or no storage: the server copy is the map */
  }
}

export function clearEditorDraft(mapId: string | null): void {
  try {
    localStorage.removeItem(editorDraftKey(mapId));
  } catch {
    /* ignore */
  }
}

/** "just now", "4 minutes ago", "3 hours ago", "2 days ago". */
export function describeDraftAge(savedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
