import { describe, expect, it } from 'vitest';
import { readCampaignDisplay } from './campaignDisplay';
import { campaignBotFaction } from './factionNames';

describe('readCampaignDisplay', () => {
  it('reads the names a stage brings, and nothing from a server that sends none', () => {
    expect(readCampaignDisplay(undefined)).toEqual({});
    expect(readCampaignDisplay('x')).toEqual({});
    expect(readCampaignDisplay({ era_label: 'The American Revolution', objective: 'Hold the seaboard', factions: { germany: 'Hessian Regiments', bad: 3 } }))
      .toEqual({ era_label: 'The American Revolution', objective: 'Hold the seaboard', factions: { germany: 'Hessian Regiments' } });
  });
});

describe('campaignBotFaction with a stage\'s own names', () => {
  const bot = { is_ai: true, faction_id: 'germany' };

  it('names a bot as the stage does, not as the era would', () => {
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ww2', player: bot })).toBe('Third Reich');
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ww2', player: bot, names: { germany: 'Hessian Regiments' } }))
      .toBe('Hessian Regiments');
  });

  it('falls back to the era\'s name for a faction the stage does not rename', () => {
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ww2', player: { is_ai: true, faction_id: 'uk' }, names: { germany: 'Hessian Regiments' } }))
      .toBe('United Kingdom');
  });

  it('still names nobody outside a campaign, and never a person', () => {
    expect(campaignBotFaction({ isCampaign: false, eraId: 'ww2', player: bot, names: { germany: 'Hessian Regiments' } })).toBeNull();
    expect(campaignBotFaction({ isCampaign: true, eraId: 'ww2', player: { is_ai: false, faction_id: 'germany' }, names: { germany: 'Hessian Regiments' } })).toBeNull();
  });
});
