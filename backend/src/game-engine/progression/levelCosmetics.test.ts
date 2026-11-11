import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/postgres', () => ({ query: vi.fn(), queryOne: vi.fn(), pgPool: { connect: vi.fn() } }));

import { checkLevelCosmetic, levelCosmeticsCrossed } from './progressionService';

describe('level frames (levelCosmeticsCrossed, checkLevelCosmetic)', () => {
  it('earns the frame for a threshold crossed, and nothing short of one', () => {
    expect(levelCosmeticsCrossed(9, 10)).toEqual(['frame_level_10']);
    expect(levelCosmeticsCrossed(10, 12)).toEqual([]);
    expect(levelCosmeticsCrossed(1, 3)).toEqual([]);
  });

  it('earns every threshold a single climb crosses, lowest first', () => {
    expect(levelCosmeticsCrossed(8, 21)).toEqual(['frame_level_10', 'frame_level_20']);
  });

  it('grants each frame crossed and names the highest', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    const result = await checkLevelCosmetic(client as never, 'u1', 8, 21);
    expect(result).toBe('frame_level_20');
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.map((c) => (c as unknown[])[1])).toEqual([['u1', 'frame_level_10'], ['u1', 'frame_level_20']]);
  });

  it('grants nothing when no threshold is crossed', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    expect(await checkLevelCosmetic(client as never, 'u1', 3, 4)).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });
});
