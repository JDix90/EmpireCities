import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LeaderboardsPage from './LeaderboardsPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a) },
}));

function setFlags(ranked: boolean, guestUpsell: boolean) {
  const s = useFeatureFlagsStore.getState();
  useFeatureFlagsStore.setState({
    ...s,
    flags: { ...s.flags, ranked_leaderboard_enabled: ranked, guest_account_upsell_enabled: guestUpsell },
  });
}

function renderPage({ url = '/leaderboards', isGuest = false } = {}) {
  useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: isGuest } as never });
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LeaderboardsPage />
    </MemoryRouter>,
  );
}

/**
 * Board requests the page made, ignoring /my-rank. Ranked and Solo share the
 * `/leaderboards/rating` endpoint and are told apart ONLY by the `type` param
 * (`solo` for Solo, absent for Ranked) — so a bare URL check cannot distinguish
 * "fell back to Solo" from "loaded the hidden Ranked board".
 */
function boardCalls(): { url: string; type?: string }[] {
  return getMock.mock.calls
    .map((c) => ({
      url: String(c[0]),
      type: (c[1] as { params?: { type?: string } } | undefined)?.params?.type,
    }))
    .filter((c) => c.url.startsWith('/leaderboards/') && c.url !== '/leaderboards/my-rank');
}

/** True if the ranked ladder itself was fetched. */
function requestedRanked(): boolean {
  return boardCalls().some((c) => c.url === '/leaderboards/rating' && c.type === undefined);
}

describe('LeaderboardsPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue({ data: { entries: [] } });
  });

  it('shows the Ranked tab when the flag is on', async () => {
    setFlags(true, false);
    renderPage();
    expect(await screen.findByRole('button', { name: /Ranked/ })).toBeInTheDocument();
  });

  it('hides the Ranked tab when the flag is off', async () => {
    setFlags(false, false);
    renderPage();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Ranked/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Solo/ })).toBeInTheDocument();
  });

  it('falls back to a visible board rather than loading the hidden default', async () => {
    setFlags(false, false);
    renderPage();
    // 'rating' is BOTH the default tab and the one the flag removes, so an
    // unfiltered read would silently fetch a board with no tab to leave it by.
    await waitFor(() => expect(boardCalls().length).toBeGreaterThan(0));
    expect(requestedRanked()).toBe(false);
  });

  it('falls back from a stale ?tab=rating link when ranked is hidden', async () => {
    setFlags(false, false);
    renderPage({ url: '/leaderboards?tab=rating' });
    await waitFor(() => expect(boardCalls().length).toBeGreaterThan(0));
    expect(requestedRanked()).toBe(false);
  });

  it('honours ?tab=rating when ranked is visible', async () => {
    setFlags(true, false);
    renderPage({ url: '/leaderboards?tab=rating' });
    await waitFor(() => expect(boardCalls().length).toBeGreaterThan(0));
    expect(requestedRanked()).toBe(true);
  });

  it('tells a guest they do not place, with a way to fix it', async () => {
    setFlags(false, true);
    renderPage({ isGuest: true });
    expect(await screen.findByText(/Guests do not appear on the leaderboards/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create Free Account/ })).toHaveAttribute('href', '/upgrade');
  });

  it('stays silent for a guest while the upsell flag is off', async () => {
    setFlags(false, false);
    renderPage({ isGuest: true });
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByText(/Guests do not appear on the leaderboards/)).not.toBeInTheDocument();
  });

  it('never shows the guest notice to a registered player', async () => {
    setFlags(false, true);
    renderPage({ isGuest: false });
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByText(/Guests do not appear on the leaderboards/)).not.toBeInTheDocument();
  });
});
