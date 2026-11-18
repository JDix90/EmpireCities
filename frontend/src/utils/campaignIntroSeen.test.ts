import { beforeEach, describe, expect, it } from 'vitest';
import { campaignIntroSeen, markCampaignIntroSeen } from './campaignIntroSeen';

describe('campaign intro seen', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a game once marked, and no other', () => {
    expect(campaignIntroSeen('g1')).toBe(false);
    markCampaignIntroSeen('g1');
    expect(campaignIntroSeen('g1')).toBe(true);
    expect(campaignIntroSeen('g2')).toBe(false);
  });

  it('keeps the newest games and drops the oldest', () => {
    for (let i = 0; i < 35; i++) markCampaignIntroSeen(`g${i}`);
    expect(campaignIntroSeen('g0')).toBe(false);
    expect(campaignIntroSeen('g34')).toBe(true);
    expect(JSON.parse(localStorage.getItem('cc-campaign-intros-seen')!)).toHaveLength(30);
  });

  it('reads anything else stored there as nothing seen', () => {
    localStorage.setItem('cc-campaign-intros-seen', '{"not":"a list"}');
    expect(campaignIntroSeen('g1')).toBe(false);
  });
});
