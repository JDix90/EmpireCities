import { describe, expect, it } from 'vitest';
import { campaignCarryLines, campaignResultButtonLabel, campaignStageLine } from './campaignResult';

describe('campaign result helpers', () => {
  it('names the button for where the campaign goes next', () => {
    expect(campaignResultButtonLabel({ outcome: 'lost' })).toBe('Try again');
    expect(campaignResultButtonLabel({ outcome: 'completed' })).toBe('See your campaign');
    expect(campaignResultButtonLabel({ outcome: 'advanced' }, 'Medieval Era')).toBe('Next era: Medieval Era');
    expect(campaignResultButtonLabel({ outcome: 'advanced' }, null)).toBe('Next era');
  });

  it('says which stage this was', () => {
    expect(campaignStageLine({ stage: 2, stage_count: 6 })).toBe('Era 2 of 6');
  });

  it('lists what is carried into the next stage as its effect', () => {
    const effects = [{ key: 'prestige', label: 'Prestige', text: '+2 attack dice in rounds 1\u20133', until_round: 3 }];
    expect(campaignCarryLines({ outcome: 'advanced', carry: { label: 'Prestige', before: 0, after: 2 }, carry_effects: effects }))
      .toEqual(['Prestige: +2 attack dice in rounds 1\u20133']);
    expect(campaignCarryLines({ outcome: 'lost', carry: null, carry_effects: [] })).toEqual([]);
    // Nothing follows the last stage.
    expect(campaignCarryLines({ outcome: 'completed', carry: { label: 'Prestige', before: 10, after: 12 }, carry_effects: effects })).toEqual([]);
  });

  it('names a carry that grew when an older server sends no effects, and never its number', () => {
    expect(campaignCarryLines({ outcome: 'advanced', carry: { label: 'Prestige', before: 0, after: 2 } })).toEqual(['Prestige earned']);
    expect(campaignCarryLines({ outcome: 'lost', carry: { label: 'Survivor Bonus', before: 4, after: 4 } })).toEqual([]);
  });
});
