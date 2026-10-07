import { describe, it, expect } from 'vitest';
import { CUSTOM_ROUND_LIMIT_CHOICES, autoRoundLimit, customRoundLimitTurns } from './customRoundLimit';
import { QUICK_MATCH_VICTORY_PLANS } from './quickMatchPrefs';

describe("a custom game's round limit", () => {
  it("is Quick Match's for the same ending", () => {
    expect(autoRoundLimit(['domination'], 65)).toBe(QUICK_MATCH_VICTORY_PLANS.conquest.max_turns);
    expect(autoRoundLimit(['domination', 'threshold'], 65)).toBe(QUICK_MATCH_VICTORY_PLANS.majority.max_turns);
    expect(autoRoundLimit(['domination', 'threshold'], 50)).toBe(QUICK_MATCH_VICTORY_PLANS.blitz.max_turns);
    expect(autoRoundLimit(['capital', 'domination'], 65)).toBe(QUICK_MATCH_VICTORY_PLANS.capitals.max_turns);
    expect([120, 60, 45, 90]).toEqual([
      autoRoundLimit(['domination'], 65),
      autoRoundLimit(['threshold'], 65),
      autoRoundLimit(['threshold'], 40),
      autoRoundLimit(['capital'], 65),
    ]);
  });

  it('is the shortest of the endings ticked, since the first one met ends the game', () => {
    expect(autoRoundLimit(['domination', 'capital', 'threshold'], 50)).toBe(45);
    expect(autoRoundLimit(['domination', 'secret_mission'], 65)).toBe(90);
  });

  it('gives a threshold above 65% the longer limit', () => {
    expect(autoRoundLimit(['threshold'], 66)).toBe(90);
    expect(autoRoundLimit(['threshold'], 90)).toBe(90);
  });

  it('is Domination\'s with nothing ticked, as the form then sends Domination', () => {
    expect(autoRoundLimit([], 65)).toBe(120);
  });

  it('sends what the host chose, or nothing for no limit', () => {
    expect(customRoundLimitTurns('auto', ['domination'], 65)).toBe(120);
    for (const n of CUSTOM_ROUND_LIMIT_CHOICES) expect(customRoundLimitTurns(n, ['domination'], 65)).toBe(n);
    expect(customRoundLimitTurns('none', ['domination'], 65)).toBeUndefined();
  });
});
