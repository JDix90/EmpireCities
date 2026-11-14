/**
 * The suggested first attack (first_attack_hint_enabled): one attack the panel
 * itself offers, a fair fight to start with, and a tip and ring that follow
 * the panel as the player opens either end of it.
 */
import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import { firstAttackOpen, firstAttackRingId, firstAttackTipText, suggestFirstAttack } from './firstAttackHint';

type T = { owner: string; units: number; fleets?: number };

function game(territories: Record<string, T>, extra: Partial<GameState> = {}): GameState {
  return {
    phase: 'attack',
    settings: {},
    territories: Object.fromEntries(Object.entries(territories).map(([id, t]) => [
      id, { territory_id: id, owner_id: t.owner, unit_count: t.units, naval_units: t.fleets ?? 0 },
    ])),
    players: [
      { player_id: 'me', username: 'Me', color: '#f00', player_index: 0, is_ai: false },
      { player_id: 'ai', username: 'Tamsin', color: '#00f', player_index: 1, is_ai: true },
      { player_id: 'ai2', username: 'Rashid', color: '#0f0', player_index: 2, is_ai: true },
    ],
    ...extra,
  } as unknown as GameState;
}

const names = new Map([
  ['strathclyde', 'Strathclyde'], ['alba', 'Kingdom of Alba'], ['jorvik', 'Jórvík'],
  ['wessex', 'Wessex'], ['kent', 'Kent'], ['cornwall', 'Cornwall'],
]);
const land = (from: string, to: string) => ({ from, to, type: 'land' as const });

describe('suggestFirstAttack', () => {
  it('picks the attack with the biggest edge, from the stack that can make it', () => {
    const g = game({
      strathclyde: { owner: 'me', units: 6 },
      wessex: { owner: 'me', units: 4 },
      alba: { owner: 'ai', units: 5 },
      jorvik: { owner: 'ai', units: 3 },
      kent: { owner: 'ai', units: 2 },
    });
    const hint = suggestFirstAttack(g, [land('strathclyde', 'alba'), land('strathclyde', 'jorvik'), land('wessex', 'kent')], 'me', names);
    // 6 v 3 (edge 3) beats 4 v 2 (edge 2) and 6 v 5 (edge 1).
    expect(hint).toEqual({
      fromId: 'strathclyde', fromName: 'Strathclyde', fromUnits: 6,
      toId: 'jorvik', toName: 'Jórvík', toUnits: 3,
    });
  });

  it('breaks a tie on edge by the bigger stack, then the weaker target, then by name', () => {
    const conns = [land('strathclyde', 'alba'), land('wessex', 'kent')];
    // 5 v 3 and 4 v 2: same edge, the bigger stack leads.
    expect(suggestFirstAttack(game({
      strathclyde: { owner: 'me', units: 5 }, alba: { owner: 'ai', units: 3 },
      wessex: { owner: 'me', units: 4 }, kent: { owner: 'ai', units: 2 },
    }), conns, 'me', names)?.fromId).toBe('strathclyde');
    // Identical fights: by name, so the choice is the same on every render.
    expect(suggestFirstAttack(game({
      strathclyde: { owner: 'me', units: 4 }, alba: { owner: 'ai', units: 2 },
      wessex: { owner: 'me', units: 4 }, kent: { owner: 'ai', units: 2 },
    }), conns, 'me', names)?.fromId).toBe('strathclyde');
  });

  it('suggests only a fight the attacker outnumbers, and nothing from a stack of one', () => {
    const conns = [land('strathclyde', 'alba'), land('wessex', 'kent')];
    expect(suggestFirstAttack(game({
      strathclyde: { owner: 'me', units: 3 }, alba: { owner: 'ai', units: 3 },
      wessex: { owner: 'me', units: 1 }, kent: { owner: 'ai', units: 0 },
    }), conns, 'me', names)).toBeNull();
  });

  it('never suggests a sea crossing without a fleet, a truce partner, or a hidden garrison', () => {
    const conns = [{ from: 'cornwall', to: 'kent', type: 'sea' as const }, land('wessex', 'alba'), land('wessex', 'jorvik')];
    const g = game(
      {
        cornwall: { owner: 'me', units: 9 }, kent: { owner: 'ai', units: 1 },
        wessex: { owner: 'me', units: 6 }, alba: { owner: 'ai2', units: 1 }, jorvik: { owner: 'ai', units: -1 },
      },
      {
        settings: { naval_enabled: true } as GameState['settings'],
        diplomacy: [{ player_index_a: 0, player_index_b: 2, status: 'truce', truce_turns_remaining: 3 }] as GameState['diplomacy'],
      },
    );
    expect(suggestFirstAttack(g, conns, 'me', names)).toBeNull();
  });

  it('is null outside the attack phase or without a player', () => {
    const g = game({ strathclyde: { owner: 'me', units: 6 }, alba: { owner: 'ai', units: 2 } });
    const conns = [land('strathclyde', 'alba')];
    expect(suggestFirstAttack({ ...g, phase: 'draft' } as GameState, conns, 'me', names)).toBeNull();
    expect(suggestFirstAttack(g, conns, null, names)).toBeNull();
    expect(suggestFirstAttack(g, conns, 'me', names)?.toId).toBe('alba');
  });
});

describe('the tip and the ring follow the panel', () => {
  const hint = { fromId: 'strathclyde', fromName: 'Strathclyde', fromUnits: 6, toId: 'jorvik', toName: 'Jórvík', toUnits: 3 };

  it('names the attack and rings its source while neither end is open', () => {
    expect(firstAttackOpen(hint, null, null)).toBeNull();
    expect(firstAttackOpen(hint, 'wessex', null)).toBeNull();
    expect(firstAttackTipText(hint, null)).toBe('Attack Jórvík from Strathclyde: your 6 against their 3. Tap Strathclyde.');
    expect(firstAttackRingId(hint, null)).toBe('strathclyde');
  });

  it('points at the target row once the source is open, by tap or as the armed source', () => {
    expect(firstAttackOpen(hint, 'strathclyde', null)).toBe('from');
    expect(firstAttackOpen(hint, null, 'strathclyde')).toBe('from');
    expect(firstAttackTipText(hint, 'from')).toBe('Tap Jórvík in the panel to attack it.');
    expect(firstAttackRingId(hint, 'from')).toBe('jorvik');
  });

  it('points at the panel\'s own button once the target is open', () => {
    expect(firstAttackOpen(hint, 'jorvik', null)).toBe('to');
    expect(firstAttackTipText(hint, 'to')).toBe('Press Attack from Strathclyde.');
    expect(firstAttackRingId(hint, 'to')).toBe('jorvik');
  });
});
