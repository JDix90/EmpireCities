/**
 * GlobalTurnNotifier: app-wide "it's your turn" handling for async games.
 * Socket is mocked; auth/flag state is set on the real zustand stores;
 * navigation observed via a location probe under MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import GlobalTurnNotifier, { timeLeftLabel, type YourTurnPayload } from './GlobalTurnNotifier';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const socketHandlers: Record<string, (payload: YourTurnPayload) => void> = {};
const connectSocketMock = vi.fn();
vi.mock('../../services/socket', () => ({
  connectSocket: () => connectSocketMock(),
  getSocket: () => ({
    on: (event: string, handler: (payload: YourTurnPayload) => void) => {
      socketHandlers[event] = handler;
    },
    off: (event: string) => {
      delete socketHandlers[event];
    },
  }),
}));

type ToastRender = (t: { id: string }) => ReactElement;
const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { dismiss: ReturnType<typeof vi.fn> };
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
      <GlobalTurnNotifier />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function authOn(isGuest = false) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { user_id: 'u1', username: 'u1', is_guest: isGuest } as never,
  });
}

function flag(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, async_turn_alerts_enabled: on } }));
}

const payload = (over: Partial<YourTurnPayload> = {}): YourTurnPayload => ({
  game_id: 'g1',
  era_id: 'ancient',
  turn_number: 4,
  deadline_at: Date.now() + 23 * 3_600_000,
  ...over,
});

describe('GlobalTurnNotifier', () => {
  beforeEach(() => {
    for (const k of Object.keys(socketHandlers)) delete socketHandlers[k];
    connectSocketMock.mockClear();
    toastMock.mockClear();
    toastMock.dismiss.mockClear();
    flag(true);
    authOn();
  });

  it('keeps the shared socket connected and listens for lobby:your_turn when enabled', () => {
    renderAt('/lobby');
    expect(connectSocketMock).toHaveBeenCalled();
    expect(socketHandlers['lobby:your_turn']).toBeTypeOf('function');
  });

  it('does nothing while the flag is off — the kill switch is real', () => {
    flag(false);
    renderAt('/lobby');
    expect(connectSocketMock).not.toHaveBeenCalled();
    expect(socketHandlers['lobby:your_turn']).toBeUndefined();
  });

  it('includes guests: a guest in an async game needs the alert as much as anyone', () => {
    authOn(true);
    renderAt('/codex');
    expect(socketHandlers['lobby:your_turn']).toBeTypeOf('function');
  });

  it('surfaces a toast from any page, and only once per (game, turn)', () => {
    renderAt('/profile');
    act(() => {
      socketHandlers['lobby:your_turn'](payload());
      // A rejoin re-arms the deadline and the server re-emits the same turn.
      socketHandlers['lobby:your_turn'](payload());
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [, opts] = toastMock.mock.calls[0] as [ToastRender, { id: string; duration: number }];
    expect(opts.id).toBe('your-turn-g1');
    // The next turn in the same game is a new alert.
    act(() => {
      socketHandlers['lobby:your_turn'](payload({ turn_number: 5 }));
    });
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the player is already looking at that game', () => {
    renderAt('/game/g1');
    act(() => {
      socketHandlers['lobby:your_turn'](payload());
    });
    expect(toastMock).not.toHaveBeenCalled();
    // …but a different game's turn still gets through.
    act(() => {
      socketHandlers['lobby:your_turn'](payload({ game_id: 'g2' }));
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('offers a Play button that navigates into the game — never auto-navigates', () => {
    renderAt('/lobby');
    act(() => {
      socketHandlers['lobby:your_turn'](payload());
    });
    // No navigation happened on its own.
    expect(screen.getByTestId('path').textContent).toBe('/lobby');

    const [renderToast] = toastMock.mock.calls[0] as [ToastRender];
    const { getByRole } = render(
      <MemoryRouter initialEntries={['/lobby']}>{renderToast({ id: 't1' })}</MemoryRouter>,
    );
    // The card names the era and the time left.
    expect(getByRole('button', { name: 'Play' })).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Play' }));
    expect(toastMock.dismiss).toHaveBeenCalledWith('t1');
  });
});

describe('timeLeftLabel', () => {
  const now = 1_000_000_000_000;
  it('speaks in days, hours or minutes — whichever the player would say', () => {
    expect(timeLeftLabel(now + 3 * 24 * 3_600_000, now)).toBe('3 days');
    expect(timeLeftLabel(now + 23 * 3_600_000 + 59 * 60_000, now)).toBe('23h');
    expect(timeLeftLabel(now + 40 * 60_000, now)).toBe('40m');
    expect(timeLeftLabel(now + 20_000, now)).toBe('1m');
  });
  it('returns null for an untimed seat or a deadline already passed', () => {
    expect(timeLeftLabel(null, now)).toBeNull();
    expect(timeLeftLabel(now - 1, now)).toBeNull();
  });
});
