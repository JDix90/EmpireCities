import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../types';
import type { ScheduledDay } from './dailySchedule';

vi.mock('../../modules/maps/mapService', () => ({ getMapById: vi.fn() }));
vi.mock('./dailyProofThread', () => ({ proveOffThread: vi.fn() }));

import { getMapById } from '../../modules/maps/mapService';
import { proveOffThread } from './dailyProofThread';
import { candidateForDateV2, proveDayV2, scheduleDayV2 } from './dailyScheduleV2';

/**
 * The v2 day as the server serves it (scheduleDayV2 with its default deps):
 * what the calendar answers costs nothing, a solve goes to the proof worker
 * once per date however many requests wait on it, and only a result is kept.
 * The map service and the worker are stood in; dailyProofThread.test.ts runs
 * the real thread. Each test takes dates of its own, since the memo is the
 * module's.
 */

const readMap = (mapId: string): GameMap =>
  JSON.parse(readFileSync(join(__dirname, `../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap;

function mapIdFor(date: string): string {
  const sp = candidateForDateV2(date)!.set_piece;
  return sp.kind === 'domination' ? sp.spec.map_id : sp.map_id;
}

const dayFor = (date: string) => ({ date, source: 'library', set_piece_id: 'stand-in', spec: {} }) as unknown as ScheduledDay;

beforeEach(() => {
  vi.mocked(getMapById).mockReset().mockImplementation(async (mapId: string) => readMap(mapId));
  vi.mocked(proveOffThread).mockReset();
});

describe('daily v2 — serving a day', () => {
  it('proves a graded date once while every request waits on it, then keeps the day', async () => {
    const date = '2026-10-21';
    let answer!: (day: ScheduledDay) => void;
    vi.mocked(proveOffThread).mockImplementation(() => new Promise<ScheduledDay>((resolve) => {
      answer = resolve;
    }));
    const requests = [scheduleDayV2(date), scheduleDayV2(date), scheduleDayV2(date)];
    await vi.waitFor(() => expect(proveOffThread).toHaveBeenCalledTimes(1));
    const day = dayFor(date);
    answer(day);
    expect(await Promise.all(requests)).toEqual([day, day, day]);
    expect(await scheduleDayV2(date)).toBe(day);
    expect(proveOffThread).toHaveBeenCalledTimes(1);
    expect(getMapById).toHaveBeenCalledTimes(1);
  });

  it("hands the worker the set-piece's map, with the same proof to run on this thread if it cannot", async () => {
    const date = '2026-10-27';
    vi.mocked(proveOffThread).mockImplementation(async (_date, _map, onThisThread) => onThisThread());
    const day = await scheduleDayV2(date);
    const [proved, map] = vi.mocked(proveOffThread).mock.calls[0];
    expect(proved).toBe(date);
    expect(getMapById).toHaveBeenCalledWith(mapIdFor(date));
    expect(map?.map_id).toBe(mapIdFor(date));
    expect(day?.spec.v2, 'graded').toBeDefined();
    expect(day).toEqual(await proveDayV2(date, map));
  });

  it('answers a date the calendar refuses without loading a map or starting a proof', async () => {
    expect(await scheduleDayV2('2026-09-25')).toBeNull();
    expect(getMapById).not.toHaveBeenCalled();
    expect(proveOffThread).not.toHaveBeenCalled();
  });

  it('keeps no failure: the next request proves again', async () => {
    const date = '2026-11-04';
    vi.mocked(proveOffThread).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(dayFor(date));
    await expect(scheduleDayV2(date)).rejects.toThrow('boom');
    expect(await scheduleDayV2(date)).toEqual(dayFor(date));
    expect(proveOffThread).toHaveBeenCalledTimes(2);
  });

  it('with deps of its own, as the tests and the bench pass, proves on this thread and keeps nothing', async () => {
    const date = '2026-10-13';
    const deps = { loadMap: async (mapId: string) => readMap(mapId), simulate: null };
    const day = await scheduleDayV2(date, deps);
    expect(day?.spec.v2, 'graded').toBeDefined();
    expect(await scheduleDayV2(date, deps)).toEqual(day);
    expect(proveOffThread).not.toHaveBeenCalled();
    expect(getMapById).not.toHaveBeenCalled();
  });
});
