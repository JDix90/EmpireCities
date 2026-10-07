/**
 * The Custom Game form's round limit (custom_round_cap_enabled): by default
 * the one Quick Match gives the chosen ending, or one the host picks, or none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function setFlags(flags: { roundCap: boolean; fold?: boolean }) {
  useFeatureFlagsStore.setState((s) => ({
    flags: { ...s.flags, custom_round_cap_enabled: flags.roundCap, custom_lobby_fold_enabled: !!flags.fold },
  }));
}

function renderAt(query: string) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp: 50 } as never,
    isAuthenticated: true,
  });
  // `?era=` opens the Custom Game form on mount.
  return render(
    <MemoryRouter initialEntries={[`/lobby?${query}`]}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

const limit = () => document.getElementById('create-game-round-limit') as HTMLSelectElement | null;
const note = () => screen.getByTestId('create-game-round-limit-note').textContent;

function tick(id: string) {
  fireEvent.click(document.getElementById(id)!);
}

async function created(): Promise<Record<string, unknown>> {
  postMock.mockClear();
  fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
  await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
  const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
  return body.settings;
}

describe('LobbyPage Custom Game: the round limit', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    localStorage.clear();
    setFlags({ roundCap: true });
  });

  it('is not there with the flag off, and the game has no limit, as before', async () => {
    setFlags({ roundCap: false });
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    expect(limit()).toBeNull();
    expect(await created()).not.toHaveProperty('max_turns');
  });

  it("starts at Domination's Quick Match limit, and says what it means", async () => {
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    expect(limit()!.value).toBe('auto');
    expect(limit()!.selectedOptions[0]!.textContent).toBe('120 rounds, as in Quick Match');
    expect(note()).toBe('If nobody has won by the end of turn 120, the player holding the most territories wins.');
    expect(await created()).toMatchObject({ allowed_victory_conditions: ['domination'], max_turns: 120 });
  });

  it('follows the endings ticked until the host picks one', async () => {
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    tick('create-game-victory-threshold');
    expect(limit()!.selectedOptions[0]!.textContent).toBe('60 rounds, as in Quick Match');
    fireEvent.change(document.getElementById('vthr')!, { target: { value: '50' } });
    expect(limit()!.selectedOptions[0]!.textContent).toBe('45 rounds, as in Quick Match');
    expect(await created()).toMatchObject({ victory_threshold: 50, max_turns: 45 });
    // A limit the host picks stays put whatever is ticked.
    fireEvent.change(limit()!, { target: { value: '150' } });
    tick('create-game-victory-capital');
    expect(note()).toBe('If nobody has won by the end of turn 150, the player holding the most territories wins.');
    expect(await created()).toMatchObject({ max_turns: 150 });
  });

  it('sends no limit when the host asks for none', async () => {
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    fireEvent.change(limit()!, { target: { value: 'none' } });
    expect(note()).toMatch(/Against bots, a Domination game seldom does/);
    expect(await created()).not.toHaveProperty('max_turns');
  });

  it("leaves Space Age to the server's own limit", async () => {
    renderAt('era=space_age');
    await screen.findByText('Victory conditions');
    expect(limit()).toBeNull();
    expect(screen.getByTestId('create-game-extra-endings').textContent).toMatch(/end of turn 90/);
    expect(await created()).not.toHaveProperty('max_turns');
  });

  it('stays in view with the advanced options folded', async () => {
    setFlags({ roundCap: true, fold: true });
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    expect(screen.getByTestId('create-game-advanced-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(limit()).not.toBeNull();
    expect(await created()).toMatchObject({ max_turns: 120 });
  });
});
