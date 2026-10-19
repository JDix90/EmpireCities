import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
const success = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => post(...a), get: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: (...a: unknown[]) => success(...a), error: vi.fn() } }));

import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import {
  capturePendingReferral,
  clearPendingReferral,
  getPendingReferral,
  redeemPendingReferral,
  resetPendingReferralForTests,
} from './pendingReferral';

const DAY = 24 * 60 * 60 * 1000;

function setUrl(path: string): void {
  window.history.pushState({}, '', path);
}

function setFlag(on: boolean): void {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, player_links_play_enabled: on } }));
}

describe('pending referral', () => {
  beforeEach(() => {
    localStorage.clear();
    post.mockReset();
    success.mockReset();
    resetPendingReferralForTests();
    setFlag(true);
    setUrl('/');
  });

  it("keeps a referral link's code, uppercased, and ignores malformed ones", () => {
    setUrl('/?ref=k7q2px9a');
    capturePendingReferral();
    expect(getPendingReferral()).toBe('K7Q2PX9A');

    clearPendingReferral();
    for (const bad of ['/?ref=', '/?ref=ab', '/?ref=<script>', `/?ref=${'A'.repeat(17)}`, '/?nothing=1']) {
      setUrl(bad);
      capturePendingReferral();
      expect(getPendingReferral(), bad).toBeNull();
    }
  });

  it("keeps the first friend's code, and drops it after 30 days", () => {
    const t0 = Date.UTC(2026, 9, 1);
    setUrl('/?ref=FIRST123');
    capturePendingReferral(t0);
    setUrl('/?ref=SECOND12');
    capturePendingReferral(t0 + DAY);
    expect(getPendingReferral(t0 + DAY)).toBe('FIRST123');
    expect(getPendingReferral(t0 + 31 * DAY)).toBeNull();
    // An expired code gives way to the next link.
    capturePendingReferral(t0 + 31 * DAY);
    expect(getPendingReferral(t0 + 31 * DAY)).toBe('SECOND12');
  });

  it('redeems the code once the account exists, and says so', async () => {
    setUrl('/?ref=K7Q2PX9A');
    capturePendingReferral();
    post.mockResolvedValue({ data: { ok: true } });
    await redeemPendingReferral();
    expect(post).toHaveBeenCalledWith('/progression/referral/redeem', { code: 'K7Q2PX9A' });
    expect(success).toHaveBeenCalledTimes(1);
    expect(getPendingReferral()).toBeNull();
    await redeemPendingReferral();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('drops a code the server refuses, and keeps one that failed for another reason', async () => {
    setUrl('/?ref=K7Q2PX9A');
    capturePendingReferral();
    post.mockRejectedValueOnce({ response: { status: 503 } });
    await redeemPendingReferral();
    expect(getPendingReferral()).toBe('K7Q2PX9A');
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'You have already used a referral code' } } });
    await redeemPendingReferral();
    expect(getPendingReferral()).toBeNull();
    expect(success).not.toHaveBeenCalled();
  });

  it('does nothing while the flag is off, and keeps the code for later', async () => {
    setFlag(false);
    setUrl('/?ref=K7Q2PX9A');
    capturePendingReferral();
    await redeemPendingReferral();
    expect(post).not.toHaveBeenCalled();
    expect(getPendingReferral()).toBe('K7Q2PX9A');
  });
});
