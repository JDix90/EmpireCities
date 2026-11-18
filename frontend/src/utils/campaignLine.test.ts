import { describe, expect, it } from 'vitest';
import { pendingLineChoice, type CampaignLineChoice } from './campaignLine';

const choice: CampaignLineChoice = {
  choose_at: 3,
  chosen: null,
  options: [
    { line_id: 'allies', name: 'The Western Allies', pitch: 'p', title: 'The Second Front, 1944', faction_id: 'usa' },
    { line_id: 'soviets', name: 'The Soviet Union', pitch: 'p', title: 'Berlin and Manchuria, 1945', faction_id: 'soviet_union' },
  ],
};
const eras = (stage3: { game_id: string | null; completed: boolean }) =>
  [0, 1, 2, 3, 4, 5].map((index) => ({ index, game_id: null, completed: index < 3, ...(index === 3 ? stage3 : {}) }));
const at = (over: Partial<Parameters<typeof pendingLineChoice>[0]> = {}) => ({
  status: 'active', current_era_index: 3, line_choice: choice, eras: eras({ game_id: null, completed: false }), ...over,
});

describe('pendingLineChoice', () => {
  it('asks at the stage that offers the choice, before its first game', () => {
    expect(pendingLineChoice(at())).toBe(choice);
  });

  it('asks again on a retry: a player who lost as one side may try the other', () => {
    const lost = { ...choice, chosen: 'allies' };
    expect(pendingLineChoice(at({ line_choice: lost, eras: eras({ game_id: 'g1', completed: true }) }))).toBe(lost);
  });

  it('does not ask while the stage game is still in progress', () => {
    expect(pendingLineChoice(at({ eras: eras({ game_id: 'g1', completed: false }) }))).toBeNull();
  });

  it('does not ask before the stage, after it, or on a finished campaign', () => {
    expect(pendingLineChoice(at({ current_era_index: 2 }))).toBeNull();
    expect(pendingLineChoice(at({ current_era_index: 4 }))).toBeNull();
    expect(pendingLineChoice(at({ status: 'completed' }))).toBeNull();
  });

  it('does not ask on a path with no sides, or from a server that sends none', () => {
    expect(pendingLineChoice(at({ line_choice: null }))).toBeNull();
    expect(pendingLineChoice(at({ line_choice: undefined }))).toBeNull();
    expect(pendingLineChoice(at({ line_choice: { ...choice, options: choice.options.slice(0, 1) } }))).toBeNull();
  });
});
