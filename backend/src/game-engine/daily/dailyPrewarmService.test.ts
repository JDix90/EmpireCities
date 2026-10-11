import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameMap } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

vi.mock('./dailyPuzzleService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dailyPuzzleService')>()),
  ensureDailyChallengeForDate: vi.fn(),
}));
vi.mock('../../sockets/mapResolver', () => ({ resolveMap: vi.fn() }));
vi.mock('./puzzlePlay', () => ({ warmPuzzle: vi.fn() }));

import { ensureDailyChallengeForDate, type DailyChallengeRow } from './dailyPuzzleService';
import { resolveMap } from '../../sockets/mapResolver';
import { warmPuzzle } from './puzzlePlay';
import { isPrewarmWindow, prewarmTomorrowsDaily, tomorrowsDailyDate } from './dailyPrewarmService';

describe('daily pre-warm', () => {
  it('opens its window at 23:30 UTC', () => {
    expect(isPrewarmWindow(new Date('2026-09-14T23:29:59Z'))).toBe(false);
    expect(isPrewarmWindow(new Date('2026-09-14T23:30:00Z'))).toBe(true);
    expect(isPrewarmWindow(new Date('2026-09-14T00:05:00Z'))).toBe(false);
  });

  it('names tomorrow by the UTC calendar, across month and year ends', () => {
    expect(tomorrowsDailyDate(new Date('2026-09-14T23:45:00Z'))).toBe('2026-09-15');
    expect(tomorrowsDailyDate(new Date('2026-09-30T23:45:00Z'))).toBe('2026-10-01');
    expect(tomorrowsDailyDate(new Date('2026-12-31T23:45:00Z'))).toBe('2027-01-01');
  });
});

describe('daily pre-warm — the sweep', () => {
  const map = { map_id: 'acw_map' } as GameMap;
  const rowWith = (spec: Partial<DailyPuzzleSpec>) =>
    ({ challenge_date: '2026-10-27', spec: { title: 'Savannah', map_id: 'acw_map', ...spec } }) as unknown as DailyChallengeRow;
  const evening = new Date('2026-10-26T23:40:00Z');

  beforeEach(() => {
    vi.mocked(ensureDailyChallengeForDate).mockReset();
    vi.mocked(resolveMap).mockReset().mockResolvedValue(map);
    vi.mocked(warmPuzzle).mockReset().mockResolvedValue(1537);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('does nothing before 23:30', async () => {
    await prewarmTomorrowsDaily(new Date('2026-10-26T22:00:00Z'));
    expect(ensureDailyChallengeForDate).not.toHaveBeenCalled();
  });

  it("warms tomorrow's grader on a graded day, on the map a game would load", async () => {
    const row = rowWith({ v2: {} as DailyPuzzleSpec['v2'] });
    vi.mocked(ensureDailyChallengeForDate).mockResolvedValue(row);
    await prewarmTomorrowsDaily(evening);
    expect(ensureDailyChallengeForDate).toHaveBeenCalledWith('2026-10-27');
    expect(resolveMap).toHaveBeenCalledWith('acw_map');
    expect(warmPuzzle).toHaveBeenCalledWith(row.spec, map);
  });

  it('builds a classic day and warms nothing', async () => {
    vi.mocked(ensureDailyChallengeForDate).mockResolvedValue(rowWith({}));
    await prewarmTomorrowsDaily(evening);
    expect(resolveMap).not.toHaveBeenCalled();
    expect(warmPuzzle).not.toHaveBeenCalled();
  });

  it('warms nothing when the map cannot be loaded', async () => {
    vi.mocked(ensureDailyChallengeForDate).mockResolvedValue(rowWith({ v2: {} as DailyPuzzleSpec['v2'] }));
    vi.mocked(resolveMap).mockResolvedValue(null);
    await prewarmTomorrowsDaily(evening);
    expect(warmPuzzle).not.toHaveBeenCalled();
  });
});
