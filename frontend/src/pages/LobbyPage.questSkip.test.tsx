import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ONBOARDING_QUESTS } from '@borderfall/shared';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

/**
 * "Skip all" on the lobby's quest banner (quest_banner_skip_enabled): it goes
 * at the press and stays gone on the next visit, however the lobby picks the
 * quest it shows (lobby_cleanup_enabled or not).
 *
 * `server` stands in for the two routes as they answer with the flag on:
 * POST /progression/onboarding/skip stores the skip, and
 * GET /progression/quests reports it as `skipped`.
 */

const server = vi.hoisted(() => ({
  skipped: false,
  /** Off, the routes answer as they did: the skip is refused and /quests has no `skipped`. */
  flagOn: true,
}));

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
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

function setFlags(skipSticks: boolean, lobbyCleanup: boolean) {
  server.flagOn = skipSticks;
  useFeatureFlagsStore.setState((s) => ({
    flags: { ...s.flags, quest_banner_skip_enabled: skipSticks, lobby_cleanup_enabled: lobbyCleanup },
  }));
}

/** No quest done yet, as for a player who has only just started. */
const QUESTS = ONBOARDING_QUESTS.map((q) => ({ ...q, completed_at: null, is_current: false, is_locked: false }));

function wireServer() {
  getMock.mockImplementation((url: string) => {
    if (url === '/progression/quests') {
      return Promise.resolve({ data: server.flagOn ? { quests: QUESTS, skipped: server.skipped } : { quests: QUESTS } });
    }
    return Promise.reject(new Error('offline'));
  });
  postMock.mockImplementation((url: string) => {
    if (url === '/progression/onboarding/skip') {
      if (!server.flagOn) {
        return Promise.reject(Object.assign(new Error('400'), { response: { status: 400, data: { error: 'Complete the tutorial before skipping' } } }));
      }
      server.skipped = true;
      return Promise.resolve({ data: { onboarding_stage: 3 } });
    }
    return Promise.resolve({ data: {} });
  });
}

/** One visit to the lobby: a fresh mount, which asks the server for the quests again. */
function visitLobby(isGuest = false) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', level: 1, xp: 120, mmr: 1000, is_admin: false, is_guest: isGuest } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

const banner = () => screen.queryByText(/^Getting Started — \d+\/\d+$/);
const questsAsked = () => getMock.mock.calls.filter(([url]) => url === '/progression/quests').length;
/** The quests request has been answered and the lobby has rendered what it said. */
async function questsLoaded(times: number) {
  await waitFor(() => expect(questsAsked()).toBe(times));
  await waitFor(() => expect(getMock.mock.results.at(-1)).toBeDefined());
  // Let the awaited response land in state.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LobbyPage quest banner "Skip all"', () => {
  beforeEach(() => {
    localStorage.clear();
    getMock.mockReset();
    postMock.mockReset();
    server.skipped = false;
    stubMatchMedia();
    wireServer();
  });

  for (const lobbyCleanup of [false, true]) {
    const mode = lobbyCleanup ? 'with lobby_cleanup_enabled' : 'without lobby_cleanup_enabled';

    it(`hides the banner at the press and keeps it hidden on the next visit (${mode})`, async () => {
      setFlags(true, lobbyCleanup);
      const first = visitLobby();
      await waitFor(() => expect(banner()).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
      await waitFor(() => expect(banner()).toBeNull());
      expect(postMock).toHaveBeenCalledWith('/progression/onboarding/skip');
      first.unmount();

      visitLobby();
      await questsLoaded(2);
      expect(banner()).toBeNull();
    });
  }

  it('hides it for a guest too', async () => {
    setFlags(true, true);
    const first = visitLobby(true);
    await waitFor(() => expect(banner()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    await waitFor(() => expect(banner()).toBeNull());
    first.unmount();

    visitLobby(true);
    await questsLoaded(2);
    expect(banner()).toBeNull();
  });

  it('shows the banner to a player who has not skipped', async () => {
    setFlags(true, true);
    visitLobby();
    await questsLoaded(1);
    expect(banner()).toBeInTheDocument();
  });

  it('still hides it for this visit when the server cannot be reached', async () => {
    setFlags(true, true);
    postMock.mockImplementation(() => Promise.reject(new Error('offline')));
    visitLobby();
    await waitFor(() => expect(banner()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    await waitFor(() => expect(banner()).toBeNull());
  });

  describe('with the flag off, as before', () => {
    it('hides it until the next visit, and then shows it again', async () => {
      setFlags(false, false);
      const first = visitLobby();
      await waitFor(() => expect(banner()).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Skip all' }));
      await waitFor(() => expect(banner()).toBeNull());
      first.unmount();

      visitLobby();
      await questsLoaded(2);
      expect(banner()).toBeInTheDocument();
    });

    it('does not read `skipped` from the quests', async () => {
      setFlags(false, true);
      // A server already running with the flag on, ahead of this client's flags.
      server.flagOn = true;
      server.skipped = true;
      visitLobby();
      await questsLoaded(1);
      expect(banner()).toBeInTheDocument();
    });
  });
});
