import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';

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

/** Every opt-in rule in the Custom Game form, by checkbox id. */
const ADVANCED_FEATURE_IDS = [
  'territory-draft-top',
  'asymmetric-factions-top',
  'create-game-economy',
  'create-game-tech-trees',
  'create-game-events',
  'create-game-naval',
  'create-game-stability',
  'create-game-fog',
  'create-game-diplomacy',
  'create-game-coaching',
] as const;

function renderCustomGame() {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp: 50 } as never,
    isAuthenticated: true,
  });
  // `?era=` opens the Custom Game form on mount, as the era gallery's deep links do.
  return render(
    <MemoryRouter initialEntries={['/lobby?era=ww2']}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

function checkbox(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox #${id}`);
  return el;
}

describe('LobbyPage Custom Game defaults', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    navigateMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it('starts every advanced feature unchecked, Diplomacy included', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    for (const id of ADVANCED_FEATURE_IDS) {
      expect({ id, checked: checkbox(id).checked }).toEqual({ id, checked: false });
    }
  });

  it('creates a game with diplomacy off unless the player ticks it', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    // Sent explicitly: the create route defaults an omitted flag to ON.
    expect(body.settings.diplomacy_enabled).toBe(false);
  });

  it('still lets the player turn Diplomacy on', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    fireEvent.click(checkbox('create-game-diplomacy'));
    expect(checkbox('create-game-diplomacy').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    expect(body.settings.diplomacy_enabled).toBe(true);
  });
});
