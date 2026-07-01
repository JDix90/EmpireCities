import { describe, it, expect } from 'vitest';
import { validateMapGeometry, type GeoMapDocument } from './mapGeometry';

function mapOf(territories: GeoMapDocument['territories']): GeoMapDocument {
  return { map_id: 'test', territories };
}

describe('validateMapGeometry — shared-code double-draw guard', () => {
  it('passes when every code is used by a single territory', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'a', geo_config: [{ iso: 'TH' }] },
      { territory_id: 'b', geo_config: [{ iso: 'VN' }] },
    ]));
    expect(errs).toEqual([]);
  });

  it('flags two territories sharing an UNCLIPPED iso (the LK/KR/TH class of bug)', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'ayutthaya', geo_config: [{ iso: 'TH' }] },
      { territory_id: 'tenasserim', geo_config: [{ iso: 'TH' }] },
    ]));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"TH"');
    expect(errs[0]).toContain('ayutthaya');
    expect(errs[0]).toContain('tenasserim');
  });

  it('passes when a shared iso is clipped in every territory (the fix)', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'ayutthaya', geo_config: [{ iso: 'TH', clip_bbox: [97, 12.8, 106, 21] }] },
      { territory_id: 'tenasserim', geo_config: [{ iso: 'TH', clip_bbox: [97, 5.4, 106, 12.8] }] },
    ]));
    expect(errs).toEqual([]);
  });

  it('flags a legacy iso_codes duplicate with no clip', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'x', iso_codes: ['SG'] },
      { territory_id: 'y', iso_codes: ['SG'] },
    ]));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"SG"');
  });

  it('flags a mixed clipped/unclipped share (only the unclipped side draws the full shape)', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'clipped', geo_config: [{ iso: 'PE', clip_bbox: [-75, -18, -68, -13] }] },
      { territory_id: 'whole', iso_codes: ['PE'] },
    ]));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('whole');
  });

  it('passes when a shared admin-1 province is split via admin1_clips', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'sakha_west', admin1: ['RU-SA'], admin1_clips: { 'RU-SA': [100, 55, 131, 74] } },
      { territory_id: 'yakutia_east', admin1: ['RU-SA'], admin1_clips: { 'RU-SA': [131, 55, 165, 74] } },
    ]));
    expect(errs).toEqual([]);
  });

  it('treats a territory-level clip_bbox as clipping its admin-1 union', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'dzungaria', admin1: ['CN-XJ'], clip_bbox: [73, 43, 96, 49.5] },
      { territory_id: 'tarim', admin1: ['CN-XJ'], clip_bbox: [73, 36, 96, 43] },
    ]));
    expect(errs).toEqual([]);
  });

  it('flags a shared admin-1 code where one side is unclipped', () => {
    const errs = validateMapGeometry(mapOf([
      { territory_id: 'a', admin1: ['CN-XJ'], clip_bbox: [73, 43, 96, 49.5] },
      { territory_id: 'b', admin1: ['CN-XJ'] },
    ]));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"CN-XJ"');
    expect(errs[0]).toContain('b');
  });
});
