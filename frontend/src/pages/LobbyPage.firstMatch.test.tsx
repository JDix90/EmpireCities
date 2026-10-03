import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import { FIRST_MATCH_BUTTON_LINE } from '../utils/firstMatch';
import { QUICK_MATCH_ERAS } from '../constants/lobbyMapOptions';
import { saveQuickMatchPrefs } from '../utils/quickMatchPrefs';

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

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function stubMatchMedia() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

function setFlag(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, first_match_easy_enabled: on } }));
}

/** Answers the stats check with `played` finished games; everything else is offline. */
function finishedGames(played: number) {
  getMock.mockImplementation((url: string) =>
    url === '/users/me/stats'
      ? Promise.resolve({ data: { overall: { played, won: 0, win_rate: 0 } } })
      : Promise.reject(new Error('offline')),
  );
}

function renderLobby() {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: true, xp: 50 } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

async function startQuickMatch(line: RegExp | string) {
  const button = (await screen.findByText(line)).closest('button')!;
  fireEvent.click(button);
  await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
  return postMock.mock.calls.find(([url]) => url === '/games')![1] as {
    era_id: string;
    map_id: string;
    max_players: number;
    ai_count: number;
    ai_difficulty: string;
    settings: Record<string, unknown>;
  };
}

describe('LobbyPage first match', () => {
  beforeEach(() => {
    localStorage.clear();
    getMock.mockReset();
    postMock.mockReset();
    navigateMock.mockReset();
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    stubMatchMedia();
  });

  it('makes a newcomer\'s Quick Match one Easy bot on Great Britain, and says so', async () => {
    setFlag(true);
    finishedGames(0);
    renderLobby();
    const body = await startQuickMatch(FIRST_MATCH_BUTTON_LINE);
    expect(body).toMatchObject({
      era_id: 'medieval',
      map_id: 'community_britain_925',
      max_players: 2,
      ai_count: 1,
      ai_difficulty: 'easy',
    });
    expect(body.settings).toMatchObject({
      first_match: true,
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
    });
  });

  it('leaves Quick Match alone once the player has finished a game', async () => {
    setFlag(true);
    finishedGames(1);
    renderLobby();
    const body = await startQuickMatch(/vs 3 AI · random era/);
    expect(QUICK_MATCH_ERAS as readonly string[]).toContain(body.era_id);
    expect(body).toMatchObject({ ai_count: 3, ai_difficulty: 'medium' });
    expect(body.settings.first_match).toBeUndefined();
    expect(screen.queryByText(FIRST_MATCH_BUTTON_LINE)).toBeNull();
  });

  it('changes nothing while the flag is off, and does not ask', async () => {
    setFlag(false);
    finishedGames(0);
    renderLobby();
    const body = await startQuickMatch(/vs 3 AI · random era/);
    expect(body.settings.first_match).toBeUndefined();
    expect(body.ai_count).toBe(3);
    expect(getMock).not.toHaveBeenCalledWith('/users/me/stats');
  });

  it("keeps a player's own Quick Match setup", async () => {
    setFlag(true);
    finishedGames(0);
    saveQuickMatchPrefs({ aiCount: 2, aiDifficulty: 'hard', victory: 'blitz' });
    renderLobby();
    const body = await startQuickMatch(/vs 2 AI · random era/);
    expect(body).toMatchObject({ ai_count: 2, ai_difficulty: 'hard' });
    expect(body.settings.first_match).toBeUndefined();
  });
});
