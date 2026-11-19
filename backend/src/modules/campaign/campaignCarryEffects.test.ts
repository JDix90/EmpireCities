import { describe, expect, it } from 'vitest';
import { describeCampaignCarry } from './campaignCarryEffects';

describe('describeCampaignCarry', () => {
  it('says nothing for a campaign that carries nothing', () => {
    expect(describeCampaignCarry({ prestigePoints: 0, carry: {} })).toEqual([]);
    expect(describeCampaignCarry({ prestigePoints: null, carry: null })).toEqual([]);
  });

  it('shows Prestige as the dice combat applies, and for how long', () => {
    expect(describeCampaignCarry({ prestigePoints: 1, carry: {} })).toEqual([
      { key: 'prestige', label: 'Prestige', text: '+1 attack die in rounds 1–3', until_round: 3 },
    ]);
    // More banked is more dice for longer; the number itself is never shown.
    expect(describeCampaignCarry({ prestigePoints: 6, carry: {} })[0]).toMatchObject({ text: '+2 attack dice in rounds 1–4', until_round: 4 });
    expect(describeCampaignCarry({ prestigePoints: 10, carry: {} })[0]).toMatchObject({ text: '+2 attack dice in rounds 1–5', until_round: 5 });
  });

  it('shows the Survivor Bonus as defense dice at home, as many as combat rolls', () => {
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { survivor_bonus: 2 } })[0]!.text).toBe('+1 defense die on your home ground');
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { survivor_bonus: 8 } })).toEqual([
      { key: 'survivor', label: 'Survivor Bonus', text: '+3 defense dice on your home ground' },
    ]);
  });

  it('shows Revolutionary Spirit as reinforcements, and nothing for one point', () => {
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 1 } })).toEqual([]);
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 2 } })[0]!.text).toBe('+1 reinforcement every turn');
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 10 } })[0]!.text).toBe('+3 reinforcements every turn');
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 6 } })[0]!.text).toBe('+2 reinforcements every turn');
  });

  it('adds what trying again is worth, last, for a stage already lost', () => {
    expect(describeCampaignCarry({ prestigePoints: 0, carry: {}, stageLosses: 0 })).toEqual([]);
    expect(describeCampaignCarry({ prestigePoints: 2, carry: {}, stageLosses: 1 }).map((e) => [e.key, e.text])).toEqual([
      ['prestige', '+1 attack die in rounds 1–3'],
      ['retry', '+2 starting units on this era'],
    ]);
    // It is placed at the deal, so it is not a standing effect after round one.
    expect(describeCampaignCarry({ prestigePoints: 0, carry: {}, stageLosses: 9 })).toEqual([
      { key: 'retry', label: 'Trying again', text: '+6 starting units on this era', until_round: 1 },
    ]);
  });

  it('lists every carry a path holds, Prestige first', () => {
    const keys = describeCampaignCarry({ prestigePoints: 2, carry: { survivor_bonus: 4, revolutionary_spirit: 4 } }).map((e) => e.key);
    expect(keys).toEqual(['prestige', 'survivor', 'spirit']);
  });
});
