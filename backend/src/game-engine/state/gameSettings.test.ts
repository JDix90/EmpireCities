import { describe, it, expect } from 'vitest';
import { normalizeGameSettings, getAllowedVictoryConditions } from './gameSettings';
import type { GameSettings } from '../../types';

describe('normalizeGameSettings', () => {
  it('preserves economy_snapshot and xp_snapshot from lobby JSON', () => {
    const s = normalizeGameSettings({
      fog_of_war: false,
      victory_type: 'domination',
      economy_snapshot: { building_costs: { production_1: 99 } as any },
      xp_snapshot: { base: 12 },
    });
    expect(s.economy_snapshot?.building_costs?.production_1).toBe(99);
    expect(s.xp_snapshot?.base).toBe(12);
  });
  it('maps legacy victory_type to allowed_victory_conditions', () => {
    const s = normalizeGameSettings({ fog_of_war: false, victory_type: 'threshold', victory_threshold: 55 });
    expect(s.allowed_victory_conditions).toEqual(['threshold']);
    expect(s.victory_threshold).toBe(55);
  });

  it('preserves tutorial lesson module and tech point grant', () => {
    const s = normalizeGameSettings({
      fog_of_war: false,
      victory_type: 'domination',
      tutorial: true,
      tutorial_lesson_module: 'tech_tree',
      tutorial_grant_tech_points: 8,
    });
    expect(s.tutorial).toBe(true);
    expect(s.tutorial_lesson_module).toBe('tech_tree');
    expect(s.tutorial_grant_tech_points).toBe(8);
  });

  it('prefers allowed_victory_conditions when present', () => {
    const s = normalizeGameSettings({
      fog_of_war: false,
      victory_type: 'domination',
      allowed_victory_conditions: ['capital', 'secret_mission'],
    } as Partial<GameSettings>);
    expect(s.allowed_victory_conditions).toEqual(['capital', 'secret_mission']);
  });
});

describe('new-game rule defaults stay OUT of the normalizer', () => {
  // normalizeGameSettings re-runs on every room load (repairLegacyGameState →
  // gameRoomManager.repairRoom) and re-persists the result, so anything given a
  // default here would retroactively re-rule matches already in progress. The
  // dice cap and card-set ceiling are defaulted at the create boundary in
  // modules/games/games.routes.ts instead; these assertions are the guard.
  it('leaves the combat dice cap off when the key is absent', () => {
    const s = normalizeGameSettings({ fog_of_war: false, victory_type: 'domination' });
    expect(s.combat_dice_cap_enabled).toBeFalsy();
  });

  it('leaves card sets uncapped when the key is absent', () => {
    const s = normalizeGameSettings({ fog_of_war: false, victory_type: 'domination' });
    expect(s.card_set_bonus_cap).toBeUndefined();
  });

  it('round-trips an explicit cap, including an explicit 0 for uncapped', () => {
    const capped = normalizeGameSettings({ fog_of_war: false, victory_type: 'domination', card_set_bonus_cap: 30 } as Partial<GameSettings>);
    expect(capped.card_set_bonus_cap).toBe(30);
    // 0 must survive as 0 rather than being coerced back to a default — it is
    // how the Custom Game "uncapped card sets" opt-in is expressed.
    const uncapped = normalizeGameSettings({ fog_of_war: false, victory_type: 'domination', card_set_bonus_cap: 0 } as Partial<GameSettings>);
    expect(uncapped.card_set_bonus_cap).toBe(0);
  });

  it('round-trips an explicit dice-cap choice in both directions', () => {
    const on = normalizeGameSettings({ fog_of_war: false, victory_type: 'domination', combat_dice_cap_enabled: true } as Partial<GameSettings>);
    expect(on.combat_dice_cap_enabled).toBe(true);
    // An explicit OFF must not come back ON on the next load, or the Custom
    // Game checkbox becomes one-way.
    const off = normalizeGameSettings({ fog_of_war: false, victory_type: 'domination', combat_dice_cap_enabled: false } as Partial<GameSettings>);
    expect(normalizeGameSettings(off).combat_dice_cap_enabled).toBeFalsy();
  });
});

describe('getAllowedVictoryConditions', () => {
  it('falls back to victory_type', () => {
    const s = normalizeGameSettings({ fog_of_war: false, victory_type: 'threshold', victory_threshold: 40 });
    expect(getAllowedVictoryConditions(s)).toEqual(['threshold']);
  });
});
