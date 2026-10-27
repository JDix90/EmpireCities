/**
 * The replay page on a phone keeps the map on screen: the chronicle and the
 * coaching tips share one panel under it instead of covering it, and the
 * header's less-used actions sit behind one button. A desktop keeps both
 * sidebars over the map and the full header.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReplayPage from './ReplayPage';
import { useAuthStore } from '../store/authStore';

const phone = vi.hoisted(() => ({ value: true }));
const getMock = vi.hoisted(() => vi.fn());

vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a), post: vi.fn(() => Promise.resolve({ data: {} })) },
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
vi.mock('../components/game/ReplayClipExporter', () => ({ default: () => null }));

const players = [
  { player_id: 'p1', username: 'Ada', color: '#e74c3c', territory_count: 1, is_eliminated: false },
  { player_id: 'p2', username: 'Bo (AI)', color: '#3498db', territory_count: 1, is_eliminated: false },
];
const frame = (turn: number, phase: string) => ({
  game_id: 'g1', map_id: 'm1', era: 'ww2', phase, turn_number: turn, current_player_index: 0, players,
  territories: { t1: { owner_id: 'p1', unit_count: 3 }, t2: { owner_id: 'p2', unit_count: 2 } },
});
vi.mock('../utils/replayLoader', () => ({
  loadReplaySnapshots: () =>
    Promise.resolve({
      isPublic: false,
      snapshots: [
        { turn_number: 1, state: frame(1, 'attack') },
        { turn_number: 2, state: frame(2, 'attack') },
        { turn_number: 2, state: frame(2, 'game_over') },
      ],
    }),
  ReplayNotPublicError: class extends Error {},
}));

const map = {
  map_id: 'm1',
  territories: ['t1', 't2'].map((id) => ({
    territory_id: id, name: id, polygon: [[0, 0], [1, 0], [1, 1]], center_point: [0, 0], region_id: 'r1',
  })),
  connections: [{ from: 't1', to: 't2', type: 'land' }],
};
const decisive = { turn: 2, label: 'Decisive attack — gained ground', type: 'turning_point' };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'p1', username: 'Ada' } } as never);
  getMock.mockImplementation((url: string) => {
    if (url === '/maps/m1') return Promise.resolve({ data: { map } });
    if (url.endsWith('/highlights')) return Promise.resolve({ data: { highlights: [decisive, decisive, decisive] } });
    if (url.endsWith('/insights')) {
      return Promise.resolve({
        data: { insights: [{ turn: 2, title: 'Decisive attack — gained ground', impact: 'high', explanation: 'e', alternative: 'a' }] },
      });
    }
    if (url.endsWith('/chronicle')) {
      return Promise.resolve({ data: { entries: [{ turn: 1, date: '1939', kind: 'opening', headline: '2 powers divide the map' }] } });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
});

afterEach(() => cleanup());

function renderReplay(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/replay/g1${query}`]}>
      <Routes>
        <Route path="/replay/:gameId" element={<ReplayPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReplayPage on a phone', () => {
  beforeEach(() => { phone.value = true; });

  it('opens the chronicle under the map from the game-over Chronicle tab, with the tips closed', async () => {
    renderReplay('?source=match&chronicle=1');
    const panel = await screen.findByTestId('replay-phone-panel');
    await waitFor(() => expect(within(panel).getByTestId('chronicle-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('replay-insights-panel')).toBeNull();
  });

  it('shows the tips in place of the chronicle, and closing them leaves the map alone', async () => {
    renderReplay('?source=match&chronicle=1');
    await screen.findByTestId('chronicle-panel');
    fireEvent.click(screen.getByRole('button', { name: 'Show coaching tips' }));
    const panel = screen.getByTestId('replay-phone-panel');
    expect(within(panel).getByTestId('replay-insights-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('chronicle-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close coaching tips' }));
    expect(screen.queryByTestId('replay-phone-panel')).toBeNull();
  });

  it('opens on the map alone from a plain Watch Replay', async () => {
    renderReplay('?source=match');
    await screen.findByTestId('globe');
    expect(screen.queryByTestId('replay-phone-panel')).toBeNull();
  });

  it('keeps clip and share behind More, and one speed button that steps through the speeds', async () => {
    renderReplay('?source=match');
    await screen.findByTestId('globe');
    expect(screen.queryByRole('button', { name: /Share Replay/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More replay actions' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Export clip', 'Share replay']);
    fireEvent.click(screen.getByRole('button', { name: /Playback speed 1×/ }));
    expect(screen.getByRole('button', { name: /Playback speed 2×/ })).toBeInTheDocument();
  });

  it('shows one chip for a turn the server named three times', async () => {
    renderReplay('?source=match');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^T2: Decisive attack/ })).toHaveLength(1));
  });
});

describe('ReplayPage on a desktop', () => {
  beforeEach(() => { phone.value = false; });

  it('keeps the tips and the chronicle over the map and the full header', async () => {
    renderReplay('?source=match&chronicle=1');
    await screen.findByTestId('chronicle-panel');
    expect(screen.getByTestId('replay-insights-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('replay-phone-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /Share Replay/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2×' })).toBeInTheDocument();
  });
});
