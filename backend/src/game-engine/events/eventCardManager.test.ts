import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState, EventCard } from '../../types';
import {
  applyEventEffect,
  getEventMagnitudeScale,
  getEventProgressionLevel,
  getDisplayScaledCard,
} from './eventCardManager';

function makePlayer(id: string, index: number, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: id,
    player_index: index,
    username: id,
    color: '#fff',
    territory_count: 2,
    cards: [],
    is_eliminated: false,
    ...overrides,
  };
}

function makeTerritory(owner: string | null, units: number): TerritoryState {
  return {
    owner_id: owner,
    unit_count: units,
  } as TerritoryState;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ww2',
    turn_number: 2,
    current_player_index: 0,
    phase: 'draft',
    draft_units_remaining: 5,
    draft_placements_this_turn: {},
    turn_started_at: Date.now(),
    players: [makePlayer('p1', 0), makePlayer('p2', 1)],
    territories: {
      a: makeTerritory('p1', 3),
      b: makeTerritory('p1', 2),
    },
    settings: { events_enabled: true } as GameState['settings'],
    diplomacy: [],
    ...overrides,
  } as GameState;
}

describe('applyEventEffect units_added player', () => {
  it('adds reinforcements to draft pool during draft for the current player', () => {
    const state = baseState({ draft_units_remaining: 5 });
    const r = applyEventEffect(
      state,
      { type: 'units_added', target: 'player', value: 4 },
      false,
    );
    expect(state.draft_units_remaining).toBe(9);
    expect(r.draft_units_granted).toBe(4);
    expect(state.territories.a.unit_count).toBe(3);
    expect(state.territories.b.unit_count).toBe(2);
  });

  it('round-robin distributes on map when not in draft phase', () => {
    const state = baseState({ phase: 'attack', draft_units_remaining: 0 });
    const r = applyEventEffect(
      state,
      { type: 'units_added', target: 'player', value: 5 },
      false,
    );
    expect(state.draft_units_remaining).toBe(0);
    expect(state.territories.a.unit_count).toBe(6);
    expect(state.territories.b.unit_count).toBe(4);
    expect(r.affected_territories?.reduce((s, x) => s + x.delta, 0)).toBe(5);
  });

  it('credits draft for current player and map for others when affects_all in draft', () => {
    const state = baseState({
      draft_units_remaining: 2,
      territories: {
        a: makeTerritory('p1', 1),
        b: makeTerritory('p2', 4),
        c: makeTerritory('p2', 2),
      },
    });
    const r = applyEventEffect(
      state,
      { type: 'units_added', target: 'player', value: 2 },
      true,
    );
    expect(state.draft_units_remaining).toBe(4); // p1 current +2
    expect(state.territories.b.unit_count).toBe(5);
    expect(state.territories.c.unit_count).toBe(3);
    expect(r.draft_units_granted).toBe(2);
    expect(r.affected_territories?.length).toBeGreaterThan(0);
  });
});

describe('applyEventEffect region_disaster', () => {
  it('returns per-territory deltas with global flag', () => {
    const state = baseState({
      phase: 'attack',
      territories: {
        a: makeTerritory('p1', 4),
        b: makeTerritory('p2', 3),
        c: makeTerritory('p2', 1),
      },
    });
    const r = applyEventEffect(
      state,
      { type: 'region_disaster', target: 'region', value: 1 },
      false,
    );
    expect(r.global).toBe(true);
    expect(r.affected_territories?.length).toBe(2);
    expect(state.territories.a.unit_count).toBe(3);
    expect(state.territories.b.unit_count).toBe(2);
    expect(state.territories.c.unit_count).toBe(1);
  });
});

// ── Progression-based impact scaling (#2) ─────────────────────────────────────

/** Era-Advancement state where the world's lead player sits at `eraIndex`. */
function eraState(eraIndex: number, overrides: Partial<GameState> = {}): GameState {
  return baseState({
    era: 'ancient',
    turn_number: 1,
    settings: { events_enabled: true, era_advancement_enabled: true } as GameState['settings'],
    players: [
      makePlayer('p1', 0, { current_era_index: eraIndex }),
      makePlayer('p2', 1, { current_era_index: 0 }),
    ],
    ...overrides,
  });
}

