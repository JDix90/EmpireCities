import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { EraId } from '../../types';
import { getEraFactions } from '../eras';
import { validateMapRegions, type MapRegionDocument } from './mapRegions';

const territories = [
  { territory_id: 'a', region_id: 'pair' },
  { territory_id: 'b', region_id: 'pair' },
  { territory_id: 'c', region_id: 'lone' },
];

describe('validateMapRegions', () => {
  it('passes a bonus region of two territories', () => {
    expect(validateMapRegions({ territories, regions: [{ region_id: 'pair', bonus: 2 }] })).toEqual([]);
  });

  it('rejects a bonus region of one territory', () => {
    const errors = validateMapRegions({ territories, regions: [{ region_id: 'lone', bonus: 3 }] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"lone" has a +3 bonus but 1 territory');
  });

  it('rejects a bonus region with no territories', () => {
    expect(validateMapRegions({ territories, regions: [{ region_id: 'empty', bonus: 1 }] })).toHaveLength(1);
  });

  it('lets a region with no bonus hold one territory', () => {
    expect(validateMapRegions({ territories, regions: [{ region_id: 'lone', bonus: 0 }] })).toEqual([]);
  });

  it("lets a faction's home keep a bonus on one territory", () => {
    const map = { territories, regions: [{ region_id: 'lone', bonus: 2 }] };
    expect(validateMapRegions(map)).toHaveLength(1);
    expect(validateMapRegions(map, new Set(['lone']))).toEqual([]);
  });

  it("reads a community map's member lists", () => {
    const map = {
      territories: [{ territory_id: 'a' }, { territory_id: 'b' }],
      regions: [{ region_id: 'listed', bonus: 2, territory_ids: ['a'] }],
    };
    expect(validateMapRegions(map)).toHaveLength(1);
    map.regions[0]!.territory_ids = ['a', 'b'];
    expect(validateMapRegions(map)).toEqual([]);
  });

  it('passes every map the game ships', () => {
    const dir = join(__dirname, '../../../../database/maps');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const map = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as MapRegionDocument & { era_theme?: EraId };
      if (!Array.isArray(map.territories)) continue;
      const homes = new Set((map.era_theme ? getEraFactions(map.era_theme) : []).flatMap((f) => f.home_region_ids ?? []));
      expect(validateMapRegions(map, homes), file).toEqual([]);
    }
  });
});
