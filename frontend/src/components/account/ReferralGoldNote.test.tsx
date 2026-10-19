import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { capturePendingReferral } from '../../utils/pendingReferral';
import ReferralGoldNote from './ReferralGoldNote';

function setFlag(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, player_links_play_enabled: on } }));
}

describe('ReferralGoldNote', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  function withPendingCode() {
    window.history.pushState({}, '', '/?ref=K7Q2PX9A');
    capturePendingReferral();
    window.history.pushState({}, '', '/');
  }

  it('tells a referred player what saving their account adds', () => {
    setFlag(true);
    withPendingCode();
    const { container } = render(<ReferralGoldNote action="save" />);
    expect(container.textContent).toBe('A friend invited you. Save your account to get 25 gold.');
  });

  it('says create on the register page', () => {
    setFlag(true);
    withPendingCode();
    const { container } = render(<ReferralGoldNote action="create" />);
    expect(container.textContent).toBe('A friend invited you. Create your account to get 25 gold.');
  });

  it('says nothing without a waiting code, or with the flag off', () => {
    setFlag(true);
    const { container, unmount } = render(<ReferralGoldNote action="save" />);
    expect(container.textContent).toBe('');
    unmount();
    setFlag(false);
    withPendingCode();
    render(<ReferralGoldNote action="save" />);
    expect(screen.queryByText(/A friend invited you/)).toBeNull();
  });
});