describe('getEventProgressionLevel / getEventMagnitudeScale', () => {
  it('is flat (×1) early in a non-era game', () => {
    expect(getEventProgressionLevel(baseState({ turn_number: 2 }))).toBe(0);
    expect(getEventMagnitudeScale(baseState({ turn_number: 2 }))).toBe(1);
  });

  it('scales with the leading player era index in Era Advancement', () => {
    expect(getEventMagnitudeScale(eraState(2))).toBe(2); // 1 + 2*0.5
    expect(getEventProgressionLevel(eraState(2))).toBe(2);
  });

  it('takes the most-advanced living player as the world level', () => {
    const s = eraState(0);
    s.players[1].current_era_index = 3;
    expect(getEventProgressionLevel(s)).toBe(3);
    expect(getEventMagnitudeScale(s)).toBe(2.5);
  });

  it('caps the multiplier at ×3', () => {
    expect(getEventMagnitudeScale(eraState(10))).toBe(3);
  });

  it('uses turn count as a floor when there is no era progression', () => {
    expect(getEventProgressionLevel(baseState({ turn_number: 25 }))).toBe(2); // floor(24/12)
    expect(getEventMagnitudeScale(baseState({ turn_number: 25 }))).toBe(2);
  });

  it('returns ×1 when scaling is explicitly disabled', () => {
    const s = eraState(4, {
      settings: {
        events_enabled: true,
        era_advancement_enabled: true,
        event_impact_scaling_enabled: false,
      } as GameState['settings'],
    });
    expect(getEventMagnitudeScale(s)).toBe(1);
  });
});

describe('applyEventEffect — magnitude scaling', () => {
  it('scales units_removed and reports the multiplier', () => {
    const state = eraState(2, {
      phase: 'attack',
      territories: { a: makeTerritory('p1', 3), b: makeTerritory('p1', 2) },
    });
    const r = applyEventEffect(state, { type: 'units_removed', target: 'player', value: 2 }, false);
    // ×2 → remove up to 4: a 3→1 (−2), b 2→1 (−1); 1 short (min-1 floor).
    expect(state.territories.a.unit_count).toBe(1);
    expect(state.territories.b.unit_count).toBe(1);
    expect(r.magnitude_scale).toBe(2);
  });

  it('scales region_disaster magnitude', () => {
    const state = eraState(4, {
      phase: 'attack',
      territories: { a: makeTerritory('p1', 5), b: makeTerritory('p2', 2) },
    });
    const r = applyEventEffect(state, { type: 'region_disaster', target: 'region', value: 1 }, false);
    // ×3 → remove up to 3: a 5→2, b 2→1 (min-1 floor).
    expect(state.territories.a.unit_count).toBe(2);
    expect(state.territories.b.unit_count).toBe(1);
    expect(r.magnitude_scale).toBe(3);
  });

  it('does NOT scale stability_change (no magnitude_scale reported)', () => {
    const state = eraState(4);
    const r = applyEventEffect(state, { type: 'stability_change', target: 'player', value: 15 }, false);
    expect(r.magnitude_scale).toBeUndefined();
  });

  it('does NOT scale dice modifiers', () => {
    const state = eraState(4, { phase: 'attack' });
    applyEventEffect(state, { type: 'attack_modifier', target: 'player', value: 1, duration_turns: 2 }, false);
    expect(state.players[0].temporary_modifiers?.[0]?.value).toBe(1);
  });
});

describe('getDisplayScaledCard', () => {
  const instantCard: EventCard = {
    card_id: 'c1', title: 'Raid', description: 'Lose 2 units.',
    category: 'player_targeted', era_id: 'ancient',
    effect: { type: 'units_removed', target: 'player', value: 2 },
  };

  it('scales the broadcast effect value and stamps magnitude_scale', () => {
    const out = getDisplayScaledCard(eraState(2), instantCard);
    expect(out.effect?.value).toBe(4);
    expect(out.magnitude_scale).toBe(2);
  });

  it('never mutates the shared deck constant', () => {
    getDisplayScaledCard(eraState(2), instantCard);
    expect(instantCard.effect?.value).toBe(2); // untouched
  });

  it('scales only the scalable choice and leaves dice choices alone', () => {
    const choiceCard: EventCard = {
      card_id: 'c2', title: 'Reform', description: 'Choose.',
      category: 'player_targeted', era_id: 'ancient',
      choices: [
        { choice_id: 'def', label: 'Defense', effect: { type: 'defense_modifier', target: 'player', value: 2, duration_turns: 2 } },
        { choice_id: 'units', label: 'Units', effect: { type: 'units_added', target: 'player', value: 2 } },
      ],
    };
    const out = getDisplayScaledCard(eraState(2), choiceCard);
    expect(out.choices?.find((c) => c.choice_id === 'units')?.effect.value).toBe(4);
    expect(out.choices?.find((c) => c.choice_id === 'def')?.effect.value).toBe(2);
    expect(out.magnitude_scale).toBe(2);
  });

  it('returns an unscaled clone (no badge) at level 0', () => {
    const out = getDisplayScaledCard(baseState({ turn_number: 1 }), instantCard);
    expect(out.magnitude_scale).toBeUndefined();
    expect(out.effect?.value).toBe(2);
    expect(out).not.toBe(instantCard);
  });
});
