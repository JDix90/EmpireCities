import { describe, it, expect } from 'vitest';
import { ERA_META, eraMeta } from './eraMeta';
import { eraAdvanceDisplayName } from '../utils/eraAdvanceVisualUtils';

describe('eraMeta', () => {
  it('covers all ten eras with a color and flavor line', () => {
    const eras = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento', 'space_age', 'galaxy_age'];
    for (const id of eras) {
      const meta = eraMeta(id);
      expect(meta.short.length, id).toBeGreaterThan(0);
      expect(meta.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(meta.flavor.length, id).toBeGreaterThan(0);
      expect(ERA_META[id]).toBe(meta);
    }
  });

  it('falls back gracefully for an unknown era', () => {
    const meta = eraMeta('not_an_era');
    expect(meta.short).toBe('New Era');
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('eraAdvanceDisplayName (now era-meta backed)', () => {
  it('returns the short label for every classic era, not just the first three', () => {
    expect(eraAdvanceDisplayName('ancient')).toBe('Ancient');
    expect(eraAdvanceDisplayName('ww2')).toBe('WWII');
    expect(eraAdvanceDisplayName('coldwar')).toBe('Cold War');
    expect(eraAdvanceDisplayName('modern')).toBe('Modern');
    expect(eraAdvanceDisplayName(undefined)).toBe('New Era');
  });
});
