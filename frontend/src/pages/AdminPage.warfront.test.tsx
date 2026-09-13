import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPage from './AdminPage';

/**
 * The Warfront tab is deliberately near-empty in Slice A step 1: it exists, it calls
 * the admin-guarded status endpoint, and it tells the admin how the flag gate stands.
 * These tests pin that it does exactly that and nothing more.
 */
const responses = new Map<string, unknown>();
const apiGet = vi.fn((url: string) => Promise.resolve({ data: responses.get(url) ?? null }));
vi.mock('../services/api', () => ({
  api: {
    get: (url: string) => apiGet(url),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

const terrain = {
  id: 'western_twenty',
  map_id: 'community_roman_empire_117',
  generator: 'frontend/scripts/buildWarfrontTerrain.ts',
  cell_km: 4,
  width: 631,
  height: 949,
  cells: 598819,
  provinces: 20,
  lanes: 14,
  checksum: '7a6d1f7b99f8936f',
};

describe('Admin → Warfront tab', () => {
  beforeEach(() => {
    apiGet.mockClear();
    responses.clear();
  });

  it('is listed as a tab and loads the admin status endpoint when opened', async () => {
    responses.set('/admin/warfront/status', { enabled: false, flag: 'warfront_enabled', terrain, terrain_error: null });
    renderAdmin();
    const tab = await screen.findByRole('button', { name: /Warfront/ });
    fireEvent.click(tab);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/admin/warfront/status'));
    expect(await screen.findByText('warfront_enabled · off')).toBeInTheDocument();
    expect(screen.getByText(/terrain endpoint answers 404 while the flag is off/)).toBeInTheDocument();
    expect(screen.getByText('631 × 949')).toBeInTheDocument();
    expect(screen.getByText('7a6d1f7b99f8936f')).toBeInTheDocument();
    // Status is the only Warfront call the tab makes: the asset itself is never fetched here.
    expect(apiGet.mock.calls.some(([url]) => String(url).includes('/warfront/terrain'))).toBe(false);
  });

  it('shows the flag on and the asset summary once the gate is open', async () => {
    responses.set('/admin/warfront/status', { enabled: true, flag: 'warfront_enabled', terrain, terrain_error: null });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /Warfront/ }));
    expect(await screen.findByText('warfront_enabled · on')).toBeInTheDocument();
    expect(screen.queryByText(/answers 404 while the flag is off/)).not.toBeInTheDocument();
    expect(screen.getByText('598,819')).toBeInTheDocument();
  });

  it('surfaces a missing asset instead of a summary', async () => {
    responses.set('/admin/warfront/status', {
      enabled: false,
      flag: 'warfront_enabled',
      terrain: null,
      terrain_error: 'ENOENT: no such file',
    });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /Warfront/ }));
    expect(await screen.findByText(/Terrain asset unavailable: ENOENT/)).toBeInTheDocument();
  });

  it('lists the warfront_enabled kill switch among the Config feature flags', async () => {
    responses.set('/admin/config', { feature_flag_states: { warfront_enabled: { code_default: false, overridden: false, effective: false } } });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /^Config/ }));
    expect(await screen.findByText('Warfront (experimental RTS mode)')).toBeInTheDocument();
    expect(screen.getByText('warfront_enabled')).toBeInTheDocument();
  });
});
