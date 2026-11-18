import { describe, expect, it } from 'vitest';
import { buildCampaignGameResult } from './campaignResult';
import { CAMPAIGN_PATHS } from './campaignPaths';

const ERAS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'] as const;
const base = { campaignId: 'c1', eras: ERAS, carryBefore: {}, carryAfter: {}, prestigeAfter: 0 };

describe('buildCampaignGameResult', () => {
  it('a won stage advances: the win text, the carry gained and the next era', () => {
    const r = buildCampaignGameResult({
      ...base, pathId: 'blood_empire', eraIndex: 0, won: true,
      carryBefore: {}, carryAfter: { prestige_bonus: 2 }, prestigeAfter: 2,
    });
    expect(r).toEqual({
      campaign_id: 'c1',
      path_id: 'blood_empire',
      path_name: 'Blood & Empire',
      stage: 1,
      stage_count: 6,
      outcome: 'advanced',
      next_era: 'medieval',
      outro_text: CAMPAIGN_PATHS.blood_empire.eras[0]!.outro_win_text,
      carry: { label: 'Prestige', before: 0, after: 2 },
      carry_effects: [{ key: 'prestige', label: 'Prestige', text: '+2 attack dice in rounds 1\u20133', until_round: 3 }],
    });
  });

  it('a lost stage stays on the stage, with the loss text and the carry unchanged', () => {
    const r = buildCampaignGameResult({
      ...base, pathId: 'last_defenders', eraIndex: 1, won: false,
      carryBefore: { survivor_bonus: 4 }, carryAfter: { survivor_bonus: 4 },
    });
    expect(r.outcome).toBe('lost');
    expect(r.next_era).toBeNull();
    expect(r.outro_text).toBe(CAMPAIGN_PATHS.last_defenders.eras[1]!.outro_loss_text);
    expect(r.carry).toEqual({ label: 'Survivor Bonus', before: 4, after: 4 });
  });

  it('winning the last stage completes the campaign', () => {
    const r = buildCampaignGameResult({ ...base, pathId: 'revolutionary_flame', eraIndex: 5, won: true });
    expect(r.outcome).toBe('completed');
    // Nothing follows the last stage, so nothing is carried into one.
    expect(r.carry_effects).toEqual([]);
    expect(r.next_era).toBeNull();
    expect(r.stage).toBe(6);
  });

  it('the classic campaign has no path, text or carry', () => {
    const r = buildCampaignGameResult({ ...base, pathId: null, eraIndex: 2, won: true });
    expect(r).toMatchObject({ path_id: null, path_name: 'Classic Campaign', outcome: 'advanced', next_era: 'ww2', outro_text: null, carry: null });
  });
});
