import { describe, expect, it } from 'vitest';
import {
  buildMapMetaFromDoc,
  evaluateEraMapCompatibility,
  formatRulesAndTheaterDisplay,
  recommendedRulesEraForTheater,
  validateLobbyMapChangePair,
} from './lobbyEraMapCompatibility';

const smallTheaterMeta = buildMapMetaFromDoc({
  map_id: 'era_risorgimento',
  era_theme: 'risorgimento',
  territories: Array.from({ length: 14 }, (_, i) => ({
    territory_id: `t_${i}`,
    region_id: 'r1',
  })),
  connections: [{ type: 'land' }, { type: 'land' }],
});

const globalMeta = buildMapMetaFromDoc({
  map_id: 'era_ancient',
  era_theme: 'ancient',
  territories: Array.from({ length: 42 }, () => ({ territory_id: 't', region_id: 'r' })),
  connections: Array.from({ length: 20 }, () => ({ type: 'sea' })),
});

describe('lobbyEraMapCompatibility', () => {
  it('allows unpaired ww2 rules on ancient theater', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ww2',
      map_id: 'era_ancient',
      settings: {},
      map_meta: globalMeta,
    });
    expect(result.allowed).toBe(true);
    expect(result.hardBlock).toBeNull();
    expect(result.warnings.some((w) => w.message.includes('Custom pairing'))).toBe(true);
  });

  it('blocks galactic pairing for non-admin', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'galaxy_age',
      map_id: 'era_galaxy',
      settings: {},
      is_admin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.hardBlock).toMatch(/administrators/i);
  });

  it('warns when naval is enabled on a theater with few sea routes', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'medieval',
      map_id: 'era_risorgimento',
      settings: { naval_enabled: true },
      map_meta: smallTheaterMeta,
    });
    expect(result.warnings.some((w) => w.tier === 'warn' && w.message.includes('sea routes'))).toBe(true);
  });

  it('blocks too many players for territory count', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ww2',
      map_id: 'era_risorgimento',
      settings: {},
      player_count: 20,
      map_meta: smallTheaterMeta,
    });
    expect(result.hardBlock).toMatch(/14 territories/);
  });

  it('formats custom pairing display', () => {
    expect(formatRulesAndTheaterDisplay('ww2', 'era_ancient')).toBe('Ancient World · World War II rules');
    expect(formatRulesAndTheaterDisplay('ww2', 'era_ww2')).toBe('World War II');
  });

  it('recommends rules era for community theaters', () => {
    expect(recommendedRulesEraForTheater('community_britain_925')).toBe('medieval');
  });

  it('validateLobbyMapChangePair returns null for valid unpaired mix', () => {
    expect(
      validateLobbyMapChangePair(
        { era_id: 'coldwar', map_id: 'era_ww2' },
        { isAdmin: false, settings: {}, map_meta: globalMeta },
      ),
    ).toBeNull();
  });

  it('pins growth-style era advancement to the spine start era (Ancient)', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ww2',
      map_id: 'era_ww2',
      settings: { era_advancement_enabled: true },
      map_meta: globalMeta,
    });
    expect(result.allowed).toBe(false);
    expect(result.hardBlock).toMatch(/starts in Ancient/i);
  });

  it('allows a board-transform game to start on a mid-line era map', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ww2',
      map_id: 'era_ww2',
      settings: { era_advancement_enabled: true, era_advancement_board_transform: true },
      map_meta: globalMeta,
    });
    expect(result.allowed).toBe(true);
    expect(result.hardBlock).toBeNull();
  });

  it('still blocks a board-transform start on an era off the ascension line', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'acw',
      map_id: 'era_acw',
      settings: { era_advancement_enabled: true, era_advancement_board_transform: true },
      map_meta: globalMeta,
    });
    expect(result.allowed).toBe(false);
    expect(result.hardBlock).toMatch(/starts in Ancient/i);
  });
});
