import { describe, it, expect } from 'vitest';
import { distinctHighlights, nextReplaySpeed, replayPhaseLabel } from './replayControls';

describe('distinctHighlights', () => {
  it('keeps one chip per turn and label, in order', () => {
    const h = (turn: number, label: string) => ({ turn, label, type: 'turning_point' });
    const chips = distinctHighlights([
      h(2, 'Decisive attack — gained ground'),
      h(2, 'Decisive attack — gained ground'),
      h(2, 'Decisive attack — gained ground'),
      h(2, 'Costly attack — lost ground'),
      h(5, 'Decisive attack — gained ground'),
    ]);
    expect(chips.map((c) => `T${c.turn}: ${c.label}`)).toEqual([
      'T2: Decisive attack — gained ground',
      'T2: Costly attack — lost ground',
      'T5: Decisive attack — gained ground',
    ]);
  });

  it('stops at the cap after removing copies, not before', () => {
    const many = [1, 1, 2, 3, 4, 5, 6].map((turn) => ({ turn, label: 'x' }));
    expect(distinctHighlights(many).map((c) => c.turn)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('nextReplaySpeed', () => {
  it('steps through the speeds and wraps back to the slowest', () => {
    expect(nextReplaySpeed(0.5)).toBe(1);
    expect(nextReplaySpeed(1)).toBe(2);
    expect(nextReplaySpeed(4)).toBe(8);
    expect(nextReplaySpeed(8)).toBe(0.5);
  });
});

describe('replayPhaseLabel', () => {
  it("names the player's phase as the HUD does", () => {
    expect(replayPhaseLabel('reinforce', 'Ada')).toBe("Ada's reinforcement phase");
    expect(replayPhaseLabel('attack', 'Ada')).toBe("Ada's attack phase");
  });

  it('calls the last frame the end of the game, not a player\'s "game over phase"', () => {
    expect(replayPhaseLabel('game_over', 'Lady Hoshiko (AI)')).toBe('Game over');
  });
});
