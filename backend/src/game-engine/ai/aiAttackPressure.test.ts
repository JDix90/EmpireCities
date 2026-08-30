import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { computeAiTurn } from './aiBot';
import { executeLandAttack } from '../combat/executeLandAttack';
import { AI_ATTACK_EXCHANGE_BUDGET, runAiAttackExchanges, shouldContinueGrind } from './aiAttackGrind';

/**
 * The AI's per-turn attack budget counts DISTINCT EDGES, but a capture needs
 * repeated DICE EXCHANGES on one edge.
 *
 * `resolveCombat` rolls `min(defendingUnits, 2)` defender dice and compares
 * `min(attackerDice, defenderDice)` pairs, so one exchange removes at most two
 * defenders — and `territory_captured` requires `defenderLosses >= defendingUnits`.
 * `executeLandAttack` performs exactly one exchange, and `selectAttacks`
 * enumerates each (from, to) edge once and emits each candidate once.
 *
 * Composed, those give a hard result: the AI cannot take a territory holding
 * three or more units, at any difficulty, on any map. Not "rarely" — never.
 */

const AI = 'ai_1';
const HUMAN = 'p1';

function twoTerritoryMap(): GameMap {
  return {
    map_id: 'grind_fixture',
    name: 'Grind Fixture',
    territories: [
      { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'b', name: 'B', polygon: [], center_point: [0, 0], region_id: 'r' },
    ],
    connections: [{ from: 'a', to: 'b', type: 'land' }],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

/** AI holds `a` with a big stack; the human holds `b` with `garrison`. */
function stateWith(garrison: number, aiUnits = 20): GameState {
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'grind_fixture',
    phase: 'attack',
    turn_number: 4,
    current_player_index: 0,
    players: [
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, is_eliminated: false, territory_count: 1, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: HUMAN, player_index: 1, username: 'P', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 1, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: {
      a: { territory_id: 'a', owner_id: AI, unit_count: aiUnits },
      b: { territory_id: 'b', owner_id: HUMAN, unit_count: garrison },
    },
    settings: {},
    era_modifiers: {},
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

/**
 * Plan one AI turn and run it through the same exchange loop `processAiTurn`
 * uses, with the best dice the game allows: `resolveCombat` rolls all attacker
 * dice then all defender dice, so this hands the attacker 6s and the defender
 * 1s every time. Whatever the AI fails to take here, it cannot take at all.
 *
 * Returns whether `b` changed hands and how many exchanges that cost.
 */
async function runAiAttackTurn(
  garrison: number,
  difficulty: AiDifficulty,
  { canGrind = true }: { canGrind?: boolean } = {},
): Promise<{ captured: boolean; exchanges: number }> {
  const map = twoTerritoryMap();
  const state = stateWith(garrison);
  const budget = { left: canGrind ? AI_ATTACK_EXCHANGE_BUDGET[difficulty] : Number.POSITIVE_INFINITY };
  let exchanges = 0;

  for (const action of computeAiTurn(state, map, difficulty)) {
    if (action.type !== 'attack' || !action.from || !action.to) continue;
    const fromId = action.from;
    const toId = action.to;
    await runAiAttackExchanges({
      state,
      attackerId: AI,
      fromId,
      toId,
      budget,
      canGrind,
      exchange: () => {
        const attackerDice = Math.min(state.territories[fromId].unit_count - 1, 3);
        let call = 0;
        const dieRoll = () => (call++ < attackerDice ? 6 : 1);
        const outcome = executeLandAttack(state, AI, fromId, toId, { dieRoll });
        exchanges += 1;
        return outcome ? 'ok' : 'stop';
      },
    });
    if (budget.left <= 0) break;
  }
  return { captured: state.territories.b.owner_id === AI, exchanges };
}

describe('AI attack pressure', () => {
  it('takes a 1-unit garrison', async () => {
    expect((await runAiAttackTurn(1, 'medium')).captured).toBe(true);
  });

  it('takes a 2-unit garrison in one exchange', async () => {
    // Two defenders, two comparisons, both won — the most a single exchange can do.
    const { captured, exchanges } = await runAiAttackTurn(2, 'medium');
    expect(captured).toBe(true);
    expect(exchanges).toBe(1);
  });

  it('takes a 3-unit garrison, which one exchange can never do', async () => {
    // The boundary the whole change exists for. One exchange kills at most two
    // of three, so while the budget counted distinct edges this was false at
    // EVERY difficulty — not unlikely, impossible.
    for (const difficulty of ['medium', 'hard', 'expert'] as AiDifficulty[]) {
      const { captured, exchanges } = await runAiAttackTurn(3, difficulty);
      expect(captured, `${difficulty} could not take a 3-unit garrison`).toBe(true);
      expect(exchanges).toBeGreaterThan(1);
    }
  });

  it('takes a 5-unit garrison when the budget stretches that far', async () => {
    expect((await runAiAttackTurn(5, 'hard')).captured).toBe(true);
  });

  it('still cannot take a 3-unit garrison with grinding off', async () => {
    // The kill switch restores exactly the old behaviour.
    const { captured, exchanges } = await runAiAttackTurn(3, 'medium', { canGrind: false });
    expect(captured).toBe(false);
    expect(exchanges).toBe(1);
  });

  it('never spends more exchanges than the difficulty allows', async () => {
    // A 40-unit garrison can't be taken by anyone here; the loop must still stop.
    for (const difficulty of ['easy', 'medium', 'hard'] as AiDifficulty[]) {
      const { exchanges } = await runAiAttackTurn(40, difficulty);
      expect(exchanges).toBeLessThanOrEqual(AI_ATTACK_EXCHANGE_BUDGET[difficulty]);
    }
  });
});

describe('shouldContinueGrind', () => {
  const state = () => stateWith(3);

  it('stops once the target has changed hands', () => {
    const s = state();
    s.territories.b.owner_id = AI;
    expect(shouldContinueGrind(s, AI, 'a', 'b', 5)).toBe('captured');
  });

  it('stops when the budget is gone', () => {
    expect(shouldContinueGrind(state(), AI, 'a', 'b', 0)).toBe('budget_spent');
  });

  it('stops when the source can no longer attack', () => {
    const s = state();
    s.territories.a.unit_count = 1;
    expect(shouldContinueGrind(s, AI, 'a', 'b', 5)).toBe('source_drained');
  });

  it('stops rather than feed a stack into a fight it is losing', () => {
    // Without this the AI acquires easy's suicide behaviour: grinding a shrinking
    // stack into a garrison it can no longer take, one exchange at a time.
    const s = state();
    s.territories.a.unit_count = 3;
    s.territories.b.unit_count = 3;
    expect(shouldContinueGrind(s, AI, 'a', 'b', 5)).toBe('no_material_edge');
  });

  it('keeps going while ahead on material with budget left', () => {
    expect(shouldContinueGrind(state(), AI, 'a', 'b', 5)).toBe('ok');
  });
});
