import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import { dailyBuildFocus, enemyBordersPlayer, goalChain, unavailableBuildings } from './dailyBuildFocus';

// home — coast — far — enemy: the AI sits two empty neutrals away from the
// viewer, as Japan sits from the USA on the WWII economy day.
const CONNS = [
  { from: 'home', to: 'coast' },
  { from: 'coast', to: 'far' },
  { from: 'far', to: 'enemy' },
];

function state(opts: { settings?: Record<string, unknown>; enemyAtCoast?: boolean } = {}): GameState {
  return {
    settings: { economy_enabled: true, ...opts.settings },
    territories: {
      home: { owner_id: 'me', unit_count: 5 },
      coast: opts.enemyAtCoast ? { owner_id: 'ai', unit_count: 6 } : { owner_id: null, unit_count: 0 },
      far: { owner_id: null, unit_count: 0 },
      enemy: { owner_id: 'ai', unit_count: 7 },
    },
    players: [],
  } as unknown as GameState;
}

const ECONOMY_DAY = { archetype: 'economy_build', building_type: 'production_2', clear_board: true };
const TECH_DAY = { archetype: 'tech_research', tech_id: 'ww2_radio', clear_board: true };

describe('goalChain', () => {
  it('lists the tiers beneath the goal, the goal last', () => {
    expect(goalChain('production_2')).toEqual(['production_1', 'production_2']);
    expect(goalChain('production_1')).toEqual(['production_1']);
    expect(goalChain('tech_gen_2')).toEqual(['tech_gen_1', 'tech_gen_2']);
  });

  it('leaves a building outside every chain on its own', () => {
    expect(goalChain('port')).toEqual(['port']);
  });
});

describe('dailyBuildFocus', () => {
  it('names the plan on a build day, in the panel\'s own words, and counts only its tiers', () => {
    const focus = dailyBuildFocus(state({ settings: { daily_challenge_spec: ECONOMY_DAY } }).settings);
    expect(focus?.note).toBe("Today's goal: Workshop (I), then Foundry (II) on top of it. Nothing else counts toward it.");
    expect(focus?.countsToward).toEqual(['production_1', 'production_2']);
  });

  it('counts the research buildings on a tech day', () => {
    const focus = dailyBuildFocus(state({ settings: { daily_challenge_spec: TECH_DAY } }).settings);
    expect(focus?.note).toMatch(/^Today's goal is research/);
    expect(focus?.countsToward).toEqual(['tech_gen_1', 'tech_gen_2']);
  });

  it('says nothing on a capture or domination day, or outside the daily', () => {
    expect(dailyBuildFocus(state({ settings: { daily_challenge_spec: { archetype: 'military_capture' } } }).settings)).toBeNull();
    expect(dailyBuildFocus(state({ settings: { daily_challenge_spec: { archetype: 'domination' } } }).settings)).toBeNull();
    expect(dailyBuildFocus(state().settings)).toBeNull();
    expect(dailyBuildFocus(undefined)).toBeNull();
  });
});

describe('enemyBordersPlayer', () => {
  it('is false when the only enemy is two empty neutrals away', () => {
    expect(enemyBordersPlayer(state(), CONNS, 'me')).toBe(false);
  });

  it('is true when the enemy holds a bordering territory', () => {
    expect(enemyBordersPlayer(state({ enemyAtCoast: true }), CONNS, 'me')).toBe(true);
  });

  it('is false for a viewer who holds nothing', () => {
    expect(enemyBordersPlayer(state({ enemyAtCoast: true }), CONNS, 'nobody')).toBe(false);
    expect(enemyBordersPlayer(state({ enemyAtCoast: true }), CONNS, null)).toBe(false);
  });
});

describe('unavailableBuildings', () => {
  it('marks the tech buildings when tech trees are off', () => {
    const out = unavailableBuildings(state(), CONNS, 'me');
    expect(out.tech_gen_1).toMatch(/No tech trees/);
    expect(out.tech_gen_2).toMatch(/No tech trees/);
    expect(out.defense_1).toBeUndefined();
  });

  it('leaves the tech buildings alone with tech trees on, or with factions on', () => {
    expect(unavailableBuildings(state({ settings: { tech_trees_enabled: true } }), CONNS, 'me').tech_gen_1).toBeUndefined();
    // The Space Age's industrial faction is paid production per tech building.
    expect(unavailableBuildings(state({ settings: { factions_enabled: true } }), CONNS, 'me').tech_gen_1).toBeUndefined();
  });

  it('marks defence on a cleared build day where nothing can reach the player', () => {
    const out = unavailableBuildings(state({ settings: { daily_challenge_spec: ECONOMY_DAY } }), CONNS, 'me');
    expect(out.defense_1).toMatch(/Nothing can reach/);
    expect(out.defense_2).toMatch(/Nothing can reach/);
    expect(out.coastal_battery).toMatch(/Nothing can reach/);
    expect(out.production_1).toBeUndefined();
  });

  it('keeps defence live when an enemy borders the player, on a day whose board was not cleared, or on a capture day', () => {
    expect(
      unavailableBuildings(state({ settings: { daily_challenge_spec: ECONOMY_DAY }, enemyAtCoast: true }), CONNS, 'me').defense_1,
    ).toBeUndefined();
    expect(
      unavailableBuildings(state({ settings: { daily_challenge_spec: { ...ECONOMY_DAY, clear_board: false } } }), CONNS, 'me').defense_1,
    ).toBeUndefined();
    expect(
      unavailableBuildings(state({ settings: { daily_challenge_spec: { archetype: 'military_capture', clear_board: true } } }), CONNS, 'me').defense_1,
    ).toBeUndefined();
    expect(unavailableBuildings(state(), CONNS, 'me').defense_1).toBeUndefined();
  });
});
