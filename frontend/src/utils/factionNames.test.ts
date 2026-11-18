import { describe, expect, it } from 'vitest';
import { campaignBotFaction, factionDisplayName } from './factionNames';

describe('factionDisplayName', () => {
  it('reads a faction by its era, since ids are era-scoped', () => {
    expect(factionDisplayName('ancient', 'parthia')).toBe('Parthian Empire');
    expect(factionDisplayName('medieval', 'mongol_empire')).toBe('Mongol Khanate');
    expect(factionDisplayName('medieval', 'parthia')).toBeNull();
    expect(factionDisplayName(null, 'parthia')).toBeNull();
    expect(factionDisplayName('ancient', null)).toBeNull();
  });
});

describe('campaignBotFaction', () => {
  const bot = { is_ai: true, faction_id: 'han' };
  it('names a campaign bot for its faction', () => {
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ancient', player: bot })).toBe('Han Dynasty');
  });
  it('leaves everyone else as they are', () => {
    expect(campaignBotFaction({ isCampaign: false, eraId: 'ancient', player: bot })).toBeNull();
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ancient', player: { is_ai: false, faction_id: 'rome' } })).toBeNull();
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ancient', player: { is_ai: true, faction_id: null } })).toBeNull();
  });
});
