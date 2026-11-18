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
    // Six points banked is still two dice: the number is never shown.
    expect(describeCampaignCarry({ prestigePoints: 6, carry: {} })[0]!.text).toBe('+2 attack dice in rounds 1–3');
  });

  it('shows the Survivor Bonus as defense dice at home, capped as combat caps it', () => {
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { survivor_bonus: 8 } })).toEqual([
      { key: 'survivor', label: 'Survivor Bonus', text: '+2 defense dice on your home ground' },
    ]);
  });

  it('shows Revolutionary Spirit as reinforcements, one per two points, and nothing for one point', () => {
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 1 } })).toEqual([]);
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 2 } })[0]!.text).toBe('+1 reinforcement every turn');
    expect(describeCampaignCarry({ prestigePoints: 0, carry: { revolutionary_spirit: 10 } })[0]!.text).toBe('+2 reinforcements every turn');
  });

  it('lists every carry a path holds, Prestige first', () => {
    const keys = describeCampaignCarry({ prestigePoints: 2, carry: { survivor_bonus: 4, revolutionary_spirit: 4 } }).map((e) => e.key);
    expect(keys).toEqual(['prestige', 'survivor', 'spirit']);
  });
});
