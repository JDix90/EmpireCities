import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPanel from './TodayPanel';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { useAuthStore } from '../../store/authStore';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
  },
}));

const baseComeback = {
  is_guest: false,
  daily_streak: 5,
  played_today: false,
  next_streak_milestone: { day: 7, gold: 75 },
  tomorrow_login_reward: 20,
  today_login_reward: 15,
  login_streak: 2,
  already_claimed_today: false,
  daily_challenge_done_today: false,
  streak_freezes: 0,
  streak_freeze_used_on: null,
  streak_freeze_price: 50,
  streak_freeze_max: 2,
  streak_freezes_purchasable: true,
};

function setFlags(overrides: Partial<{ streak_freezes_enabled: boolean; async_onboarding_enabled: boolean }>) {
  const s = useFeatureFlagsStore.getState();
  useFeatureFlagsStore.setState({
    ...s,
    flags: {
      ...s.flags,
      streak_freezes_enabled: false,
      async_onboarding_enabled: false,
      ...overrides,
    },
  });
}

function renderPanel(props: Partial<Parameters<typeof TodayPanel>[0]> = {}, comeback: Record<string, unknown> = {}) {
  getMock.mockResolvedValue({ data: { ...baseComeback, ...comeback } });
  postMock.mockResolvedValue({ data: {} });
  const onStartAsyncGame = vi.fn();
  render(
    <MemoryRouter>
      <TodayPanel
        isNewUser={false}
        dailySummary={{ era_id: 'ancient', attempts_today: 3, completed: false }}
        hasActiveAsyncGames={false}
        onStartAsyncGame={onStartAsyncGame}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onStartAsyncGame };
}

describe('TodayPanel', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    setFlags({});
    useAuthStore.setState({ user: null });
  });

  it('shows streak, claimable chest, and daily challenge; reports today_panel_shown', async () => {
    renderPanel();
    expect(await screen.findByText(/5-day play streak/)).toBeInTheDocument();
    expect(screen.getByText(/Claim 15 gold/)).toBeInTheDocument();
    expect(screen.getByText('Daily Challenge')).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/analytics/ui-event', { event: 'today_panel_shown' });
  });

  it('renders nothing for guests', async () => {
    renderPanel({}, { is_guest: true });
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByTestId('today-panel')).not.toBeInTheDocument();
  });

  it('hides the daily-challenge row for new users', async () => {
    renderPanel({ isNewUser: true });
    await screen.findByText(/5-day play streak/);
    expect(screen.queryByTestId('daily-challenge-row')).not.toBeInTheDocument();
  });

  it('shows claimed state with tomorrow tease when the chest is gone', async () => {
    renderPanel({}, { already_claimed_today: true });
    expect(await screen.findByText(/Login chest claimed/)).toBeInTheDocument();
    expect(screen.getByText(/20 gold/)).toBeInTheDocument();
  });

  it('hides the freeze row when the flag is off', async () => {
    renderPanel();
    await screen.findByText(/5-day play streak/);
    expect(screen.queryByTestId('freeze-row')).not.toBeInTheDocument();
  });

  it('offers a freeze buy when flagged on, and reports the click', async () => {
    setFlags({ streak_freezes_enabled: true });
    renderPanel();
    const buy = await screen.findByText(/Buy · 50 gold/);
    postMock.mockResolvedValueOnce({ data: {} }); // ui-event
    postMock.mockResolvedValueOnce({ data: { streak_freezes: 1, gold: 70 } });
    fireEvent.click(buy);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/analytics/ui-event', { event: 'streak_freeze_buy_clicked' }),
    );
    expect(postMock).toHaveBeenCalledWith('/progression/streak-freeze');
    expect(await screen.findByText(/1 streak freeze armed/)).toBeInTheDocument();
  });

  it('shows held freezes without a buy button at the cap', async () => {
    setFlags({ streak_freezes_enabled: true });
    renderPanel({}, { streak_freezes: 2 });
    expect(await screen.findByText(/2 streak freezes armed/)).toBeInTheDocument();
    expect(screen.queryByText(/Buy · 50 gold/)).not.toBeInTheDocument();
  });

  it('surfaces the freeze-saved notice when a freeze bridged yesterday', async () => {
    setFlags({ streak_freezes_enabled: true });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    renderPanel({}, { streak_freeze_used_on: yesterday, streak_freezes: 1 });
    expect(await screen.findByTestId('freeze-saved-notice')).toBeInTheDocument();
  });

  it('hides the async row when the flag is off', async () => {
    renderPanel();
    await screen.findByText(/5-day play streak/);
    expect(screen.queryByTestId('async-cta-row')).not.toBeInTheDocument();
  });

  it('shows the async row when flagged on and no async games are running; click opens the modal and reports', async () => {
    setFlags({ async_onboarding_enabled: true });
    const { onStartAsyncGame } = renderPanel();
    const row = await screen.findByTestId('async-cta-row');
    fireEvent.click(row);
    expect(onStartAsyncGame).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/analytics/ui-event', {
      event: 'async_cta_clicked',
      properties: { source: 'today_panel' },
    });
  });

  it('hides the async row when an async game is already running', async () => {
    setFlags({ async_onboarding_enabled: true });
    renderPanel({ hasActiveAsyncGames: true });
    await screen.findByText(/5-day play streak/);
    expect(screen.queryByTestId('async-cta-row')).not.toBeInTheDocument();
  });
});
