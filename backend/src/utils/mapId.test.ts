import { describe, it, expect } from 'vitest';
import { isSafeMapId } from './mapId';

describe('isSafeMapId', () => {
  it('allows valid IDs', () => {
    expect(isSafeMapId('era_ancient')).toBe(true);
    expect(isSafeMapId('community_14_nations')).toBe(true);
    expect(isSafeMapId('community-map-v2')).toBe(true);
  });
  it('rejects path traversal', () => {
    expect(isSafeMapId('../../etc/passwd')).toBe(false);
    expect(isSafeMapId('../secret')).toBe(false);
    expect(isSafeMapId('maps/../../root')).toBe(false);
  });
  it('rejects special characters', () => {
    expect(isSafeMapId('map id')).toBe(false);
    expect(isSafeMapId('map\x00id')).toBe(false);
    expect(isSafeMapId('')).toBe(false);
  });
  it('rejects overly long IDs', () => {
    expect(isSafeMapId('a'.repeat(129))).toBe(false);
  });
});
