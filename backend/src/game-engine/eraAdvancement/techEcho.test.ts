import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import {
  ensureEraKeyedEcho,
  getTechEchoBonus,
  isFlatEchoRecord,
  LEGACY_ECHO_KEY,
  storeTechEcho,
} from './techEcho';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p1', current_era_index: 1, ...overrides } as PlayerState;
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    settings: { era_advancement_enabled: true },
    ...overrides,
  } as GameState;
}

describe('isFlatEchoRecord', () => {
  it('detects flat stat records vs era-keyed stores', () => {
    expect(isFlatEchoRecord({ attack_bonus: 2 })).toBe(true);
    expect(isFlatEchoRecord({ ancient: { attack_bonus: 2 } })).toBe(false);
    expect(isFlatEchoRecord({})).toBe(false);
  });
});

describe('ensureEraKeyedEcho', () => {
  it('wraps a flat echo under the legacy key', () => {
    const p = player({ era_advancement_tech_echo: { attack_bonus: 2, reinforce_bonus: 1 } });
    const keyed = ensureEraKeyedEcho(p);
    expect(keyed).toEqual({ [LEGACY_ECHO_KEY]: { attack_bonus: 2, reinforce_bonus: 1 } });
    expect(p.era_advancement_tech_echo).toBe(keyed);
  });

  it('is idempotent on keyed stores and initializes missing ones', () => {
    const p = player({ era_advancement_tech_echo: { ancient: { attack_bonus: 2 } } });
    const before = p.era_advancement_tech_echo;
    expect(ensureEraKeyedEcho(p)).toBe(before);

    const fresh = player({ era_advancement_tech_echo: undefined });
    expect(ensureEraKeyedEcho(fresh)).toEqual({});
    expect(fresh.era_advancement_tech_echo).toEqual({});
  });
});

describe('storeTechEcho', () => {
  it('stores captured bonuses under the departing era key', () => {
    const p = player({ era_advancement_tech_echo: {} });
    storeTechEcho(p, 'ancient', { attack_bonus: 2 });
    expect(p.era_advancement_tech_echo).toEqual({ ancient: { attack_bonus: 2 } });
  });

  it('merges additively and ignores empty captures', () => {
    const p = player({ era_advancement_tech_echo: { ancient: { attack_bonus: 1 } } });
    storeTechEcho(p, 'ancient', { attack_bonus: 1, defense_bonus: 1 });
    storeTechEcho(p, 'medieval', {});
    expect(p.era_advancement_tech_echo).toEqual({ ancient: { attack_bonus: 2, defense_bonus: 1 } });
  });

  it('wraps a flat store before writing into it', () => {
    const p = player({ era_advancement_tech_echo: { attack_bonus: 2 } });
    storeTechEcho(p, 'medieval', { defense_bonus: 1 });
    expect(p.era_advancement_tech_echo).toEqual({
      [LEGACY_ECHO_KEY]: { attack_bonus: 2 },
      medieval: { defense_bonus: 1 },
    });
  });
});

describe('getTechEchoBonus', () => {
  it('returns 0 when era advancement is disabled or no echo exists', () => {
    const disabled = state({ settings: { era_advancement_enabled: false } } as Partial<GameState>);
    expect(getTechEchoBonus(disabled, player({ era_advancement_tech_echo: { attack_bonus: 2 } }), 'attack_bonus')).toBe(0);
    expect(getTechEchoBonus(state(), player(), 'attack_bonus')).toBe(0);
  });

  it('reads an unrepaired flat echo at full strength', () => {
    const p = player({ era_advancement_tech_echo: { attack_bonus: 2 } });
    expect(getTechEchoBonus(state(), p, 'attack_bonus')).toBe(2);
    expect(getTechEchoBonus(state(), p, 'defense_bonus')).toBe(0);
  });

  it('decays era-keyed contributions by spine distance and adds legacy on top (default decay 0.5)', () => {
    const p = player({
      current_era_index: 2,
      era_advancement_tech_echo: {
        [LEGACY_ECHO_KEY]: { attack_bonus: 1 }, // exempt → +1
        ancient: { attack_bonus: 2 }, // gap 1 → ×0.5 = 1.0
        medieval: { attack_bonus: 1, reinforce_bonus: 3 }, // gap 0 → ×1.0
      },
    });
    const s = state({
      era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }, { era_id: 'discovery' }],
    });
    // attack: legacy 1 + round(min(1.0 + 1.0, cap 2)) = 1 + 2 = 3
    expect(getTechEchoBonus(s, p, 'attack_bonus')).toBe(3);
    // reinforce: legacy 0 + round(min(3.0, cap 2)) = 2
    expect(getTechEchoBonus(s, p, 'reinforce_bonus')).toBe(2);
  });

  it('respects a custom decay and rounds the fractional total', () => {
    const p = player({
      current_era_index: 3,
      era_advancement_tech_echo: { ancient: { attack_bonus: 2 } }, // gap 2
    });
    const s = state({
      era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }, { era_id: 'discovery' }, { era_id: 'ww2' }],
      settings: { era_advancement_enabled: true, era_advancement_echo_decay: 0.5 },
    } as Partial<GameState>);
    // 2 × 0.5^2 = 0.5 → round → 1 (cap not reached)
    expect(getTechEchoBonus(s, p, 'attack_bonus')).toBe(1);
  });

  it('caps the era-keyed total per stat but never the legacy bucket', () => {
    const p = player({
      current_era_index: 1,
      era_advancement_tech_echo: {
        [LEGACY_ECHO_KEY]: { attack_bonus: 5 }, // grandfathered above the cap
        ancient: { attack_bonus: 4 }, // gap 0 → 4, clamped to cap 2
      },
    });
    const s = state({ era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }] });
    expect(getTechEchoBonus(s, p, 'attack_bonus')).toBe(7); // 5 legacy + min(4, cap 2)
  });

  it('honors a configured per-stat cap override', () => {
    const p = player({
      current_era_index: 1,
      era_advancement_tech_echo: { ancient: { attack_bonus: 5 } },
    });
    const s = state({
      era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }],
      settings: { era_advancement_enabled: true, era_advancement_echo_cap_attack: 3 },
    } as Partial<GameState>);
    expect(getTechEchoBonus(s, p, 'attack_bonus')).toBe(3);
  });

  it('treats era keys missing from the spine as full-strength (weight 1)', () => {
    const p = player({ era_advancement_tech_echo: { acw: { attack_bonus: 1 } } });
    expect(getTechEchoBonus(state(), p, 'attack_bonus')).toBe(1);
  });
});
