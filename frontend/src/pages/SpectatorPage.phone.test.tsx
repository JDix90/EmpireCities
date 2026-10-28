/**
 * Spectating on a phone: one header row, the players in one scrolling row, the
 * map on the rest of the screen, and the chat a tap away in the bottom bar. The
 * chat keeps collecting while closed, and the button counts what arrived. A
 * desktop keeps its sidebar with the chat and reactions always shown.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SpectatorPage from './SpectatorPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const phone = vi.hoisted(() => ({ value: true }));
const socket = vi.hoisted(() => {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    connected: true,
    emitted: [] as Array<[string, unknown]>,
    on(event: string, fn: (p: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: (p: unknown) => void) { handlers.get(event)?.delete(fn); },
    emit(event: string, payload: unknown) { this.emitted.push([event, payload]); },
    /** The server sends `event`. */
    serverSends(event: string, payload: unknown) { for (const fn of handlers.get(event) ?? []) fn(payload); },
    reset() { handlers.clear(); this.emitted = []; },
  };
});

vi.mock('../services/socket', () => ({ connectSocket: () => {}, getSocket: () => socket }));
vi.mock('../services/api', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { map } })), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('../utils/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/device')>()),
  isPhoneLayout: () => phone.value,
  isMobileViewport: () => phone.value,
  prefersReducedMotion: () => false,
}));
vi.mock('../hooks/useFrameBudget', () => ({
  usePageFrameBudget: () => ({ active: false, fps: 60, reduced: false }),
}));
vi.mock('../utils/globeLoader', () => ({
  GlobeMapLazy: () => <div data-testid="globe" />,
  GalaxyStrategicViewLazy: () => null,
  preloadGlobeChunks: () => {},
}));
vi.mock('../components/game/GameMap', () => ({ default: () => <div data-testid="map-2d" /> }));

const GAME = 'g1';
const map = {
  map_id: 'm1',
  territories: ['t1', 't2'].map((id) => ({
    territory_id: id, name: id, polygon: [[0, 0], [1, 0], [1, 1]], center_point: [0, 0], region_id: 'r1',
  })),
  connections: [{ from: 't1', to: 't2', type: 'land' }],
};
const state = {
  game_id: GAME, map_id: 'm1', era: 'ww2', phase: 'attack', turn_number: 5, current_player_index: 1,
  players: [
    { player_id: 'p1', player_index: 0, username: 'Ada', color: '#e74c3c', territory_count: 1, is_eliminated: false },
    { player_id: 'p2', player_index: 1, username: 'Bo (AI)', color: '#3498db', territory_count: 1, is_eliminated: false, is_ai: true },
  ],
  territories: { t1: { owner_id: 'p1', unit_count: 3 }, t2: { owner_id: 'p2', unit_count: 2 } },
  _spectator_seq: 1,
};
const chat = (message: string) => ({ gameId: GAME, playerId: 'p9', username: 'Cy', color: '#fff', message, timestamp: Date.now() });

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  socket.reset();
  useAuthStore.setState({ isAuthenticated: true, accessToken: 'token', user: { user_id: 'v1', username: 'Viewer' } } as never);
  useFeatureFlagsStore.setState((s) => ({ loaded: true, flags: { ...s.flags, spectate_enabled: true } }));
});

afterEach(() => cleanup());

async function watch() {
  render(
    <MemoryRouter initialEntries={[`/spectate/${GAME}`]}>
      <Routes>
        <Route path="/spectate/:gameId" element={<SpectatorPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    socket.serverSends('game:spectator_count', { count: 3 });
    socket.serverSends('game:state', state);
  });
  await screen.findByTestId('globe');
}

describe('SpectatorPage on a phone', () => {
  beforeEach(() => { phone.value = true; });

  it('names whose turn it is over the map, and keeps the chat closed until asked', async () => {
    await watch();
    expect(screen.getByText("Bo (AI)'s turn")).toBeInTheDocument();
    expect(screen.getByTestId('spectator-chat-panel')).toHaveClass('hidden');
  });

  it('counts the messages that arrive while the chat is closed, and shows them when it opens', async () => {
    await watch();
    await act(async () => {
      socket.serverSends('game:spectator_chat_message', chat('gg'));
      socket.serverSends('game:spectator_chat_message', chat('watch the east'));
    });
    const button = screen.getByRole('button', { name: /^Chat/ });
    expect(within(button).getByLabelText('2 unread')).toBeInTheDocument();

    fireEvent.click(button);
    const panel = screen.getByTestId('spectator-chat-panel');
    expect(panel).not.toHaveClass('hidden');
    expect(within(panel).getByText('gg')).toBeInTheDocument();
    expect(within(panel).getByText('watch the east')).toBeInTheDocument();
    expect(within(button).queryByLabelText(/unread/)).toBeNull();

    // While it is open, a message is read where it lands.
    await act(async () => { socket.serverSends('game:spectator_chat_message', chat('nice')); });
    expect(within(button).queryByLabelText(/unread/)).toBeNull();
  });

  it('sends a reaction from the bottom bar', async () => {
    await watch();
    fireEvent.click(screen.getByRole('button', { name: 'React 👏' }));
    expect(socket.emitted).toContainEqual(['game:spectator_emote', { gameId: GAME, emote: '👏' }]);
  });
});

describe('SpectatorPage on a desktop', () => {
  beforeEach(() => { phone.value = false; });

  it('keeps the chat and reactions in the sidebar, with no bottom bar', async () => {
    await watch();
    expect(screen.queryByTestId('spectator-chat-panel')).toBeNull();
    expect(screen.getByText('Spectator Chat')).toBeInTheDocument();
    expect(screen.getByText('Reactions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Chat/ })).toBeNull();
  });
});
