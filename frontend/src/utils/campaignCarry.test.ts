import { describe, expect, it } from 'vitest';
import { activeCarryEffects, carryEffectLine, type CampaignCarryEffect } from './campaignCarry';

const prestige: CampaignCarryEffect = { key: 'prestige', label: 'Prestige', text: '+2 attack dice in rounds 1\u20133', until_round: 3 };
const survivor: CampaignCarryEffect = { key: 'survivor', label: 'Survivor Bonus', text: '+2 defense dice on your home ground' };

describe('campaign carry helpers', () => {
  it('writes an effect as its label and what it does', () => {
    expect(carryEffectLine(survivor)).toBe('Survivor Bonus: +2 defense dice on your home ground');
  });

  it('drops an effect once its last round has passed', () => {
    expect(activeCarryEffects([prestige, survivor], 3)).toEqual([prestige, survivor]);
    expect(activeCarryEffects([prestige, survivor], 4)).toEqual([survivor]);
    expect(activeCarryEffects(undefined, 1)).toEqual([]);
  });
});
