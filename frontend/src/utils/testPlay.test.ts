import { describe, it, expect, vi, beforeEach } from 'vitest';

const postMock = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => postMock(...a) } }));

import { clampOpponents, defaultTestPlayEra, startTestGame } from './testPlay';

beforeEach(() => postMock.mockReset());

describe('testPlay', () => {
  it('offers the map\'s own era when it is playable, else Modern', () => {
    expect(defaultTestPlayEra('medieval')).toBe('medieval');
    expect(defaultTestPlayEra('custom')).toBe('modern');
    expect(defaultTestPlayEra('galaxy_age')).toBe('modern');
    expect(defaultTestPlayEra(null)).toBe('modern');
  });

  it('keeps the table between one and five bots', () => {
    expect(clampOpponents(0)).toBe(1);
    expect(clampOpponents(3.4)).toBe(3);
    expect(clampOpponents(9)).toBe(5);
  });

  it('starts a private, auto-started game with the bots filling every other seat', async () => {
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    const id = await startTestGame({ mapId: 'm1', era: 'ww2', opponents: 2, difficulty: 'hard' });
    expect(id).toBe('g1');
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/games');
    expect(body).toEqual(expect.objectContaining({
      era_id: 'ww2',
      map_id: 'm1',
      max_players: 3,
      ai_count: 2,
      ai_difficulty: 'hard',
      auto_start: true,
      is_private: true,
    }));
    const settings = body.settings as Record<string, unknown>;
    expect(settings.allowed_victory_conditions).toEqual(expect.arrayContaining(['domination']));
    expect(typeof settings.max_turns).toBe('number');
  });
});
