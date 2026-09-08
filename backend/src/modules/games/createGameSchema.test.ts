import { describe, it, expect } from 'vitest';
import {
  applyOrbitGatedVictoryDefaults,
  CreateGameSchema,
  LANES_CONTESTABLE_NON_GALAXY_ERROR,
  lanesContestableRejection,
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
      lanes_contestable_enabled: true,
      combat_dice_cap_enabled: true,
      combat_max_attacker_dice: 5,
      combat_max_defender_dice: 4,
    },
  };

  it('keeps lanes_contestable_enabled and the dice-cap trio', () => {
    const parsed = CreateGameSchema.safeParse(galaxyPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const s = parsed.data.settings;
      expect(s.lanes_contestable_enabled).toBe(true);
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

describe('lanesContestableRejection', () => {
  // canSealLane only requires an orbit-typed connection, and the Space Age map
  // authors three — so without this guard a hand-crafted create could arm lane
  // sealing outside the Galactic Age, where neither the lobby toggle nor the
  // GalaxyStrategicView seal action exists.
  it('rejects lanes_contestable_enabled outside the Galactic Age', () => {
    expect(lanesContestableRejection({ lanesContestableEnabled: true, isGalacticAge: false })).toBe(
      LANES_CONTESTABLE_NON_GALAXY_ERROR,
    );
  });

  it('allows it on a galaxy create', () => {
    expect(lanesContestableRejection({ lanesContestableEnabled: true, isGalacticAge: true })).toBeNull();
  });

  it('ignores creates that never asked for it', () => {
    expect(lanesContestableRejection({ isGalacticAge: false })).toBeNull();
    expect(lanesContestableRejection({ lanesContestableEnabled: false, isGalacticAge: false })).toBeNull();
  });

  it('matches how the route classifies a Galactic Age create (era_id or map_id)', () => {
    const spaceAge = {
      era_id: 'space_age',
      map_id: 'era_space_age',
      max_players: 4,
      ai_count: 3,
      ai_difficulty: 'medium',
      settings: {
        turn_timer_seconds: 0,
        allowed_victory_conditions: ['domination'],
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: true,
        lanes_contestable_enabled: true,
      },
    };
    // The schema still accepts the field (galaxy creates need it) — the route
    // guard is what turns a Space Age create into a 400.
    const parsed = CreateGameSchema.safeParse(spaceAge);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const isGalacticAge =
        parsed.data.era_id === 'galaxy_age' || parsed.data.map_id === 'era_galaxy';
      expect(
        lanesContestableRejection({
          lanesContestableEnabled: parsed.data.settings.lanes_contestable_enabled,
          isGalacticAge,
        }),
      ).toBe(LANES_CONTESTABLE_NON_GALAXY_ERROR);
    }
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
