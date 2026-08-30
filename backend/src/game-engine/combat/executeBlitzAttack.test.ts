import { describe, it, expect } from 'vitest';
import type { GameState } from '../../types';
import { executeBlitzAttack, BLITZ_MAX_EXCHANGES } from './executeBlitzAttack';

const ATT = 'p_att';
const DEF = 'p_def';

function stateWith(attackers: number, defenders: number): GameState {
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'blitz_fixture',
    phase: 'attack',
    turn_number: 4,
    current_player_index: 0,
    players: [
      { player_id: ATT, player_index: 0, username: 'Att', color: '#000', is_ai: false, is_eliminated: false, territory_count: 5, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: DEF, player_index: 1, username: 'Def', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 5, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: {
      a: { territory_id: 'a', owner_id: ATT, unit_count: attackers },
      b: { territory_id: 'b', owner_id: DEF, unit_count: defenders },
    },
    settings: {},
    era_modifiers: {},
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

/**
 * Deterministic die: one side rolls all 6s, the other all 1s. State is only
 * mutated after an exchange's rolls complete, so the dice counts for the next
 * exchange can be re-read from live state at each exchange boundary.
 */
function scriptedDie(
  state: GameState,
  attackerWins: boolean,
  extraAttackerDiceFirstExchange = 0,
): () => number {
  let remainingA = 0;
  let remainingD = 0;
  let exchange = 0;
  return () => {
    if (remainingA === 0 && remainingD === 0) {
      const a = state.territories.a.unit_count;
      const d = state.territories.b.unit_count;
      remainingA = Math.min(a - 1, 3) + (exchange === 0 ? extraAttackerDiceFirstExchange : 0);
      remainingD = Math.min(d, 2);
      exchange += 1;
    }
    if (remainingA > 0) {
      remainingA--;
      return attackerWins ? 6 : 1;
    }
    remainingD--;
    return attackerWins ? 1 : 6;
  };
}

describe('executeBlitzAttack', () => {
  it('presses to capture: 8v5 with winning dice takes three exchanges', () => {
    const state = stateWith(8, 5);
    const blitz = executeBlitzAttack(state, ATT, 'a', 'b', { dieRoll: scriptedDie(state, true) });
    expect(blitz).not.toBeNull();
    // Each exchange kills min(defenders, 2): 2 + 2 + 1.
    expect(blitz!.captured).toBe(true);
    expect(blitz!.stop).toBe('captured');
    expect(blitz!.exchanges).toHaveLength(3);
    expect(blitz!.result.blitz_exchanges).toBe(3);
    expect(blitz!.result.territory_captured).toBe(true);
    expect(blitz!.result.defender_losses).toBe(5);
    expect(blitz!.result.attacker_losses).toBe(0);
    expect(state.territories.b.owner_id).toBe(ATT);
  });

  it('stops on exhaustion: a 3-stack against losing dice cannot continue', () => {
    const state = stateWith(3, 10);
    const blitz = executeBlitzAttack(state, ATT, 'a', 'b', { dieRoll: scriptedDie(state, false) });
    expect(blitz).not.toBeNull();
    // One exchange: 2 attacker dice both lose → 1 unit left, below the floor.
    expect(blitz!.captured).toBe(false);
    expect(blitz!.stop).toBe('exhausted');
    expect(blitz!.exchanges).toHaveLength(1);
    expect(state.territories.a.unit_count).toBe(1);
    expect(state.territories.b.owner_id).toBe(DEF);
  });

  it('the hard cap bounds a pathological stack-vs-stack fight', () => {
    // The attacker loses every comparison but has units to burn for 74
    // exchanges; the loop must stop at the defensive ceiling instead.
    const state = stateWith(150, 3);
    const blitz = executeBlitzAttack(state, ATT, 'a', 'b', { dieRoll: scriptedDie(state, false) });
    expect(blitz).not.toBeNull();
    expect(blitz!.stop).toBe('cap');
    expect(blitz!.exchanges).toHaveLength(BLITZ_MAX_EXCHANGES);
    expect(blitz!.result.blitz_exchanges).toBe(BLITZ_MAX_EXCHANGES);
  });

  it('returns null when the first exchange is structurally invalid', () => {
    const state = stateWith(1, 5); // below the 2-unit attack floor
    expect(executeBlitzAttack(state, ATT, 'a', 'b', { dieRoll: scriptedDie(state, true) })).toBeNull();
  });

  it('aggregates per-exchange losses and exposes the roll breakdown', () => {
    const state = stateWith(6, 6);
    const blitz = executeBlitzAttack(state, ATT, 'a', 'b', { dieRoll: scriptedDie(state, true) });
    expect(blitz).not.toBeNull();
    const rolls = blitz!.result.blitz_rolls!;
    expect(rolls).toHaveLength(blitz!.exchanges.length);
    const attTotal = rolls.reduce((s, r) => s + r.attacker_losses, 0);
    const defTotal = rolls.reduce((s, r) => s + r.defender_losses, 0);
    expect(blitz!.result.attacker_losses).toBe(attTotal);
    expect(blitz!.result.defender_losses).toBe(defTotal);
  });

  it('routes one-shot bonuses to the first exchange only', () => {
    const state = stateWith(8, 5);
    const seenIndices: number[] = [];
    const blitz = executeBlitzAttack(state, ATT, 'a', 'b', {
      // The die must roll the bonus's 4th attacker die on exchange 0 to stay
      // in sync with resolveCombat's roll order.
      dieRoll: scriptedDie(state, true, 1),
      extraAttackBonuses: (i) => {
        seenIndices.push(i);
        return { one_shot: i === 0 ? 1 : 0 };
      },
    });
    expect(blitz).not.toBeNull();
    expect(seenIndices).toEqual([0, 1, 2]);
    // The first exchange's breakdown carries the bonus; later ones do not.
    expect(blitz!.exchanges[0].result.attacker_bonus_breakdown?.total).toBe(1);
    expect(blitz!.exchanges[1].result.attacker_bonus_breakdown?.total ?? 0).toBe(0);
  });

  it('fires onExchangeResolved once per exchange, in order', () => {
    const state = stateWith(8, 5);
    const resolved: number[] = [];
    executeBlitzAttack(state, ATT, 'a', 'b', {
      dieRoll: scriptedDie(state, true),
      onExchangeResolved: (_outcome, i) => resolved.push(i),
    });
    expect(resolved).toEqual([0, 1, 2]);
  });
});
