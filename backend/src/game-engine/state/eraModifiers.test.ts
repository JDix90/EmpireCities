import { describe, expect, it } from 'vitest';
import { getPlayerEraModifiers, eraModifiersFor } from './eraModifiers';
import { getFortifyMoveLimit, getPrecisionStrikeMinUnits } from '../abilities/techAbilities';
import { getSpineById } from '../eraAdvancement/spines';
import type { GameState } from '../../types';

/**
 * Advancing an era used to change nothing about the rules you played under.
 * `era_modifiers` was written once, at game creation, from the game's STARTING
 * era — so a player who climbed Ancient → Modern kept the Ancient legionary
 * re-roll and never received the Modern precision strike.
 */
function state(opts: {
  advancement: boolean;
  startEra?: GameState['era'];
  eras?: number[];
}): GameState {
  const spine = getSpineById('classic').steps;
  return {
    era: opts.startEra ?? 'ancient',
    era_spine: spine,
    era_modifiers: eraModifiersFor(opts.startEra ?? 'ancient'),
    settings: {
      era_advancement_enabled: opts.advancement,
      era_advancement_spine_id: 'classic',
      tech_trees_enabled: false,
    },
    players: (opts.eras ?? [0]).map((idx, i) => ({
      player_id: `p${i}`,
      player_index: i,
      username: `P${i}`,
      is_ai: false,
      is_eliminated: false,
      current_era_index: idx,
      unlocked_techs: [],
    })),
    territories: {},
  } as unknown as GameState;
}

describe('era modifiers follow the player, not the game', () => {
  it('gives a climbing player their own era doctrine', () => {
    // classic spine: 0 ancient · 3 ww2 · 5 modern
    const s = state({ advancement: true, eras: [0, 3, 5] });
    expect(getPlayerEraModifiers(s, 'p0')).toEqual({ legion_reroll: true });
    expect(getPlayerEraModifiers(s, 'p1')).toEqual({ wartime_logistics: true });
    expect(getPlayerEraModifiers(s, 'p2')).toEqual({ precision_strike: true });
  });

  it('lets two players in one match fight under different rules', () => {
    const s = state({ advancement: true, eras: [0, 5] });
    const behind = getPlayerEraModifiers(s, 'p0');
    const ahead = getPlayerEraModifiers(s, 'p1');
    expect(behind.legion_reroll).toBe(true);
    expect(behind.precision_strike).toBeUndefined();
    expect(ahead.precision_strike).toBe(true);
    // Doctrine swaps, it does not accumulate — what carries forward between
    // eras is the tech echo, which is modelled separately and decays.
    expect(ahead.legion_reroll).toBeUndefined();
  });

  it('changes nothing at all when advancement is off', () => {
    // Quick Match — the default game — runs with advancement off, so this path
    // must stay byte-identical to the old game-level behaviour.
    const s = state({ advancement: false, startEra: 'coldwar', eras: [0, 0] });
    expect(getPlayerEraModifiers(s, 'p0')).toEqual(s.era_modifiers);
    expect(getPlayerEraModifiers(s, 'p1')).toEqual(s.era_modifiers);
    expect(getPlayerEraModifiers(s, null)).toEqual(s.era_modifiers);
  });

  it('falls back to the game era for an unknown or absent player', () => {
    const s = state({ advancement: true, eras: [0] });
    expect(getPlayerEraModifiers(s, 'nobody')).toEqual(s.era_modifiers);
    expect(getPlayerEraModifiers(s, undefined)).toEqual(s.era_modifiers);
  });

  it('hands back a copy, so a caller cannot poison the table', () => {
    const s = state({ advancement: true, eras: [0] });
    const mods = getPlayerEraModifiers(s, 'p0');
    mods.legion_reroll = false;
    expect(getPlayerEraModifiers(s, 'p0').legion_reroll).toBe(true);
  });
});

describe('the rules that read them follow too', () => {
  it('grants the WW2 second fortify move to the player who reached WW2', () => {
    const s = state({ advancement: true, eras: [0, 3] });
    expect(getFortifyMoveLimit(s, 'p0')).toBe(1);
    expect(getFortifyMoveLimit(s, 'p1')).toBe(2);
  });

  it('opens the Modern precision strike only to the player who reached Modern', () => {
    const s = state({ advancement: true, eras: [0, 5] });
    expect(getPrecisionStrikeMinUnits(s, 'p0')).toBe(Infinity);
    expect(getPrecisionStrikeMinUnits(s, 'p1')).toBe(4);
  });

  it('leaves both alone in a game that does not climb', () => {
    const s = state({ advancement: false, startEra: 'ww2', eras: [0, 0] });
    expect(getFortifyMoveLimit(s, 'p0')).toBe(2);
    expect(getFortifyMoveLimit(s, 'p1')).toBe(2);
  });
});
