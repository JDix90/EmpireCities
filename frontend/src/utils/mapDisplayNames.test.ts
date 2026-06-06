import { describe, expect, it } from 'vitest';
import {
  describeSecretMission,
  formatEraLabel,
  humanizeMapId,
  resolveRegionName,
  resolveTerritoryName,
} from './mapDisplayNames';

const lookup = {
  territories: [
    { territory_id: 'argentina_mod', name: 'Argentina & Uruguay' },
    { territory_id: 'central_america_mod', name: 'Central America & Caribbean' },
  ],
  regions: [{ region_id: 'latin_america_2100', name: 'Latin America' }],
};

describe('mapDisplayNames', () => {
  it('uses map territory names when available', () => {
    expect(resolveTerritoryName('argentina_mod', lookup)).toBe('Argentina & Uruguay');
  });

  it('humanizes unknown territory ids', () => {
    expect(humanizeMapId('central_africa_mod')).toBe('Central Africa');
  });

  it('uses map region names when available', () => {
    expect(resolveRegionName('latin_america_2100', lookup)).toBe('Latin America');
  });

  it('formats secret capture missions with natural language', () => {
    const text = describeSecretMission(
      { kind: 'capture_territories', territory_ids: ['central_america_mod', 'argentina_mod'] },
      [],
      lookup,
    );
    expect(text).toBe('Own Central America & Caribbean and Argentina & Uruguay');
  });

  it('formats era labels from ERA_LABELS', () => {
    expect(formatEraLabel('modern')).toBe('Modern Day');
    expect(formatEraLabel('custom')).toBe('Community map');
  });
});
