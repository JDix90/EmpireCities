/**
 * An admin's top bar flags open chat reports beside Admin, and that link then
 * opens Admin → Reports. The count is read when the bar mounts, and changes
 * the moment the server announces one (a report filed or closed). Nobody but
 * an admin sees it or asks for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getMock = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, (msg: unknown) => void>());
const connectMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get: getMock, post: vi.fn() } }));
vi.mock('../../services/socket', () => ({
  connectSocket: connectMock,
  getSocket: () => ({
    on: (event: string, fn: (msg: unknown) => void) => { handlers.set(event, fn); },
    off: (event: string) => { handlers.delete(event); },
  }),
}));

import TopNavBar from './TopNavBar';
import { useAuthStore } from '../../store/authStore';

/** An access token whose claims say admin (the bar reads the claim, not the stored user). */
const token = (admin: boolean) =>
  `x.${btoa(JSON.stringify({ sub: 'a1', username: 'boss', admin, exp: Math.floor(Date.now() / 1000) + 3600 }))}.y`;

function renderBar(admin: boolean) {
  useAuthStore.setState({ accessToken: token(admin), user: { user_id: 'a1', username: 'boss', is_guest: false } as never });
  return render(
    <MemoryRouter initialEntries={['/lobby']}>
      <TopNavBar user={{ username: 'boss' }} onLogout={() => {}} />
    </MemoryRouter>,
  );
}

describe('the Admin entry\'s open reports flag', () => {
  beforeEach(() => {
    getMock.mockReset();
    handlers.clear();
    connectMock.mockClear();
  });

  it('shows how many reports are open and links straight to Admin → Reports', async () => {
    getMock.mockResolvedValue({ data: { open: 3 } });
    renderBar(true);
    expect(await screen.findByTestId('admin-reports-badge')).toHaveTextContent('3');
    expect(getMock).toHaveBeenCalledWith('/admin/chat-reports/open-count');
    // The lobby does not connect the socket by itself; the push needs it.
    expect(connectMock).toHaveBeenCalled();
    const link = screen.getByRole('link', { name: 'Admin, 3 open reports' });
    expect(link).toHaveAttribute('href', '/admin?tab=reports');
  });

  it('appears the moment a report is filed, and goes once they are all closed', async () => {
    getMock.mockResolvedValue({ data: { open: 0 } });
    renderBar(true);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByTestId('admin-reports-badge')).toBeNull();
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin');

    act(() => { handlers.get('admin:chat_reports')!({ open: 1 }); });
    expect(screen.getByTestId('admin-reports-badge')).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Admin, 1 open report' })).toBeInTheDocument();

    act(() => { handlers.get('admin:chat_reports')!({ open: 0 }); });
    expect(screen.queryByTestId('admin-reports-badge')).toBeNull();
  });

  it('caps a long queue at 99+', async () => {
    getMock.mockResolvedValue({ data: { open: 140 } });
    renderBar(true);
    expect(await screen.findByTestId('admin-reports-badge')).toHaveTextContent('99+');
  });

  it('is neither shown to nor asked for by a player who is not an admin', async () => {
    renderBar(false);
    expect(screen.queryByRole('link', { name: /Admin/ })).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
    expect(handlers.has('admin:chat_reports')).toBe(false);
  });
});
