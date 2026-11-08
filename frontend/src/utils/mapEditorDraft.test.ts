import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearEditorDraft,
  describeDraftAge,
  editorDraftKey,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftSnapshot,
} from './mapEditorDraft';

const snapshot: EditorDraftSnapshot = {
  v: 1,
  savedAt: 1_700_000_000_000,
  mapName: 'Sahel',
  mapDescription: 'Three kingdoms',
  eraTheme: 'medieval',
  territories: [
    {
      territory_id: 't_1',
      name: 'Mali',
      polygon: [[-5, 15], [0, 15], [0, 20]],
      center_point: [-2, 17],
      region_id: 'region_1',
      iso_codes: ['ML'],
    },
  ],
  connections: [{ from: 't_1', to: 't_2', type: 'sea' }],
  regions: [{ region_id: 'region_1', name: 'Sahel', bonus: 3 }],
};

beforeEach(() => {
  localStorage.clear();
});

describe('mapEditorDraft', () => {
  it('keeps one slot per map and one for the unsaved map', () => {
    expect(editorDraftKey(null)).toBe('cc-map-editor-draft');
    expect(editorDraftKey('abc')).toBe('cc-map-editor-draft-abc');
  });

  it('round-trips a snapshot and clears it', () => {
    writeEditorDraft('abc', snapshot);
    expect(readEditorDraft('abc')).toEqual(snapshot);
    expect(readEditorDraft(null)).toBeNull();
    clearEditorDraft('abc');
    expect(readEditorDraft('abc')).toBeNull();
  });

  it('reads nothing from a malformed or foreign snapshot', () => {
    localStorage.setItem(editorDraftKey(null), '{not json');
    expect(readEditorDraft(null)).toBeNull();
    localStorage.setItem(editorDraftKey(null), JSON.stringify({ ...snapshot, v: 2 }));
    expect(readEditorDraft(null)).toBeNull();
    localStorage.setItem(
      editorDraftKey(null),
      JSON.stringify({ ...snapshot, territories: [{ territory_id: 't', name: 'x' }] }),
    );
    expect(readEditorDraft(null)).toBeNull();
    localStorage.setItem(editorDraftKey(null), JSON.stringify({ ...snapshot, regions: [] }));
    expect(readEditorDraft(null)).toBeNull();
    localStorage.setItem(
      editorDraftKey(null),
      JSON.stringify({ ...snapshot, connections: [{ from: 'a', to: 'b', type: 'teleport' }] }),
    );
    expect(readEditorDraft(null)).toBeNull();
  });

  it('fills optional text fields that an older snapshot left out', () => {
    const { mapDescription: _d, eraTheme: _e, ...bare } = snapshot;
    localStorage.setItem(editorDraftKey('abc'), JSON.stringify(bare));
    expect(readEditorDraft('abc')).toEqual({ ...snapshot, mapDescription: '', eraTheme: '' });
  });

  it('describes the snapshot age in plain words', () => {
    const now = 10_000_000_000;
    expect(describeDraftAge(now - 20_000, now)).toBe('just now');
    expect(describeDraftAge(now - 60_000, now)).toBe('1 minute ago');
    expect(describeDraftAge(now - 4 * 60_000, now)).toBe('4 minutes ago');
    expect(describeDraftAge(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(describeDraftAge(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});
