import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Biome, encodeTerrainRows, packCell, terrainChecksum, type TerrainAsset } from '@borderfall/warfront-sim';
import WarfrontPage from './WarfrontPage';

/**
 * The page's job in step 2 is to load the admin-guarded terrain and hand it to the
 * plane, and to be honest about the two ways that fails: the flag is off (404), or the
 * asset will not decode.
 *
 * Two things about the mocking here, both deliberate:
 *
 * 1. We mock `services/api` (an OBJECT export) rather than `services/warfrontApi` (bare
 *    FUNCTION exports). Mocking a module whose exports are bare functions makes vitest
 *    wrap them for call tracking, and that wrapper attaches no rejection handler — so a
 *    rejecting mock surfaces a duplicate UNHANDLED rejection that fails the test even
 *    though the component caught the original. Mocking at the axios client avoids it and
 *    matches GlobalMatchNotifier.test.tsx.
 * 2. It also means the real `warfrontApi` client runs, so `TerrainGrid.decode` and its
 *    checksum check are covered rather than mocked away.
 *
 * PixiJS needs a GPU context jsdom has not got, so the canvas itself is stubbed; its
 * pure inputs are tested in ../warfront/camera.test.ts and ../warfront/terrainImage.test.ts.
 */
vi.mock('../components/warfront/WarfrontTerrainCanvas', () => ({
  default: ({ grid }: { grid: { width: number; height: number } }) => (
    <div data-testid="mock-plane">
      plane {grid.width}x{grid.height}
    </div>
  ),
}));

const apiGet = vi.fn();
vi.mock('../services/api', () => ({ api: { get: (...args: unknown[]) => apiGet(...args) } }));

/** A realistic axios failure: a real Error carrying `response`, as axios throws. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data } });
}

/** A real, checksum-valid two-cell asset — the same shape the pipeline commits. */
function tinyAsset(): TerrainAsset {
  const cells = Uint16Array.from([
    packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains }),
    packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea }),
  ]);
  return {
    format: 'warfront-terrain',
    version: 1,
    map_id: 'community_roman_empire_117',
    generator: 'test',
    cell_km: 4,
    width: 2,
    height: 1,
    bounds_e6: { min_lng_e6: 0, max_lng_e6: 1000000, min_lat_e6: 0, max_lat_e6: 1000000 },
    lat0_e6: 500000,
    provinces: [{ index: 1, territory_id: 'italia_north', name: 'Italia Cisalpina' }],
    lanes: [],
    rows: encodeTerrainRows(cells, 2, 1),
    checksum: terrainChecksum(cells, 2, 1),
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WarfrontPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Block body on purpose: `() => apiGet.mockReset()` returns the mock, and vitest
  // treats a function returned from beforeEach as a teardown hook — it would then CALL
  // the mock during cleanup, outside any try/catch, failing the test with the very
  // error the component had already handled.
  apiGet.mockReset();
});

describe('WarfrontPage', () => {
  it('loads terrain from the admin-guarded endpoint and renders the plane', async () => {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    expect(await screen.findByTestId('mock-plane')).toHaveTextContent('plane 2x1');
    expect(apiGet).toHaveBeenCalledWith('/admin/warfront/terrain');
    expect(screen.getByText(/2 × 1 cells/)).toBeInTheDocument();
    expect(screen.getByText(/1 provinces/)).toBeInTheDocument();
  });

  it('treats a 404 as the flag gate, not a missing asset', async () => {
    apiGet.mockRejectedValue(axiosError(404, { error: 'Warfront is not enabled' }));
    renderPage();
    expect(await screen.findByText('Warfront is switched off')).toBeInTheDocument();
    expect(screen.getByText(/warfront_enabled/)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-plane')).not.toBeInTheDocument();
  });

  it('surfaces a corrupt asset instead of pretending the flag is off', async () => {
    // A real decode failure: the checksum no longer matches the rows.
    apiGet.mockResolvedValue({ data: { ...tinyAsset(), checksum: '0000000000000000' } });
    renderPage();
    expect(await screen.findByText(/checksum mismatch/)).toBeInTheDocument();
    expect(screen.queryByText('Warfront is switched off')).not.toBeInTheDocument();
  });

  it('offers a way back to the admin console', async () => {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('mock-plane')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Back to Admin/ })).toHaveAttribute('href', '/admin');
  });
});
