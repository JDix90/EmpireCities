/**
 * Popular Creator: a player's map reaching 100 games. Nothing awarded it — the
 * play count rose with every game started on the map, and no one looked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const increment = vi.hoisted(() => vi.fn());
const creatorOf = vi.hoisted(() => vi.fn());
const grant = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock('../../db/postgres/mapsRepository', () => ({
  incrementMapPlayCount: increment,
  findMapCreatorUserId: creatorOf,
  getMapByIdFromDb: vi.fn(),
  listEraMapRows: vi.fn(),
  rowToSummary: vi.fn(),
}));
vi.mock('../../db/redis', () => ({ getRedis: () => ({ del: async () => 1 }) }));
vi.mock('../../game-engine/achievements/achievementService', () => ({ grantAchievementsOutsideGame: grant }));

import { grantMapMaker, incrementPlayCount, POPULAR_CREATOR_PLAYS } from './mapService';

const MAKER = '11111111-2222-4333-8444-555555555555';

describe('incrementPlayCount', () => {
  beforeEach(() => {
    increment.mockReset();
    grant.mockClear();
  });

  it('awards the maker Popular Creator with the hundredth game, and with any after it', async () => {
    for (const plays of [POPULAR_CREATOR_PLAYS, POPULAR_CREATOR_PLAYS + 37]) {
      increment.mockResolvedValueOnce({ play_count: plays, creator_user_id: MAKER });
      await incrementPlayCount('m1');
    }
    expect(grant).toHaveBeenCalledTimes(2);
    expect(grant).toHaveBeenCalledWith(MAKER, ['popular_creator']);
  });

  it('awards nothing below a hundred, or for an era map or a deleted maker', async () => {
    increment.mockResolvedValueOnce({ play_count: POPULAR_CREATOR_PLAYS - 1, creator_user_id: MAKER });
    await incrementPlayCount('m1');
    increment.mockResolvedValueOnce({ play_count: 5000, creator_user_id: null });
    await incrementPlayCount('era_ancient');
    increment.mockResolvedValueOnce(null);
    await incrementPlayCount('gone');
    expect(grant).not.toHaveBeenCalled();
  });
});

describe('grantMapMaker', () => {
  beforeEach(() => grant.mockClear());

  it('awards Map Maker to the player whose map was approved', async () => {
    creatorOf.mockResolvedValueOnce(MAKER);
    await grantMapMaker('m1');
    expect(grant).toHaveBeenCalledWith(MAKER, ['map_maker']);
  });

  it('awards nothing when the map has no player behind it', async () => {
    creatorOf.mockResolvedValueOnce(null);
    await grantMapMaker('era_ancient');
    expect(grant).not.toHaveBeenCalled();
  });
});
