import { describe, it, expect } from 'vitest';
import type { AuthoredScenario, GameState } from '../../types';
import { applyAuthoredScenario } from './applyAuthoredScenario';
import { normalizeGameSettings } from '../state/gameSettings';

const HUMAN = 'human-1';
const AI = 'ai-1';

function stateWith(territories: Record<string, { owner_id: string | null; unit_count: number }>): GameState {
  return {
    players: [
      { player_id: HUMAN, is_ai: false, is_eliminated: false, territory_count: 0, tech_points: 0, special_resource: 0 },
      { player_id: AI, is_ai: true, is_eliminated: false, territory_count: 0, tech_points: 0, special_resource: 0 },
    ],
    territories: Object.fromEntries(
      Object.entries(territories).map(([id, t]) => [id, { territory_id: id, unit_type: 'infantry', ...t }]),
    ),
  } as unknown as GameState;
}

describe('applyAuthoredScenario', () => {
  it('does nothing when no scenario is configured', () => {
    const state = stateWith({ a: { owner_id: AI, unit_count: 4 } });
    applyAuthoredScenario(state, undefined, HUMAN, AI);
    expect(state.territories.a).toMatchObject({ owner_id: AI, unit_count: 4 });
  });

  it('resolves seat labels to the real player ids', () => {
    const state = stateWith({ a: { owner_id: null, unit_count: 0 }, b: { owner_id: null, unit_count: 0 } });
    const scenario: AuthoredScenario = {
      starting_board: {
        a: { owner: 'human', unit_count: 5 },
        b: { owner: 'ai', unit_count: 2 },
      },
    };
    applyAuthoredScenario(state, scenario, HUMAN, AI);
    expect(state.territories.a).toMatchObject({ owner_id: HUMAN, unit_count: 5 });
    expect(state.territories.b).toMatchObject({ owner_id: AI, unit_count: 2 });
  });

  it('leaves territories the scenario does not name exactly as dealt', () => {
    const state = stateWith({
      shaped: { owner_id: null, unit_count: 0 },
      untouched: { owner_id: AI, unit_count: 7 },
    });
    applyAuthoredScenario(state, { starting_board: { shaped: { owner: 'human', unit_count: 3 } } }, HUMAN, AI);
    expect(state.territories.untouched).toMatchObject({ owner_id: AI, unit_count: 7 });
  });

  it('clear_board wipes the map before applying the authored positions', () => {
    const state = stateWith({
      a: { owner_id: AI, unit_count: 9 },
      b: { owner_id: HUMAN, unit_count: 9 },
    });
    applyAuthoredScenario(
      state,
      { clear_board: true, starting_board: { a: { owner: 'human', unit_count: 2 } } },
      HUMAN,
      AI,
    );
    expect(state.territories.a).toMatchObject({ owner_id: HUMAN, unit_count: 2 });
    expect(state.territories.b).toMatchObject({ owner_id: null, unit_count: 0 });
  });

  it('recomputes territory counts so the HUD and victory checks agree', () => {
    const state = stateWith({ a: { owner_id: null, unit_count: 0 }, b: { owner_id: null, unit_count: 0 } });
    applyAuthoredScenario(
      state,
      { starting_board: { a: { owner: 'human', unit_count: 3 }, b: { owner: 'ai', unit_count: 3 } } },
      HUMAN,
      AI,
    );
    expect(state.players.find((p) => p.player_id === HUMAN)?.territory_count).toBe(1);
    expect(state.players.find((p) => p.player_id === AI)?.territory_count).toBe(1);
  });

  it('never leaves an owned territory empty, and never garrisons a neutral one', () => {
    const state = stateWith({ a: { owner_id: null, unit_count: 0 }, b: { owner_id: AI, unit_count: 5 } });
    applyAuthoredScenario(
      state,
      { starting_board: { a: { owner: 'human', unit_count: 0 }, b: { owner: null, unit_count: 4 } } },
      HUMAN,
      AI,
    );
    expect(state.territories.a).toMatchObject({ owner_id: HUMAN, unit_count: 1 });
    expect(state.territories.b).toMatchObject({ owner_id: null, unit_count: 0 });
  });

  it('skips territories the map no longer has instead of throwing', () => {
    const state = stateWith({ a: { owner_id: null, unit_count: 0 } });
    expect(() =>
      applyAuthoredScenario(
        state,
        { starting_board: { removed_since_authoring: { owner: 'human', unit_count: 3 } } },
        HUMAN,
        AI,
      ),
    ).not.toThrow();
    expect(state.territories.a).toMatchObject({ owner_id: null });
  });

  it('grants raise resources to a floor without lowering what the seat already has', () => {
    const state = stateWith({ a: { owner_id: HUMAN, unit_count: 1 } });
    const human = state.players.find((p) => p.player_id === HUMAN)!;
    human.tech_points = 30;
    human.special_resource = 5;
    applyAuthoredScenario(state, { grants: { tech_points: 24, gold: 60 } }, HUMAN, AI);
    expect(human.tech_points).toBe(30); // already higher — untouched
    expect(human.special_resource).toBe(60); // raised to the floor
  });

  it('survives settings normalization, which runs on every room load', () => {
    // A key missing from the extension whitelist is silently stripped here, so
    // the board would shape on a fresh start and revert on the next reload.
    const scenario: AuthoredScenario = { starting_board: { a: { owner: 'human', unit_count: 3 } } };
    const normalized = normalizeGameSettings({ authored_scenario: scenario } as never);
    expect(normalized.authored_scenario).toEqual(scenario);
  });
});
