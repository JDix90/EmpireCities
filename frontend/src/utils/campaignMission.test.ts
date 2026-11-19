import { describe, expect, it } from 'vitest';
import { describeCampaignMission, readCampaignMission } from './campaignMission';

const lookup = {
  territories: [
    { territory_id: 'germany', name: 'Germany' },
    { territory_id: 'manchuria_ww2', name: 'Manchuria' },
  ],
  regions: [
    { region_id: 'western_front', name: 'Western Front' },
    { region_id: 'north_america', name: 'North America' },
    { region_id: 'europe', name: 'Europe' },
  ],
};

describe('describeCampaignMission', () => {
  it('names the regions to hold', () => {
    expect(describeCampaignMission({ kind: 'control_regions', region_ids: ['western_front'] }, { lookup }))
      .toBe('Hold every territory in Western Front');
    expect(describeCampaignMission({ kind: 'control_regions', region_ids: ['north_america', 'europe'] }, { lookup }))
      .toBe('Hold every territory in North America and Europe');
  });

  it('words an objective that counts from a round as holding it then', () => {
    expect(describeCampaignMission({ kind: 'control_regions', region_ids: ['western_front'], from_round: 15 }, { lookup }))
      .toBe('Hold every territory in Western Front in round 15, or any round after');
    expect(readCampaignMission({ kind: 'control_regions', region_ids: ['a'], from_round: 15 }))
      .toEqual({ kind: 'control_regions', region_ids: ['a'], from_round: 15 });
    // A round that is not one is dropped, and the objective is an ordinary one.
    expect(readCampaignMission({ kind: 'control_regions', region_ids: ['a'], from_round: 'soon' }))
      .toEqual({ kind: 'control_regions', region_ids: ['a'] });
  });

  it('names the two territories to capture', () => {
    expect(describeCampaignMission({ kind: 'capture_territories', territory_ids: ['germany', 'manchuria_ww2'] }, { lookup }))
      .toBe('Capture Germany and Manchuria, and hold both');
  });

  it('reads well before the map has loaded', () => {
    expect(describeCampaignMission({ kind: 'capture_territories', territory_ids: ['germany', 'manchuria_ww2'] }))
      .toBe('Capture Germany and Manchuria, and hold both');
  });

  it('names the power to eliminate, and that it must be the player who does it', () => {
    expect(describeCampaignMission({ kind: 'eliminate_faction', faction_id: 'germany' }, { eraId: 'ww2' }))
      .toBe('Eliminate Third Reich yourself');
    expect(describeCampaignMission({ kind: 'eliminate_faction', faction_id: 'nobody' }, { eraId: 'ww2' }))
      .toBe('Eliminate the named power yourself');
  });
});

describe('readCampaignMission', () => {
  it('reads the three kinds and nothing else', () => {
    expect(readCampaignMission({ kind: 'control_regions', region_ids: ['a'] })).toEqual({ kind: 'control_regions', region_ids: ['a'] });
    expect(readCampaignMission({ kind: 'capture_territories', territory_ids: ['a', 'b'] }))
      .toEqual({ kind: 'capture_territories', territory_ids: ['a', 'b'] });
    expect(readCampaignMission({ kind: 'eliminate_faction', faction_id: 'x' })).toEqual({ kind: 'eliminate_faction', faction_id: 'x' });
    for (const bad of [undefined, null, 'x', {}, { kind: 'control_regions', region_ids: [] }, { kind: 'capture_territories', territory_ids: ['a'] }]) {
      expect(readCampaignMission(bad)).toBeNull();
    }
  });
});
