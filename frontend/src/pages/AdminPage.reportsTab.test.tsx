/**
 * The top bar's open-reports flag links to /admin?tab=reports: the Admin page
 * opens on that tab and loads the reports, not the overview. Any other value
 * opens the overview, as /admin always has.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';

const apiGet = vi.fn((url: string, _config?: unknown) =>
  Promise.resolve({ data: url === '/admin/chat-reports' ? { open: 0, items: [] } : null }));
vi.mock('../services/api', () => ({
  api: { get: (url: string, config?: unknown) => apiGet(url, config), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const calledFor = (url: string) => apiGet.mock.calls.some(([u]) => u === url);

describe('Admin opened from the open-reports flag', () => {
  beforeEach(() => apiGet.mockClear());

  it('opens on Reports with ?tab=reports', async () => {
    render(<MemoryRouter initialEntries={['/admin?tab=reports']}><AdminPage /></MemoryRouter>);
    expect(await screen.findByTestId('admin-chat-reports')).toBeInTheDocument();
    await waitFor(() => expect(calledFor('/admin/chat-reports')).toBe(true));
    expect(calledFor('/admin/metrics/overview')).toBe(false);
  });

  it('opens on the overview for anything else', async () => {
    render(<MemoryRouter initialEntries={['/admin?tab=nonsense']}><AdminPage /></MemoryRouter>);
    await waitFor(() => expect(calledFor('/admin/metrics/overview')).toBe(true));
    expect(screen.queryByTestId('admin-chat-reports')).toBeNull();
    expect(calledFor('/admin/chat-reports')).toBe(false);
  });
});
