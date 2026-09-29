import { describe, expect, it } from 'vitest';
import {
  describeSecretMission,
  formatEraLabel,
  humanizeMapId,
  resolveRegionName,
  resolveTerritoryName,
} from './mapDisplayNames';
import type { PlayerState } from '../store/gameStore';

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

  it('says when an eliminate mission can no longer succeed', () => {
    const mission = { kind: 'eliminate_player' as const, target_player_id: 't' };
    const target = (over: Partial<PlayerState>) =>
      [{ player_id: 't', username: 'Sam', is_eliminated: false, ...over }] as PlayerState[];
    expect(describeSecretMission(mission, target({}), null, 'me')).toBe('Eliminate Sam');
    expect(describeSecretMission(mission, target({ is_eliminated: true, eliminated_by: 'rival' }), null, 'me'))
      .toBe('Eliminate Sam — failed: Sam is out, but not by your hand');
    expect(describeSecretMission(mission, target({ is_eliminated: true, eliminated_by: null }), null, 'me'))
      .toBe('Eliminate Sam — failed: Sam is out, but not by your hand');
  });

  it('formats era labels from ERA_LABELS', () => {
    expect(formatEraLabel('modern')).toBe('Modern Day');
    expect(formatEraLabel('custom')).toBe('Community map');
  });
});
