import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { computeAiTurn } from './aiBot';

/**
 * Odds-aware attack targeting (ai_capture_odds_enabled).
 *
 * The legacy favorability term was the saturating (attackDice - defDice): any
 * stack of 4+ units scored +1 against ANY garrison, however hopeless the fight,
 * and no dice modifier — buildings, tech, factions, wonders, era gaps — moved
 * the score at all. The odds-aware term is the exact assault capture
 * probability with the real modifiers folded in, scaled into the same [-1, 2]
 * range so the strategic bonuses keep their relative weight.
 *
 * These tests pin the two behaviors that must hold and one that must NOT
 * appear: modifiers steer target choice, hopeless fights are declined (no
 * hyper-aggression from weak stacks — the regression the plan warned about),
 * and the kill switch restores the legacy choice exactly.
 */

const AI = 'ai_1';
const HUMAN = 'p1';

function twoTerritoryMap(): GameMap {
  return {
    map_id: 'odds_fixture',
    name: 'Odds Fixture',
    territories: [
      { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'b', name: 'B', polygon: [], center_point: [0, 0], region_id: 'r' },
    ],
    connections: [{ from: 'a', to: 'b', type: 'land' }],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function stateWith(opts: {
  aiUnits: number;
  garrison: number;
  garrisonBuildings?: string[];
  economyEnabled?: boolean;
}): GameState {
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'odds_fixture',
    phase: 'attack',
    turn_number: 4,
    current_player_index: 0,
    players: [
      // territory_count 6 on both sides keeps the finisher bonus at zero so
      // these tests isolate the favorability term.
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, is_eliminated: false, territory_count: 6, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: HUMAN, player_index: 1, username: 'P', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 6, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: {
      a: { territory_id: 'a', owner_id: AI, unit_count: opts.aiUnits },
      b: {
        territory_id: 'b',
        owner_id: HUMAN,
        unit_count: opts.garrison,
        buildings: opts.garrisonBuildings ?? [],
      },
    },
    settings: { economy_enabled: opts.economyEnabled ?? false },
    era_modifiers: {},
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

function plansAttack(state: GameState, captureOddsScoring: boolean): boolean {
  const actions = computeAiTurn(state, twoTerritoryMap(), 'medium', { captureOddsScoring });
  return actions.some((a) => a.type === 'attack' && a.to === 'b');
}

describe('odds-aware attack targeting', () => {
  it('declines a hopeless fight the legacy term would take (4 units vs a 10-garrison)', () => {
    // Legacy: 3 attack dice - 2 defender dice = +1, always past the threshold.
    // Odds: P(capture) is a few percent, favorability ~ -0.9 — declined.
    const board = () => stateWith({ aiUnits: 4, garrison: 10 });
    expect(plansAttack(board(), false)).toBe(true);
    expect(plansAttack(board(), true)).toBe(false);
  });

  it('still presses a clearly winnable fight (20 units vs a 3-garrison)', () => {
    expect(plansAttack(stateWith({ aiUnits: 20, garrison: 3 }), true)).toBe(true);
  });

  it('sees a defense building the legacy term was blind to', () => {
    // 10v5 without the fortress is a strong attack; with defense_3 the
    // defender rolls 5 dice against 3 and the assault is a trap. The legacy
    // term scores both boards identically (+1) — the odds term must split them.
    const open = stateWith({ aiUnits: 10, garrison: 5, economyEnabled: true });
    const fortress = stateWith({
      aiUnits: 10,
      garrison: 5,
      garrisonBuildings: ['defense_3'],
      economyEnabled: true,
    });
    expect(plansAttack(open, true)).toBe(true);
    expect(plansAttack(fortress, true)).toBe(false);
    // Kill switch: the legacy term attacks the fortress it cannot read.
    expect(plansAttack(fortress, false)).toBe(true);
  });
});
