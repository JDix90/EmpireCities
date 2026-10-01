import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';

/**
 * The Galactic Age tab: listed beside the others, it mounts the report panel,
 * which loads the admin-guarded report, and the page's Refresh reloads it.
 */
const responses = new Map<string, unknown>();
const apiGet = vi.fn((url: string, _config?: unknown) => Promise.resolve({ data: responses.get(url) ?? null }));
vi.mock('../services/api', () => ({
  api: {
    get: (url: string, config?: unknown) => apiGet(url, config),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeAll(() => {
  // recharts' ResponsiveContainer measures its box; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const emptyReport = {
  filters: { days: null, seats: null, mode: null, relations: null },
  total_games: 0,
  truncated: false,
  unrecorded_games: 0,
  analytics: {
    games: 0, decisive: 0, avg_turns: null, median_minutes: null, modes: [], endings: [],
    factions: [], roles: [], houses: [], players: [], first_seat: null, by_day: [],
  },
  games: [],
};

const reportCalls = () => apiGet.mock.calls.filter(([url]) => url === '/admin/metrics/galaxy').length;

describe('Admin → Galactic Age tab', () => {
  beforeEach(() => {
    apiGet.mockClear();
    responses.clear();
    responses.set('/admin/metrics/galaxy', emptyReport);
  });

  it('loads the report only when opened, and reloads it on Refresh', async () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );
    const tab = await screen.findByRole('button', { name: /Galactic Age/ });
    expect(reportCalls()).toBe(0);
    fireEvent.click(tab);
    expect(await screen.findByText('No finished Galactic Age games recorded for these filters.')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/admin/metrics/galaxy', { params: {} });
    expect(reportCalls()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(reportCalls()).toBe(2));
  });

  it('fetches once per visit when the tab is left and opened again', async () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Galactic Age/ }));
    await screen.findByText('No finished Galactic Age games recorded for these filters.');
    fireEvent.click(screen.getByRole('button', { name: /Overview/ }));
    fireEvent.click(screen.getByRole('button', { name: /Galactic Age/ }));
    await screen.findByText('No finished Galactic Age games recorded for these filters.');
    await new Promise((r) => setTimeout(r, 50));
    expect(reportCalls()).toBe(2);
  });
});
