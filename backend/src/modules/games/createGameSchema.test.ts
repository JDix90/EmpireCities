import { normalizeGameSettings } from '../../game-engine/state/gameSettings';
import { describe, it, expect } from 'vitest';
import {
  applyOrbitGatedVictoryDefaults,
  CreateGameSchema,
  territorySelectionRejection,
  galaxyPlayerCountRejection,
  GALAXY_PLAYER_COUNT_ERROR,
  TERRITORY_SELECTION_GALAXY_ERROR,
  ORBIT_GATED_DEFAULT_MAX_TURNS,
  ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD,
} from './games.routes';

/**
 * Regression guard: zod object schemas STRIP unknown keys, so any settings
 * field a lobby sends that is missing from the whitelist silently vanishes
 * before normalizeGameSettings ever sees it. That is how Quick Match's
 * 150-turn cap was disabled without any error.
 */
describe('CreateGameSchema settings whitelist', () => {
  const quickMatchPayload = {
    era_id: 'ancient',
    map_id: 'era_ancient',
    max_players: 4,
    ai_count: 3,
    ai_difficulty: 'medium',
    auto_start: true,
    settings: {
      turn_timer_seconds: 300,
      allowed_victory_conditions: ['domination'],
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      max_turns: 150,
    },
  };

  it('keeps max_turns from the Quick Match payload', () => {
    const parsed = CreateGameSchema.safeParse(quickMatchPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.settings.max_turns).toBe(150);
    }
  });

  it('rejects an out-of-range turn cap instead of silently dropping it', () => {
    const bad = {
      ...quickMatchPayload,
      settings: { ...quickMatchPayload.settings, max_turns: 5 },
    };
    expect(CreateGameSchema.safeParse(bad).success).toBe(false);
  });
});

describe('Galactic Age lobby payload', () => {
  // LobbyPage sends these four alongside the base bundle (LobbyPage.tsx
  // handleCreateGame); before they were whitelisted, zod stripped them and the
  // Contestable Lanes + Combat Dice Cap toggles silently never reached the engine.
  const galaxyPayload = {
    era_id: 'galaxy_age',
    map_id: 'era_galaxy',
    max_players: 8,
    ai_count: 3,
    ai_difficulty: 'medium',
    settings: {
      turn_timer_seconds: 0,
      allowed_victory_conditions: ['domination'],
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      factions_enabled: true,
      combat_dice_cap_enabled: true,
      combat_max_attacker_dice: 5,
      combat_max_defender_dice: 4,
    },
  };

  it('keeps the dice-cap trio', () => {
    const parsed = CreateGameSchema.safeParse(galaxyPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const s = parsed.data.settings;
      expect(s.combat_dice_cap_enabled).toBe(true);
      expect(s.combat_max_attacker_dice).toBe(5);
      expect(s.combat_max_defender_dice).toBe(4);
    }
  });

  it('rejects dice ceilings below the natural combat base', () => {
    const bad = {
      ...galaxyPayload,
      settings: { ...galaxyPayload.settings, combat_max_attacker_dice: 2 },
    };
    expect(CreateGameSchema.safeParse(bad).success).toBe(false);
  });
});


describe('applyOrbitGatedVictoryDefaults', () => {
  // Domination-only + no turn cap never ends on an orbit-gated board (a large
  // share of tiles sit behind an orbit gate). Galaxy AND standalone Space Age
  // both get a threshold+turn-limit endgame unless the caller chose otherwise.
  it('adds threshold 60% and max_turns 90 when the caller chose nothing', () => {
    const out = applyOrbitGatedVictoryDefaults(
      { allowed_victory_conditions: ['domination' as const] },
      { isOrbitGated: true, callerChoseVictory: false },
    );
    expect(out.allowed_victory_conditions).toEqual(['domination', 'threshold']);
    expect(out.victory_threshold).toBe(ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD);
    expect(out.max_turns).toBe(ORBIT_GATED_DEFAULT_MAX_TURNS);
  });

  it('respects an explicit victory choice but still backstops max_turns', () => {
    const out = applyOrbitGatedVictoryDefaults(
      { allowed_victory_conditions: ['domination' as const] },
      { isOrbitGated: true, callerChoseVictory: true },
    );
    expect(out.allowed_victory_conditions).toEqual(['domination']);
    expect(out.victory_threshold).toBeUndefined();
    expect(out.max_turns).toBe(ORBIT_GATED_DEFAULT_MAX_TURNS);
  });

  it('never overrides an explicit turn cap or threshold', () => {
    const out = applyOrbitGatedVictoryDefaults(
      { allowed_victory_conditions: ['domination' as const, 'threshold' as const], victory_threshold: 75, max_turns: 200 },
      { isOrbitGated: true, callerChoseVictory: true },
    );
    expect(out.victory_threshold).toBe(75);
    expect(out.max_turns).toBe(200);
  });

  it('is a no-op for non-orbit-gated creates', () => {
    const input = { allowed_victory_conditions: ['domination' as const] };
    const out = applyOrbitGatedVictoryDefaults(input, { isOrbitGated: false, callerChoseVictory: false });
    expect(out).toBe(input);
  });
});

