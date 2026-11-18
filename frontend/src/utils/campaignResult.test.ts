import { describe, expect, it } from 'vitest';
import { campaignCarryLine, campaignResultButtonLabel, campaignStageLine } from './campaignResult';

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

  it('shows a carry gained, a carry held, and nothing where there is none', () => {
    expect(campaignCarryLine({ carry: { label: 'Prestige', before: 0, after: 2 } })).toBe('Prestige +2 (now 2)');
    expect(campaignCarryLine({ carry: { label: 'Survivor Bonus', before: 4, after: 4 } })).toBe('Survivor Bonus: 4');
    expect(campaignCarryLine({ carry: { label: 'Prestige', before: 0, after: 0 } })).toBeNull();
    expect(campaignCarryLine({ carry: null })).toBeNull();
  });
});
