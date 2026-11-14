import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

/**
 * Who the lobby treats as a new player (lobby_new_player_gate_enabled).
 *
 * The profiles here are the server's: sign-in answers with no
 * `onboarding_stage`, and /users/me then sends it as a number, never null
 * (COALESCE(onboarding_stage, 0)). Every assertion is made after that refresh
 * has landed, because the old check, `onboarding_stage != null`, only went
 * wrong once it had.
 */

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../services/mapService', () => ({
  fetchMapById: vi.fn(() => Promise.reject(new Error('offline'))),
}));

function stubMatchMedia() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function setFlags(gate: boolean, todayPanel = false) {
  useFeatureFlagsStore.setState((s) => ({
    flags: { ...s.flags, lobby_new_player_gate_enabled: gate, today_panel_enabled: todayPanel },
  }));
}

interface Profile {
  xp: number;
  level: number;
  onboarding_stage: number;
  has_completed_tutorial: boolean;
}

/** No finished game, no tutorial: the row a new account has. */
const BRAND_NEW: Profile = { xp: 0, level: 1, onboarding_stage: 0, has_completed_tutorial: false };
/** Has played, and the stage says onboarding is over (what /progression/onboarding/skip writes). */
const PLAYED_STAGE_DONE: Profile = { xp: 120, level: 1, onboarding_stage: 3, has_completed_tutorial: true };
/** Has played, and the stage is where the server leaves it: nothing moves it off 0. */
const PLAYED_STAGE_ZERO: Profile = { xp: 120, level: 1, onboarding_stage: 0, has_completed_tutorial: true };

/** What GET /progression/comeback answers a registered player (TodayPanel). */
const COMEBACK = {
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

/**
 * Renders the lobby for a registered player as it is after sign-in and the
 * profile refresh that follows: the store starts with what POST /auth/login
 * returns, and /users/me answers with the full profile.
 */
async function renderLobbyAs(profile: Profile) {
  const identity = { user_id: 'u1', username: 'commander', mmr: 1000, is_admin: false };
  getMock.mockImplementation((url: string) => {
    if (url === '/users/me') {
      return Promise.resolve({
        data: {
          ...identity,
          ...profile,
          is_guest: false,
          gold: 0,
          win_streak: 0,
          daily_streak: 0,
          prestige: 0,
          ratings: {},
          tutorial_modules_completed: profile.has_completed_tutorial ? ['core'] : [],
        },
      });
    }
    if (url === '/progression/comeback') return Promise.resolve({ data: COMEBACK });
    return Promise.reject(new Error('offline'));
  });
  useAuthStore.setState({
    user: { ...identity, xp: profile.xp, level: profile.level } as never,
    isAuthenticated: true,
  });
  const view = render(
    <MemoryRouter initialEntries={['/lobby']}>
      <LobbyPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(useAuthStore.getState().user?.onboarding_stage).toBe(profile.onboarding_stage));
  return view;
}

const gettingStarted = () => screen.queryByRole('heading', { name: 'Getting Started' });
/** The Daily Challenge card beside the lobby, which a new player does not get (the card that stands in for TodayPanel). */
const dailyCard = () =>
  screen.queryAllByRole('link').find((a) => a.getAttribute('href') === '/daily' && /Daily Challenge/.test(a.textContent ?? ''));

describe('LobbyPage new-player layout', () => {
  beforeEach(() => {
    localStorage.clear();
    getMock.mockReset();
    stubMatchMedia();
  });

  it('gives a brand-new player Getting Started, and no Daily Challenge card beside it', async () => {
    setFlags(true);
    await renderLobbyAs(BRAND_NEW);
    expect(gettingStarted()).toBeInTheDocument();
    expect(dailyCard()).toBeUndefined();
  });

  it('gives a player with XP and a finished onboarding stage the regular lobby', async () => {
    setFlags(true);
    await renderLobbyAs(PLAYED_STAGE_DONE);
    expect(gettingStarted()).toBeNull();
    expect(dailyCard()).toBeDefined();
  });

  it('does not wait on the onboarding stage: a player with XP at stage 0 gets the regular lobby too', async () => {
    // The stage every account that has only played holds, so the one a fix
    // keyed on `onboarding_stage < 3` would still call new.
    setFlags(true);
    await renderLobbyAs(PLAYED_STAGE_ZERO);
    expect(gettingStarted()).toBeNull();
    expect(dailyCard()).toBeDefined();
  });

  it('answers the same before the profile refresh as after it', async () => {
    setFlags(true);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    getMock.mockImplementation(() => held.then(() => Promise.reject(new Error('offline'))));
    // As POST /auth/login leaves the store: no onboarding_stage at all.
    useAuthStore.setState({
      user: { user_id: 'u1', username: 'commander', level: 1, xp: 120, mmr: 1000, is_admin: false } as never,
      isAuthenticated: true,
    });
    render(
      <MemoryRouter initialEntries={['/lobby']}>
        <LobbyPage />
      </MemoryRouter>,
    );
    expect(useAuthStore.getState().user?.onboarding_stage).toBeUndefined();
    expect(gettingStarted()).toBeNull();
    expect(dailyCard()).toBeDefined();
    release();
  });

  it('passes the same answer to the Today panel: its Daily Challenge row is for players who are not new', async () => {
    setFlags(true, true);
    const veteran = await renderLobbyAs(PLAYED_STAGE_DONE);
    await screen.findByTestId('today-panel');
    expect(screen.getByTestId('daily-challenge-row')).toBeInTheDocument();
    veteran.unmount();

    await renderLobbyAs(BRAND_NEW);
    await screen.findByTestId('today-panel');
    expect(screen.queryByTestId('daily-challenge-row')).toBeNull();
  });

  it('changes nothing while the flag is off: every refreshed profile still gets Getting Started', async () => {
    setFlags(false);
    await renderLobbyAs(PLAYED_STAGE_DONE);
    expect(gettingStarted()).toBeInTheDocument();
    expect(dailyCard()).toBeUndefined();
  });
});
