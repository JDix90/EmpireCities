import { describe, it, expect, beforeEach } from 'vitest';
import { useMapEditorStore, emptyContent, newEditorId, DEFAULT_MAP_NAME } from './mapEditorStore';
import type { EditorTerritory } from '../components/editor/editorGlobeData';

const store = () => useMapEditorStore.getState();

function territory(id: string, regionId = 'region_1'): EditorTerritory {
  return {
    territory_id: id,
    name: id.toUpperCase(),
    polygon: [[0, 0], [1, 0], [1, 1]],
    center_point: [0.5, 0.5],
    region_id: regionId,
    geo_polygon: [[0, 0], [1, 0], [1, 1]],
  };
}

beforeEach(() => store().reset());

describe('mapEditorStore', () => {
  it('starts as an empty, clean document with one region', () => {
    const s = store();
    expect(s.territories).toEqual([]);
    expect(s.regions).toHaveLength(1);
    expect(s.mapName).toBe(DEFAULT_MAP_NAME);
    expect(s.isDirty).toBe(false);
    expect(s.past).toEqual([]);
  });

  it('adds a territory with the connections worked out for it, skipping duplicates and strangers', () => {
    store().addTerritory(territory('a'));
    store().addTerritory(territory('b'), [
      { from: 'b', to: 'a', type: 'land' },
      { from: 'b', to: 'ghost', type: 'land' },
      { from: 'b', to: 'b', type: 'land' },
    ]);
    store().addTerritory(territory('c'), [
      { from: 'c', to: 'a', type: 'land' },
      { from: 'a', to: 'b', type: 'sea' }, // already there the other way round
    ]);
    const s = store();
    expect(s.territories.map((t) => t.territory_id)).toEqual(['a', 'b', 'c']);
    expect(s.connections).toEqual([
      { from: 'b', to: 'a', type: 'land' },
      { from: 'c', to: 'a', type: 'land' },
    ]);
    expect(s.selectedTerritoryId).toBe('c');
    expect(s.isDirty).toBe(true);
  });

  it('removes a territory with its connections, selection and highlight', () => {
    store().addTerritory(territory('a'));
    store().addTerritory(territory('b'), [{ from: 'b', to: 'a', type: 'land' }]);
    store().setHighlight(['a', 'b']);
    store().removeTerritory('b');
    const s = store();
    expect(s.territories.map((t) => t.territory_id)).toEqual(['a']);
    expect(s.connections).toEqual([]);
    expect(s.selectedTerritoryId).toBeNull();
    expect(s.highlightedTerritoryIds).toEqual(['a']);
  });

  it('dedupes connections, toggles their type and removes them either way round', () => {
    store().addTerritory(territory('a'));
    store().addTerritory(territory('b'));
    expect(store().addConnection('a', 'b')).toBe(true);
    expect(store().addConnection('b', 'a', 'sea')).toBe(false);
    expect(store().addConnection('a', 'a')).toBe(false);
    expect(store().addConnection('a', 'nope')).toBe(false);
    store().toggleConnectionType('b', 'a');
    expect(store().connections).toEqual([{ from: 'a', to: 'b', type: 'sea' }]);
    expect(store().addConnections([
      { from: 'a', to: 'b', type: 'land' },
      { from: 'b', to: 'a', type: 'land' },
    ])).toBe(0);
    store().removeConnection('b', 'a');
    expect(store().connections).toEqual([]);
  });

  it('removes a region by moving its territories elsewhere, and keeps the last one', () => {
    const west = store().addRegion('West', 4);
    store().addTerritory(territory('a', west));
    store().addTerritory(territory('b', west));
    expect(store().removeRegion(west)).toEqual({ moved: 2, fallbackName: 'Region 1' });
    expect(store().regions.map((r) => r.region_id)).toEqual(['region_1']);
    expect(store().territories.every((t) => t.region_id === 'region_1')).toBe(true);
    expect(store().removeRegion('region_1')).toBeNull();
    expect(store().regions).toHaveLength(1);
  });

  it('paints territories into the chosen region, and ignores a region that is gone', () => {
    const east = store().addRegion('East');
    store().addTerritory(territory('a'));
    store().setPaintRegion(east);
    store().paintTerritory('a');
    expect(store().territories[0].region_id).toBe(east);
    store().removeRegion(east);
    expect(store().paintRegionId).toBeNull();
    store().paintTerritory('a'); // no region to paint with
    expect(store().territories[0].region_id).toBe('region_1');
    store().setTerritoryRegion('a', 'ghost');
    expect(store().territories[0].region_id).toBe('region_1');
  });

  it('keeps drawing points across tool switches and drops a half-made connection', () => {
    store().addDrawingPoint([1, 2]);
    store().addDrawingPoint([3, 4]);
    store().setConnectSource('x');
    store().setTool('select');
    expect(store().drawingPoints).toEqual([[1, 2], [3, 4]]);
    expect(store().connectSource).toBeNull();
    store().popDrawingPoint();
    expect(store().drawingPoints).toEqual([[1, 2]]);
    store().clearDrawing();
    expect(store().drawingPoints).toEqual([]);
  });

  it('undoes and redoes a sequence of edits, one step per action', () => {
    store().addTerritory(territory('a'));
    store().addTerritory(territory('b'), [{ from: 'b', to: 'a', type: 'land' }]);
    store().beginEdit();
    store().setMapName('Sahel');
    store().setMapName('Sahel Kingdoms');
    expect(store().past).toHaveLength(3);

    store().undo();
    expect(store().mapName).toBe(DEFAULT_MAP_NAME);
    expect(store().territories).toHaveLength(2);
    store().undo();
    expect(store().territories.map((t) => t.territory_id)).toEqual(['a']);
    expect(store().connections).toEqual([]);
    expect(store().selectedTerritoryId).toBeNull(); // b, the selection, is gone

    store().redo();
    expect(store().territories).toHaveLength(2);
    store().redo();
    expect(store().mapName).toBe('Sahel Kingdoms');
    store().redo(); // nothing left
    expect(store().future).toEqual([]);

    // A fresh edit after an undo discards the redo branch.
    store().undo();
    store().addRegion('New');
    expect(store().future).toEqual([]);
  });

  it('loads a saved document without history and applies a template with it', () => {
    const loaded = { ...emptyContent(), mapName: 'Loaded', territories: [territory('a')] };
    store().addTerritory(territory('zzz'));
    store().replaceContent(loaded);
    expect(store().mapName).toBe('Loaded');
    expect(store().past).toEqual([]);
    expect(store().isDirty).toBe(false);
    expect(store().selectedTerritoryId).toBeNull();

    const template = { ...emptyContent(), mapName: 'Africa', territories: [territory('a'), territory('b')] };
    store().replaceContent(template, { undoable: true });
    expect(store().isDirty).toBe(true);
    store().undo();
    expect(store().mapName).toBe('Loaded');
  });

  it('marks saved and tracks dirtiness through text edits', () => {
    store().beginEdit();
    store().setMapDescription('Hello');
    expect(store().isDirty).toBe(true);
    store().markSaved();
    expect(store().isDirty).toBe(false);
    store().setEraTheme('medieval');
    expect(store().isDirty).toBe(true);
    expect(store().past).toHaveLength(2);
  });

  it('replaces one territory with several in one undo step, keeping the rest of the graph', () => {
    store().addTerritory(territory('fr'));
    store().addTerritory(territory('us'), [{ from: 'us', to: 'fr', type: 'sea' }]);
    store().addTerritory(territory('ca'), [{ from: 'ca', to: 'us', type: 'land' }]);
    store().replaceTerritory('us', [territory('us_ca'), territory('us_nv')], [
      { from: 'us_ca', to: 'us_nv', type: 'land' },
      { from: 'us_ca', to: 'fr', type: 'sea' },
      { from: 'us_nv', to: 'ca', type: 'land' },
      { from: 'us_nv', to: 'us', type: 'land' }, // the old id is gone: dropped
      { from: 'us_ca', to: 'us_nv', type: 'sea' }, // duplicate: dropped
    ]);
    const s = store();
    expect(s.territories.map((t) => t.territory_id)).toEqual(['fr', 'ca', 'us_ca', 'us_nv']);
    expect(s.connections).toEqual([
      { from: 'us_ca', to: 'us_nv', type: 'land' },
      { from: 'us_ca', to: 'fr', type: 'sea' },
      { from: 'us_nv', to: 'ca', type: 'land' },
    ]);
    expect(s.selectedTerritoryId).toBeNull();
    store().undo();
    expect(store().territories.map((t) => t.territory_id)).toEqual(['fr', 'us', 'ca']);
    expect(store().connections).toHaveLength(2);
  });

  it('hands out ids the server accepts, never twice', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newEditorId('t')));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^t_[a-z0-9]+$/);
  });
});
