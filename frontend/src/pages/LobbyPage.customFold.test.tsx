/**
 * The Custom Game form's Advanced fold (custom_lobby_fold_enabled): the main
 * choices in view, the rest under Advanced, and the same game created either
 * way.
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

/** Everything the fold holds in a WW2 game with bots, by checkbox id. */
const FOLDED_IDS = [
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
  'create-game-uncapped-card-sets',
] as const;

const VICTORY_IDS = [
  'create-game-victory-domination',
  'create-game-victory-threshold',
  'create-game-victory-capital',
  'create-game-victory-secret_mission',
] as const;

function setFold(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, custom_lobby_fold_enabled: on } }));
}

function renderAt(query: string) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp: 50 } as never,
    isAuthenticated: true,
  });
  // `?era=` and `?map=` open the Custom Game form on mount.
  return render(
    <MemoryRouter initialEntries={[`/lobby?${query}`]}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

function checkbox(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox #${id}`);
  return el;
}

const toggle = () => screen.getByTestId('create-game-advanced-toggle');
const summary = () => screen.queryByTestId('create-game-advanced-summary')?.textContent;

async function created(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
  await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
  return postMock.mock.calls.find(([url]) => url === '/games')![1] as Record<string, unknown>;
}

describe('LobbyPage Custom Game: the Advanced fold', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    localStorage.clear();
    setFold(true);
  });

  it('is not there with the flag off: the form is as it was', async () => {
    setFold(false);
    renderAt('era=ww2');
    await screen.findByText('Advanced Features');
    expect(screen.queryByTestId('create-game-advanced-toggle')).toBeNull();
    for (const id of FOLDED_IDS) expect(document.getElementById(id)).not.toBeNull();
  });

  it('starts closed in a plain game, with the main choices in view and the rest folded', async () => {
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(summary()).toBe('All off');
    expect(screen.queryByText('Advanced Features')).toBeNull();
    for (const id of FOLDED_IDS) expect({ id, shown: document.getElementById(id) !== null }).toEqual({ id, shown: false });
    for (const id of VICTORY_IDS) expect(checkbox(id)).toBeInTheDocument();
    expect(screen.getByText('Rules Era')).toBeInTheDocument();
    expect(screen.getByText('AI Opponents')).toBeInTheDocument();
    expect(screen.getByText('AI Difficulty')).toBeInTheDocument();
    expect(screen.getByText('Turn Timer')).toBeInTheDocument();
  });

  it('opens to every folded option, unchanged, and closed names what is on', async () => {
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    for (const id of FOLDED_IDS) expect({ id, checked: checkbox(id).checked }).toEqual({ id, checked: false });
    fireEvent.click(checkbox('create-game-fog'));
    fireEvent.click(checkbox('create-game-naval'));
    fireEvent.click(toggle());
    // Naval needs Economy, which it switches on: both are named.
    expect(summary()).toBe('Economy & Buildings, Naval Warfare, Fog of War');
  });

  it('creates exactly the game the form without it creates, for the same choices', async () => {
    const choose = ['create-game-fog', 'create-game-diplomacy', 'create-game-tech-trees', 'create-game-uncapped-card-sets', 'territory-draft-top'];
    const bodyWith = async (fold: boolean) => {
      setFold(fold);
      postMock.mockClear();
      const view = renderAt('era=ww2');
      await screen.findByText('Victory conditions');
      if (fold) fireEvent.click(toggle());
      for (const id of choose) fireEvent.click(checkbox(id));
      if (fold) fireEvent.click(toggle());
      const body = await created();
      view.unmount();
      return body;
    };
    const plainWith = async (fold: boolean) => {
      setFold(fold);
      postMock.mockClear();
      const view = renderAt('era=ww2');
      await screen.findByText('Victory conditions');
      const body = await created();
      view.unmount();
      return body;
    };
    expect(await plainWith(true)).toEqual(await plainWith(false));
    const folded = await bodyWith(true);
    expect(folded).toEqual(await bodyWith(false));
    expect(folded.settings).toMatchObject({ fog_of_war: true, diplomacy_enabled: true, tech_trees_enabled: true, economy_enabled: true, territory_selection: true, card_set_bonus_cap: 0 });
  });

  it('remembers on this device that the host left it open, and only that', async () => {
    const first = renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    fireEvent.click(toggle());
    expect(localStorage.getItem('cc-custom-advanced-open')).toBe('1');
    first.unmount();
    const second = renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle());
    expect(localStorage.getItem('cc-custom-advanced-open')).toBe('0');
    second.unmount();
    renderAt('era=ww2');
    await screen.findByText('Victory conditions');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens by itself where the era locks systems on, without remembering it', async () => {
    renderAt('era=space_age');
    await screen.findByText('Victory conditions');
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'));
    expect(checkbox('create-game-economy')).toMatchObject({ checked: true, disabled: true });
    expect(checkbox('create-game-tech-trees')).toMatchObject({ checked: true, disabled: true });
    expect(localStorage.getItem('cc-custom-advanced-open')).toBeNull();
    // Closed, it still says what the era switched on.
    fireEvent.click(toggle());
    expect(summary()).toMatch(/^Economy & Buildings, Technology Trees/);
  });

  it('opens by itself from a community map link, with the map pairing on', async () => {
    renderAt('map=community_divided_japan');
    await screen.findByText('Victory conditions');
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText(/Then choose the map beside Rules Era, above\./)).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(summary()).toMatch(/^Map pairing/);
  });
});
