import { describe, expect, it } from 'vitest';
import { campaignStageFinishedProperties } from './campaignEvents';

const base = {
  campaignId: 'c1',
  pathId: 'blood_empire',
  isGuest: false,
  eraIndex: 0,
  eraId: 'ancient',
  gameId: 'g1',
  won: true,
  rounds: 19,
  gameStartedAt: 1_000,
  endedBy: 'threshold',
  failedAttempts: 2,
  now: 61_000,
};

describe('campaignStageFinishedProperties', () => {
  it('numbers the stage from one and times the game from its start', () => {
    expect(campaignStageFinishedProperties(base)).toEqual({
      campaign_id: 'c1',
      path_id: 'blood_empire',
      is_guest: false,
      stage: 1,
      era_id: 'ancient',
      game_id: 'g1',
      won: true,
      rounds: 19,
      duration_ms: 60_000,
      ended_by: 'threshold',
      failed_attempts: 2,
    });
  });

  it('calls a campaign with no path classic, and leaves unknowns null or zero', () => {
    const p = campaignStageFinishedProperties({
      ...base, pathId: null, gameStartedAt: null, endedBy: undefined, failedAttempts: null, won: false, isGuest: true,
    });
    expect(p).toMatchObject({ path_id: 'classic', duration_ms: null, ended_by: null, failed_attempts: 0, won: false, is_guest: true });
  });
});