describe('Full Game Start payload', () => {
  const fullGamePayload = {
    era_id: 'ancient',
    map_id: 'era_ancient',
    max_players: 4,
    ai_count: 3,
    ai_difficulty: 'medium',
    auto_start: true,
    settings: {
      turn_timer_seconds: 300,
      allowed_victory_conditions: ['domination'],
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: true,
      naval_enabled: true,
      events_enabled: true,
      era_advancement_enabled: true,
      era_advancement_preset: 'standard',
      max_turns: 150,
    },
  };

  it('validates and preserves the full-game bundle (factions intentionally omitted)', () => {
    const parsed = CreateGameSchema.safeParse(fullGamePayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const s = parsed.data.settings;
      expect(s.era_advancement_enabled).toBe(true);
      expect(s.era_advancement_preset).toBe('standard');
      expect(s.economy_enabled).toBe(true);
      expect(s.tech_trees_enabled).toBe(true);
      expect(s.stability_enabled).toBe(true);
      expect(s.naval_enabled).toBe(true);
      expect(s.events_enabled).toBe(true);
      expect(s.factions_enabled).toBeUndefined();
      // auto_start only fires when every non-host seat is AI
      expect(parsed.data.auto_start).toBe(true);
      expect(parsed.data.ai_count).toBe(parsed.data.max_players - 1);
    }
  });

  it('rejects Era Advancement without Economy (the in-form dependency)', () => {
    const bad = {
      ...fullGamePayload,
      settings: { ...fullGamePayload.settings, economy_enabled: false },
    };
    expect(CreateGameSchema.safeParse(bad).success).toBe(false);
  });
});

describe('territorySelectionRejection', () => {
  // Territory Draft on a galaxy map leaves all 48 off-world tiles neutral with
  // ZERO units — exempt from the draft, and never armed with a garrison — and
  // executeLandAttack refuses a defender below one unit, so nobody can ever
  // take them. Measured on era_galaxy before the create-time rejection.
  it('rejects Territory Draft in the Galactic Age', () => {
    expect(territorySelectionRejection({ territorySelection: true, isGalacticAge: true }))
      .toBe(TERRITORY_SELECTION_GALAXY_ERROR);
  });

  it('leaves Territory Draft alone on every other era', () => {
    expect(territorySelectionRejection({ territorySelection: true, isGalacticAge: false })).toBeNull();
  });

  it('is silent when Territory Draft is off', () => {
    expect(territorySelectionRejection({ isGalacticAge: true })).toBeNull();
    expect(territorySelectionRejection({ territorySelection: false, isGalacticAge: true })).toBeNull();
  });
});

describe('galaxyPlayerCountRejection', () => {
  // Four seats with four distinct factions is the only shape that produces the
  // designed one-faction-per-world start; anything else scatters every seat
  // across worlds it cannot reach.
  it('accepts exactly four seats', () => {
    expect(galaxyPlayerCountRejection({ isGalacticAge: true, totalPlayers: 4 })).toBeNull();
  });

  it('rejects every other seat count', () => {
    for (const seats of [1, 2, 3, 5, 6, 8]) {
      expect(galaxyPlayerCountRejection({ isGalacticAge: true, totalPlayers: seats }))
        .toBe(GALAXY_PLAYER_COUNT_ERROR);
    }
  });

  it('leaves other eras alone', () => {
    for (const seats of [2, 3, 5]) {
      expect(galaxyPlayerCountRejection({ isGalacticAge: false, totalPlayers: seats })).toBeNull();
    }
  });
});

describe('galaxy_corridors_enabled', () => {
  // Baked at create from the feature flag (never client input), and persisted
  // only when on — the normalizer must carry it through room reloads.
  it('survives normalization when on, and is absent when off', () => {
    expect(normalizeGameSettings({ galaxy_corridors_enabled: true } as never).galaxy_corridors_enabled).toBe(true);
    expect(normalizeGameSettings({} as never).galaxy_corridors_enabled).toBeUndefined();
  });

  it('is not part of the create-API whitelist', () => {
    const parsed = CreateGameSchema.safeParse({
      era_id: 'galaxy_age',
      map_id: 'era_galaxy',
      max_players: 4,
      ai_count: 3,
      settings: { allowed_victory_conditions: ['domination'], factions_enabled: true, galaxy_corridors_enabled: false },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data.settings as Record<string, unknown>).galaxy_corridors_enabled).toBeUndefined();
    }
  });
});
