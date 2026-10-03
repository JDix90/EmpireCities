import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import { attackAvailability, nothingToFightMessage } from './attackAvailability';

// home — coast — far, and home — west: the enemy sits across an empty
// neutral, as Japan sits from the USA on the WWII economy day.
const CONNS = [
  { from: 'home', to: 'coast' },
  { from: 'coast', to: 'far' },
  { from: 'home', to: 'west' },
];

function state(opts: { phase?: string; coast?: { owner_id: string | null; unit_count: number } } = {}): GameState {
  return {
    phase: opts.phase ?? 'attack',
    settings: {},
    territories: {
      home: { owner_id: 'me', unit_count: 5 },
      west: { owner_id: 'me', unit_count: 1 },
      coast: opts.coast ?? { owner_id: null, unit_count: 0 },
      far: { owner_id: 'ai', unit_count: 7 },
    },
    players: [],
  } as unknown as GameState;
}

describe('attackAvailability', () => {
  it('finds nothing on a cleared board where the enemy is an ocean away', () => {
    expect(attackAvailability(state(), CONNS, 'me')).toEqual({ anyTarget: false, emptyNeutralBorder: true });
  });

  it('finds a target when an enemy borders the player', () => {
    expect(attackAvailability(state({ coast: { owner_id: 'ai', unit_count: 4 } }), CONNS, 'me').anyTarget).toBe(true);
  });

  it('counts an armed neutral, which the server lets anyone take', () => {
    expect(attackAvailability(state({ coast: { owner_id: null, unit_count: 2 } }), CONNS, 'me').anyTarget).toBe(true);
  });

  it('applies the attack rules whatever the current phase', () => {
    expect(attackAvailability(state({ phase: 'draft', coast: { owner_id: 'ai', unit_count: 4 } }), CONNS, 'me').anyTarget).toBe(true);
    expect(attackAvailability(state({ phase: 'draft' }), CONNS, 'me').anyTarget).toBe(false);
  });

  it('finds nothing for a viewer without ground, or without a game', () => {
    expect(attackAvailability(state(), CONNS, 'nobody')).toEqual({ anyTarget: false, emptyNeutralBorder: false });
    expect(attackAvailability(null, CONNS, 'me').anyTarget).toBe(false);
  });
});

describe('nothingToFightMessage', () => {
  it('names the empty land when that is what surrounds the player', () => {
    expect(nothingToFightMessage(state(), CONNS, 'me')).toBe(
      'Nothing to fight: no enemy borders any of your territories, and empty land cannot be taken. Carry on to Fortify.',
    );
  });

  it('leaves the empty land out when none borders the player', () => {
    // home and west border only each other.
    expect(nothingToFightMessage(state(), [{ from: 'home', to: 'west' }], 'me')).toBe(
      'Nothing to fight: no enemy borders any of your territories. Carry on to Fortify.',
    );
  });

  it('is silent when there is something to attack', () => {
    expect(nothingToFightMessage(state({ coast: { owner_id: 'ai', unit_count: 4 } }), CONNS, 'me')).toBeNull();
  });
});
