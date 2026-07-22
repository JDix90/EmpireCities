/**
 * GlobalMatchNotifier: app-wide match-found handling.
 * Socket and api are mocked; auth/flag state is set on the real zustand
 * stores; navigation observed via a location probe under MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import GlobalMatchNotifier from './GlobalMatchNotifier';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { setRankedSearchMarker, getRankedSearchMarker } from '../../utils/rankedSearchMarker';

const socketHandlers: Record<string, (payload: { game_id: string }) => void> = {};
const connectSocketMock = vi.fn();
vi.mock('../../services/socket', () => ({
  connectSocket: () => connectSocketMock(),
  getSocket: () => ({
    on: (event: string, handler: (payload: { game_id: string }) => void) => {
      socketHandlers[event] = handler;
    },
    off: (event: string) => {
      delete socketHandlers[event];
    },
  }),
}));

const apiGetMock = vi.fn();
vi.mock('../../services/api', () => ({
  api: { get: (...args: unknown[]) => apiGetMock(...args) },
}));

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { success: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  fn.success = vi.fn();
  fn.dismiss = vi.fn();
  return fn;
});
vi.mock('react-hot-toast', () => ({ default: toastMock }));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalMatchNotifier />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function authOn() {
  useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'u1', username: 'u1', is_guest: false } as never });
}

describe('GlobalMatchNotifier', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(socketHandlers)) delete socketHandlers[k];
    connectSocketMock.mockClear();
    toastMock.mockClear();
    toastMock.success.mockClear();
    apiGetMock.mockReset().mockResolvedValue({ data: { queued: true } });
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, match_alerts_enabled: true } }));
    authOn();
  });

  it('does not connect when the flag is off', () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, match_alerts_enabled: false } }));
    renderAt('/lobby');
    expect(connectSocketMock).not.toHaveBeenCalled();
    expect(socketHandlers['matchmaking:found']).toBeUndefined();
  });

  it('does not connect for guests', () => {
    useAuthStore.setState({ isAuthenticated: true, user: { user_id: 'g', username: 'g', is_guest: true } as never });
    renderAt('/lobby');
    expect(connectSocketMock).not.toHaveBeenCalled();
  });

  it('found on /lobby → success toast + auto-navigate into the game', async () => {
    renderAt('/lobby');
    expect(connectSocketMock).toHaveBeenCalled();
    act(() => socketHandlers['matchmaking:found']({ game_id: 'g42' }));
    expect(toastMock.success).toHaveBeenCalledWith('Match found!');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/game/g42'));
  });

  it('found on an unrelated page → auto-navigates too (product decision)', async () => {
    renderAt('/settings');
    act(() => socketHandlers['matchmaking:found']({ game_id: 'g43' }));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/game/g43'));
  });

  it('found while inside ANOTHER live game → action toast, no yank', async () => {
    renderAt('/game/other-game');
    act(() => socketHandlers['matchmaking:found']({ game_id: 'g44' }));
    expect(toastMock).toHaveBeenCalled(); // action-toast variant
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.getByTestId('path').textContent).toBe('/game/other-game');
  });

  it('found clears the search marker', () => {
    setRankedSearchMarker('ancient', 'blitz_120');
    renderAt('/lobby');
    act(() => socketHandlers['matchmaking:found']({ game_id: 'g45' }));
    expect(getRankedSearchMarker()).toBeNull();
  });

  it('catch-up: marker + not queued + newer ranked game → surfaces it and clears the marker', async () => {
    setRankedSearchMarker('ancient', 'blitz_120');
    const now = new Date().toISOString();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/matchmaking/status') return Promise.resolve({ data: { queued: false } });
      if (url === '/users/me/active-games') {
        return Promise.resolve({
          data: [
            { game_id: 'old-casual', is_ranked: false, created_at: now, started_at: now },
            { game_id: 'fresh-ranked', is_ranked: true, created_at: now, started_at: now },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    renderAt('/lobby');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/game/fresh-ranked'));
    expect(getRankedSearchMarker()).toBeNull();
  });

  it('catch-up: still queued → marker kept, no navigation', async () => {
    setRankedSearchMarker('ancient', 'blitz_120');
    apiGetMock.mockResolvedValue({ data: { queued: true } });
    renderAt('/lobby');
    await waitFor(() => expect(apiGetMock).toHaveBeenCalledWith('/matchmaking/status'));
    expect(getRankedSearchMarker()).not.toBeNull();
    expect(screen.getByTestId('path').textContent).toBe('/lobby');
  });

  it('catch-up: not queued and no matching game → marker cleared, no navigation', async () => {
    setRankedSearchMarker('ancient', 'blitz_120');
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/matchmaking/status') return Promise.resolve({ data: { queued: false } });
      return Promise.resolve({ data: [] });
    });
    renderAt('/lobby');
    await waitFor(() => expect(getRankedSearchMarker()).toBeNull());
    expect(screen.getByTestId('path').textContent).toBe('/lobby');
  });

  it('no marker → no catch-up API calls', async () => {
    renderAt('/lobby');
    await new Promise((r) => setTimeout(r, 20));
    expect(apiGetMock).not.toHaveBeenCalled();
  });
});
