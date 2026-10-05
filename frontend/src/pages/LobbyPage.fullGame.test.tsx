import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import { DEFAULT_FULL_GAME_PREFS, saveFullGamePrefs } from '../utils/quickMatchPrefs';

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

function setEvening(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, full_game_evening_enabled: on } }));
}

function renderLobby() {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp: 500 } as never,
    isAuthenticated: true,
  });
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

async function openFullGame() {
  fireEvent.click(await screen.findByTestId('full-game-start'));
  return screen.findByTestId('full-game-play');
}

async function startFullGame() {
  fireEvent.click(await openFullGame());
  await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
  return (postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> }).settings;
}

describe('LobbyPage Full Game length', () => {
  beforeEach(() => {
    localStorage.clear();
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    stubMatchMedia();
    setEvening(false);
  });

  it('with the flag off, is Full Game as before: the whole board, 150 rounds', async () => {
    renderLobby();
    await openFullGame();
    expect(screen.queryByText('Up to 80 rounds')).toBeNull();
    const settings = await startFullGame();
    expect(settings.allowed_victory_conditions).toEqual(['domination']);
    expect(settings.victory_threshold).toBeUndefined();
    expect(settings.max_turns).toBe(150);
  });

  it('with the flag on, defaults a player with no setup of their own to the 65% ending, capped at 80 rounds', async () => {
    setEvening(true);
    renderLobby();
    await openFullGame();
    expect(screen.getByText('Up to 80 rounds')).toBeTruthy();
    const settings = await startFullGame();
    expect(settings.allowed_victory_conditions).toEqual(['domination', 'threshold']);
    expect(settings.victory_threshold).toBe(65);
    expect(settings.max_turns).toBe(80);
  });

  it('keeps an ending the player saved, under the 80-round cap', async () => {
    saveFullGamePrefs({ ...DEFAULT_FULL_GAME_PREFS, victory: 'conquest' });
    setEvening(true);
    renderLobby();
    const settings = await startFullGame();
    expect(settings.allowed_victory_conditions).toEqual(['domination']);
    expect(settings.max_turns).toBe(80);
  });

  it('takes the new default when the flags land after the lobby has painted', async () => {
    renderLobby();
    await screen.findByTestId('full-game-start');
    act(() => setEvening(true));
    const settings = await startFullGame();
    expect(settings.victory_threshold).toBe(65);
    expect(settings.max_turns).toBe(80);
  });
});
