import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { summarizeWarfrontTerrain, warfrontTerrainPath } from './warfrontStatus';

describe('warfrontStatus', () => {
  it('resolves the committed asset under database/warfront', () => {
    const p = warfrontTerrainPath();
    expect(p.replace(/\\/g, '/')).toMatch(/\/database\/warfront\/western_twenty\.terrain\.json$/);
    expect(existsSync(p)).toBe(true);
  });

  it('summarises a header without the rows and tolerates missing fields', () => {
    const s = summarizeWarfrontTerrain({ map_id: 'm', width: 3, height: 2, provinces: [1, 2], lanes: [], checksum: 'abc' });
    expect(s).toEqual({
      id: 'western_twenty',
      map_id: 'm',
      generator: '',
      cell_km: 0,
      width: 3,
      height: 2,
      cells: 6,
      provinces: 2,
      lanes: 0,
      checksum: 'abc',
    });
    expect(summarizeWarfrontTerrain({}).cells).toBe(0);
  });
});
