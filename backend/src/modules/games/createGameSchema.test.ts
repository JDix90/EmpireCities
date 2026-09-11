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

/**
 * Quick Match's win-condition picker (frontend `quickMatchVictorySettings`)
 * sends one of these four settings fragments. They cross the create boundary as
 * plain JSON, so nothing on the frontend can catch a shape zod rejects — or,
 * worse, silently strips. Mirrored here rather than imported: the backend does
 * not build against the frontend package, and a divergence is exactly what this
 * guards.
 */
describe('Quick Match win-condition payloads', () => {
  const QUICK_MATCH_VICTORY_FRAGMENTS = {
    blitz: { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 50, max_turns: 45 },
    majority: { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 65, max_turns: 60 },
    capitals: { allowed_victory_conditions: ['capital', 'domination'], max_turns: 90 },
    conquest: { allowed_victory_conditions: ['domination'], max_turns: 120 },
  } as const;

  const payloadFor = (fragment: Record<string, unknown>, eraId = 'ancient', mapId = 'era_ancient') => ({
    era_id: eraId,
    map_id: mapId,
    max_players: 4,
    ai_count: 3,
    ai_difficulty: 'medium',
    auto_start: true,
    settings: {
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      ...fragment,
    },
  });

  it('accepts every fragment and keeps its conditions, threshold and turn cap', () => {
    for (const [mode, fragment] of Object.entries(QUICK_MATCH_VICTORY_FRAGMENTS)) {
      const parsed = CreateGameSchema.safeParse(payloadFor(fragment));
      expect(parsed.success, `${mode} payload rejected`).toBe(true);
      if (!parsed.success) continue;
      const s = parsed.data.settings;
      expect(s.allowed_victory_conditions).toEqual([...fragment.allowed_victory_conditions]);
      expect(s.max_turns).toBe(fragment.max_turns);
      expect(s.victory_threshold).toBe(
        'victory_threshold' in fragment ? fragment.victory_threshold : undefined,
      );
    }
  });

  it('survives normalization with the picked conditions intact', () => {
    for (const [mode, fragment] of Object.entries(QUICK_MATCH_VICTORY_FRAGMENTS)) {
      const parsed = CreateGameSchema.safeParse(payloadFor(fragment));
      if (!parsed.success) throw new Error(`${mode} payload rejected`);
      const normalized = normalizeGameSettings(parsed.data.settings);
      expect(normalized.allowed_victory_conditions, mode).toEqual([...fragment.allowed_victory_conditions]);
      expect(normalized.max_turns, mode).toBe(fragment.max_turns);
    }
  });

  it('keeps the Full Game 150-turn cap under every ending', () => {
    // LobbyPage's startFullGame spreads the chosen fragment and then sets
    // max_turns: 150 after it; the era-advancement marathon keeps its own cap.
    const fullGameBase = {
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: true,
      naval_enabled: true,
      events_enabled: true,
      era_advancement_enabled: true,
      era_advancement_preset: 'standard',
      era_advancement_max_lead: 2,
    };
    for (const [mode, fragment] of Object.entries(QUICK_MATCH_VICTORY_FRAGMENTS)) {
      const parsed = CreateGameSchema.safeParse(
        payloadFor({ ...fullGameBase, ...fragment, max_turns: 150 }),
      );
      expect(parsed.success, `${mode} full-game payload rejected`).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.settings.max_turns, mode).toBe(150);
      expect(parsed.data.settings.allowed_victory_conditions, mode).toEqual([...fragment.allowed_victory_conditions]);
      expect(parsed.data.settings.era_advancement_enabled, mode).toBe(true);
    }
  });

  it('rejects a threshold list sent without its percentage', () => {
    // The picker's threshold modes must always send both; superRefine enforces
    // it, so a fragment that ever lost the percentage fails loudly here.
    const bad = payloadFor({ allowed_victory_conditions: ['domination', 'threshold'], max_turns: 60 });
    expect(CreateGameSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts the Capitals fragment on Space Age, which Conquest never rolls', () => {
    // Capital victory is reachable on the Earth tiles, so Space Age stays in
    // the rotation for it; only the full-board ending narrows the pool
    // (frontend quickMatchEraPool).
    const parsed = CreateGameSchema.safeParse(
      payloadFor(
        { ...QUICK_MATCH_VICTORY_FRAGMENTS.capitals, economy_enabled: true, tech_trees_enabled: true },
        'space_age',
        'era_space_age',
      ),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // An explicit caller choice — applyOrbitGatedVictoryDefaults must not
      // paste a 60% threshold over it and end the match early anyway.
      const out = applyOrbitGatedVictoryDefaults(parsed.data.settings, {
        isOrbitGated: true,
        callerChoseVictory: true,
      });
      expect(out.allowed_victory_conditions).toEqual(['capital', 'domination']);
      expect(out.victory_threshold).toBeUndefined();
      expect(out.max_turns).toBe(90);
    }
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

  it('adds Lane Sovereignty on a galaxy create, and only there', () => {
    const galaxy = applyOrbitGatedVictoryDefaults(
      { allowed_victory_conditions: ['domination' as const] },
      { isOrbitGated: true, isGalacticAge: true, callerChoseVictory: false },
    );
    expect(galaxy.allowed_victory_conditions).toEqual(['domination', 'threshold', 'lane_sovereignty']);
    const spaceAge = applyOrbitGatedVictoryDefaults(
      { allowed_victory_conditions: ['domination' as const] },
      { isOrbitGated: true, callerChoseVictory: false },
    );
    expect(spaceAge.allowed_victory_conditions).not.toContain('lane_sovereignty');
    // An explicit victory choice still wins, galaxy or not.
    const chosen = applyOrbitGatedVictoryDefaults(
      { allowed_victory_conditions: ['domination' as const] },
      { isOrbitGated: true, isGalacticAge: true, callerChoseVictory: true },
    );
    expect(chosen.allowed_victory_conditions).toEqual(['domination']);
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
