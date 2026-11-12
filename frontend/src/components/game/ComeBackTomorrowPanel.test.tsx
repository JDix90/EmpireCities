/**
 * The reminder ask on the game-over panel (guest_push_reminders_enabled). A
 * guest has no email, so a browser notification is the only reminder they can
 * get, and the browser shows its permission prompt only from a click. The ask
 * appears to a guest only when that click can lead somewhere, and "Not now"
 * shares the 30-day snooze with the other push prompts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import toast from 'react-hot-toast';
import ComeBackTomorrowPanel from './ComeBackTomorrowPanel';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';

const apiGet = vi.fn();
const apiPost = vi.fn(async () => ({ data: {} }));
vi.mock('../../services/api', () => ({ api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...(a as [])) } }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const push = vi.hoisted(() => ({ status: 'default' as string, homeScreen: false, enable: vi.fn() }));
vi.mock('../../services/pushNotifications', () => ({
  getWebPushStatus: () => push.status,
  needsHomeScreenInstall: () => push.homeScreen,
  enableWebPush: () => push.enable(),
}));

const comeback = (isGuest: boolean) => ({
  data: {
    is_guest: isGuest,
    daily_streak: 1,
    played_today: true,
    next_streak_milestone: { day: 3, gold: 50 },
    tomorrow_login_reward: isGuest ? null : 15,
    already_claimed_today: isGuest ? null : true,
    daily_challenge_done_today: true,
    streak_freezes: null,
  },
});

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, guest_push_reminders_enabled: on } }));

async function renderPanel(isGuest = true) {
  apiGet.mockResolvedValue(comeback(isGuest));
  render(
    <MemoryRouter>
      <ComeBackTomorrowPanel />
    </MemoryRouter>,
  );
  await screen.findByText('Tomorrow awaits');
}

describe('ComeBackTomorrowPanel reminder ask', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    push.status = 'default';
    push.homeScreen = false;
    push.enable.mockReset().mockResolvedValue('granted');
    setFlag(true);
  });

  it('asks a guest, and the click turns notifications on', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("We'll remind you before your streak ends"));
    expect(push.enable).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Remind me' })).not.toBeInTheDocument();
  });

  it('"Not now" snoozes it, and a snoozed ask stays away', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(getPushNudgeDismissedAt()).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Reminders' })).not.toBeInTheDocument();
  });

  it('stays away after a recent "Not now" on another push prompt', async () => {
    markPushNudgeDismissed();
    await renderPanel();
    expect(screen.queryByRole('region', { name: 'Reminders' })).not.toBeInTheDocument();
  });

  it('says so when the browser blocks it', async () => {
    push.enable.mockResolvedValue('denied');
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remind me' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Reminders' })).not.toBeInTheDocument();
  });

  it('gives Home Screen advice on an iPhone tab', async () => {
    push.status = 'unsupported';
    push.homeScreen = true;
    await renderPanel();
    expect(screen.getByText(/Add Borderfall to your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remind me' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('is not shown where a click could not lead anywhere', async () => {
    apiGet.mockResolvedValue(comeback(true));
    for (const status of ['granted', 'denied', 'unconfigured', 'unsupported']) {
      push.status = status;
      const { unmount } = render(
        <MemoryRouter>
          <ComeBackTomorrowPanel />
        </MemoryRouter>,
      );
      await screen.findByText('Tomorrow awaits');
      expect(screen.queryByRole('region', { name: 'Reminders' }), status).not.toBeInTheDocument();
      unmount();
    }
  });

  it('is not shown with the flag off', async () => {
    setFlag(false);
    await renderPanel();
    expect(screen.queryByRole('region', { name: 'Reminders' })).not.toBeInTheDocument();
  });

  it('is not shown after a game that set no streak, which no reminder would follow', async () => {
    apiGet.mockResolvedValue({ data: { ...comeback(true).data, daily_streak: 0 } });
    render(
      <MemoryRouter>
        <ComeBackTomorrowPanel />
      </MemoryRouter>,
    );
    await screen.findByText('Tomorrow awaits');
    expect(screen.queryByRole('region', { name: 'Reminders' })).not.toBeInTheDocument();
  });

  it('is not shown to an account', async () => {
    await renderPanel(false);
    expect(screen.queryByRole('region', { name: 'Reminders' })).not.toBeInTheDocument();
  });
});

describe('ComeBackTomorrowPanel funnel events (funnel_events_v2_enabled)', () => {
  const posted = (event: string) =>
    apiPost.mock.calls.filter((c) => (c as unknown as [string, { event: string }])[1]?.event === event).map((c) => (c as unknown as [string, { properties: Record<string, string> }])[1].properties);

  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset();
    apiPost.mockClear();
    push.status = 'default';
    push.homeScreen = false;
    setFlag(true);
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, funnel_events_v2_enabled: true } }));
  });

  it('records the panel shown once, the reminder ask shown, and "Not now"', async () => {
    await renderPanel();
    expect(posted('tomorrow_panel_shown')).toEqual([{ is_guest: 'true', daily_streak: '1', daily_open: 'false' }]);
    expect(posted('push_ask_shown')).toEqual([{ surface: 'results', ios_tab: 'false' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(posted('push_ask_dismissed')).toEqual([{ surface: 'results', ios_tab: 'false' }]);
  });

  it('records a press on the Daily Challenge link', async () => {
    apiGet.mockResolvedValue({ data: { ...comeback(true).data, daily_challenge_done_today: false } });
    render(<MemoryRouter><ComeBackTomorrowPanel /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('link', { name: 'Daily Challenge' }));
    expect(posted('daily_link_clicked')).toEqual([{ surface: 'tomorrow' }]);
  });

  it('records nothing with the flag off', async () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, funnel_events_v2_enabled: false } }));
    await renderPanel();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
