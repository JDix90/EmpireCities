import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';

/**
 * Admin → Users pages through every account. It showed the 25 newest and
 * nothing more, so an admin could not reach anyone who signed up earlier.
 * Search runs when asked: on every keystroke it reloaded the tab, which hid
 * the box and took the cursor out of it.
 */
type Params = { search?: string; limit?: number; offset?: number };
let accounts: string[] = [];
const apiGet = vi.fn((url: string, config?: { params?: Params }) => {
  if (url === '/admin/users') {
    const { search = '', limit = 25, offset = 0 } = config?.params ?? {};
    const matching = accounts.filter((name) => name.includes(search));
    const users = matching.slice(offset, offset + limit).map((username) => ({
      user_id: username, username, email: `${username}@test.local`, level: 1, xp: 0, mmr: 1000,
      is_banned: false, is_admin: false, is_guest: false, created_at: '2026-10-01T00:00:00Z',
      last_login_at: null, games_played: 0,
    }));
    return Promise.resolve({ data: { users, total: matching.length } });
  }
  if (url === '/admin/metrics/stat-options') return Promise.resolve({ data: { era_ids: [], map_ids: [] } });
  return Promise.resolve({ data: null });
});
const apiPost = vi.fn(() => Promise.resolve({ data: { ok: true } }));
vi.mock('../services/api', () => ({
  api: {
    get: (url: string, config?: { params?: Params }) => apiGet(url, config),
    patch: vi.fn(),
    post: () => apiPost(),
    delete: vi.fn(),
  },
}));

const names = (n: number) => Array.from({ length: n }, (_, i) => `user_${String(i).padStart(3, '0')}`);
const userCalls = () => apiGet.mock.calls.filter(([url]) => url === '/admin/users');
const lastParams = () => userCalls().at(-1)?.[1]?.params;

async function openUsers() {
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /^Users/ }));
  return screen.findByRole('navigation', { name: 'User pages' });
}

describe('Admin → Users pages', () => {
  beforeEach(() => {
    apiGet.mockClear();
    apiPost.mockClear();
    accounts = names(120);
  });

  it('pages through every account, fifty at a time', async () => {
    const pager = await openUsers();
    expect(within(pager).getByText('Showing 1–50 of 120 accounts')).toBeInTheDocument();
    expect(within(pager).getByText('Page 1 of 3')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ limit: 50, offset: 0 });
    expect(screen.getByText('user_000')).toBeInTheDocument();
    expect(screen.queryByText('user_050')).not.toBeInTheDocument();

    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 51–100 of 120 accounts')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ offset: 50 });
    expect(screen.getByText('user_050')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(await screen.findByText('Showing 101–120 of 120 accounts')).toBeInTheDocument();
    expect(screen.getByText('user_119')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Last' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(await screen.findByText('Showing 1–50 of 120 accounts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('searches when asked, from the first page, and not on every keystroke', async () => {
    await openUsers();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Showing 51–100 of 120 accounts');
    const calls = userCalls().length;

    const box = screen.getByRole('textbox', { name: 'Search username or email' });
    box.focus();
    fireEvent.change(box, { target: { value: 'user_11' } });
    expect(userCalls()).toHaveLength(calls);
    expect(screen.getByRole('textbox', { name: 'Search username or email' })).toBe(document.activeElement);

    fireEvent.submit(box.closest('form')!);
    expect(await screen.findByText('Showing 1–10 of 10 accounts')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ search: 'user_11', offset: 0 });
  });

  it('shows the last page when the one shown empties', async () => {
    await openUsers();
    fireEvent.click(screen.getByRole('button', { name: 'Last' }));
    await screen.findByText('Showing 101–120 of 120 accounts');

    // Every account on the last page goes (deleted elsewhere); the next reload finds it empty.
    accounts = names(100);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ban' })[0]);
    expect(await screen.findByText('Showing 51–100 of 100 accounts')).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ offset: 50 });
  });
});
