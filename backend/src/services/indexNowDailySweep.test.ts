import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mostRecentlySettledDate, submitSettledDay, resetIndexNowSweepState } from './indexNowDailySweep';
import { featureFlags } from '../config/featureFlags';
import * as indexNow from './indexNow';

describe('mostRecentlySettledDate', () => {
  it('is yesterday in the daily calendar (UTC) terms', () => {
    // Just after UTC midnight: the day that settled is the previous date, which
    // is what isArchivableDate will now allow. A local-time implementation
    // would name today's live puzzle here and announce an unpublished page.
    expect(mostRecentlySettledDate(new Date('2026-09-14T00:05:00Z'))).toBe('2026-09-13');
    expect(mostRecentlySettledDate(new Date('2026-09-14T23:55:00Z'))).toBe('2026-09-13');
    expect(mostRecentlySettledDate(new Date('2026-01-01T00:30:00Z'))).toBe('2025-12-31');
  });
});

describe('submitSettledDay', () => {
  const now = new Date('2026-09-14T01:00:00Z');
  let submitSpy: ReturnType<typeof vi.spyOn>;
  let configSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetIndexNowSweepState();
    submitSpy = vi.spyOn(indexNow, 'submitUrls').mockResolvedValue({
      submitted: 1, status: 200, skipped: null,
    });
    configSpy = vi.spyOn(indexNow, 'getIndexNowConfig').mockReturnValue({
      key: 'a005712f9fb74d1a9483320e23805107',
      host: 'borderfall.gg',
      keyLocation: 'https://borderfall.gg/a005712f9fb74d1a9483320e23805107.txt',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('does nothing while the flag is off — no outbound call at all', async () => {
    vi.spyOn(featureFlags, 'indexNowEnabled', 'get').mockReturnValue(false);
    expect(await submitSettledDay(now)).toBeNull();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('does nothing when no key is configured, even with the flag on', async () => {
    vi.spyOn(featureFlags, 'indexNowEnabled', 'get').mockReturnValue(true);
    configSpy.mockReturnValue(null);
    expect(await submitSettledDay(now)).toBeNull();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('submits yesterday\'s archive URL once', async () => {
    vi.spyOn(featureFlags, 'indexNowEnabled', 'get').mockReturnValue(true);
    expect(await submitSettledDay(now)).toBe('2026-09-13');
    expect(submitSpy).toHaveBeenCalledWith(['https://borderfall.gg/daily/2026-09-13']);
  });

  it('does not re-submit the same day on a later tick', async () => {
    vi.spyOn(featureFlags, 'indexNowEnabled', 'get').mockReturnValue(true);
    await submitSettledDay(now);
    expect(await submitSettledDay(new Date('2026-09-14T14:00:00Z'))).toBeNull();
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('submits again once the date rolls over', async () => {
    vi.spyOn(featureFlags, 'indexNowEnabled', 'get').mockReturnValue(true);
    await submitSettledDay(now);
    expect(await submitSettledDay(new Date('2026-09-15T00:10:00Z'))).toBe('2026-09-14');
    expect(submitSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on the next tick after a rejection rather than losing the day', async () => {
    vi.spyOn(featureFlags, 'indexNowEnabled', 'get').mockReturnValue(true);
    submitSpy.mockResolvedValueOnce({ submitted: 0, status: 500, skipped: null });
    expect(await submitSettledDay(now)).toBeNull();
    expect(await submitSettledDay(now)).toBe('2026-09-13');
    expect(submitSpy).toHaveBeenCalledTimes(2);
  });
});
