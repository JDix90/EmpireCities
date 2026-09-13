import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  Biome,
  encodeTerrainRows,
  packCell,
  terrainChecksum,
  toIntFloor,
  type TerrainAsset,
} from '@borderfall/warfront-sim';
import type { SimRunner } from '../warfront/simRunner';
import { TICK_MS } from '../warfront/simRunner';
import WarfrontPage from './WarfrontPage';

/**
 * Two things about the mocking here, both deliberate:
 *
 * 1. We mock `services/api` (an OBJECT export) rather than `services/warfrontApi` (bare
 *    FUNCTION exports), which also means the real client runs, so `TerrainGrid.decode`
 *    and its checksum check are covered rather than mocked away.
 * 2. PixiJS needs a GPU context jsdom has not got, so the plane is stubbed — but the stub
 *    exposes the page's own callbacks as buttons and hands the runner back to the test.
 *    That way the page → selection → order → simulation path is really exercised; only
 *    the drawing is skipped. The camera and hit-test maths are covered in ../warfront/.
 */

let captured: SimRunner | null = null;

vi.mock('../components/warfront/WarfrontTerrainCanvas', () => ({
  default: (props: {
    grid: { width: number; height: number };
    runner: SimRunner | null;
    selectedIds: ReadonlySet<number>;
    onSelectRect: (r: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => void;
    onSelectPoint: (x: number, y: number, additive: boolean) => void;
    onOrder: (x: number, y: number) => void;
    onHoverCell: (cell: number) => void;
    focus: { cell: number; nonce: number } | null;
  }) => {
    captured = props.runner;
    return (
      <div data-testid="mock-plane">
        <span data-testid="selected-count">{props.selectedIds.size}</span>
        <span data-testid="focus-cell">{props.focus ? props.focus.cell : 'none'}</span>
        <span data-testid="focus-nonce">{props.focus ? props.focus.nonce : 0}</span>
        <button onClick={() => props.onSelectRect({ x0: -1, y0: -1, x1: 1e6, y1: 1e6 }, false)}>select all</button>
        <button onClick={() => props.onSelectPoint(-99, -99, false)}>click empty ground</button>
        <button onClick={() => props.onOrder(5.5, 1.5)}>order east</button>
        <button onClick={() => props.onOrder(FAR_SEA_CELL.x, FAR_SEA_CELL.y)}>order into the deep</button>
        <button onClick={() => props.onHoverCell(1 * 40 + 2)}>hover gaul</button>
        <button onClick={() => props.onHoverCell(-1)}>hover nothing</button>
      </div>
    );
  },
}));

const apiGet = vi.fn();
vi.mock('../services/api', () => ({ api: { get: (...args: unknown[]) => apiGet(...args) } }));

/** A realistic axios failure: a real Error carrying `response`, as axios throws. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data } });
}

const sea = packCell({ owner: 0, tier: 0, passable: false, biome: Biome.Sea });
const gaul = packCell({ owner: 1, tier: 0, passable: true, biome: Biome.Plains });

/**
 * A checksum-valid asset with a walkable band of Lugdunensis — the province the sandbox
 * musters in — and a lot of open sea to its east. The width matters: the far corner has
 * to be further from land than the simulation's redirect radius, or an order there would
 * be quietly rescued to the nearest shore instead of refused.
 */
const FAR_SEA_CELL = { x: 38.5, y: 3.5 };

function tinyAsset(): TerrainAsset {
  const width = 40;
  const height = 4;
  const cells = new Uint16Array(width * height).fill(sea);
  for (let r = 1; r < 3; r++) for (let c = 1; c < 7; c++) cells[r * width + c] = gaul;
  return {
    format: 'warfront-terrain',
    version: 1,
    map_id: 'community_roman_empire_117',
    generator: 'test',
    cell_km: 4,
    width,
    height,
    bounds_e6: { min_lng_e6: 0, max_lng_e6: 1000000, min_lat_e6: 0, max_lat_e6: 1000000 },
    lat0_e6: 500000,
    provinces: [{ index: 1, territory_id: 'lugdunensis', name: 'Gallia Lugdunensis' }],
    lanes: [{ from: 'lugdunensis', to: 'britannia' }],
    rows: encodeTerrainRows(cells, width, height),
    checksum: terrainChecksum(cells, width, height),
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
  // Block body on purpose: `() => apiGet.mockReset()` returns the mock, and vitest treats
  // a function returned from beforeEach as a teardown hook — it would then CALL the mock
  // during cleanup, outside any try/catch, failing the test with the very error the page
  // had already handled.
  apiGet.mockReset();
  captured = null;
});

describe('WarfrontPage loading', () => {
  it('loads terrain from the admin-guarded endpoint and musters a squad', async () => {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    await screen.findByTestId('mock-plane');
    expect(apiGet).toHaveBeenCalledWith('/admin/warfront/terrain');
    expect(captured).not.toBeNull();
    expect(captured!.positions().length).toBeGreaterThan(0);
    // Every unit starts on walkable ground inside the province.
    const grid = captured!.sim.terrain!;
    for (const u of captured!.sim.entities.all()) {
      expect(grid.isPassable(grid.index(toIntFloor(u.x), toIntFloor(u.y)))).toBe(true);
    }
  });

  it('treats a 404 as the flag gate, not a missing asset', async () => {
    apiGet.mockRejectedValue(axiosError(404, { error: 'Warfront is not enabled' }));
    renderPage();
    expect(await screen.findByText('Warfront is switched off')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-plane')).not.toBeInTheDocument();
  });

  it('surfaces a corrupt asset instead of pretending the flag is off', async () => {
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

describe('WarfrontPage selection and orders', () => {
  async function ready() {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    await screen.findByTestId('mock-plane');
    return captured!;
  }

  it('box selection selects the squad, and clicking bare ground clears it', async () => {
    const runner = await ready();
    const total = runner.positions().length;
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).toHaveTextContent(String(total)));
    fireEvent.click(screen.getByText('click empty ground'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).toHaveTextContent('0'));
  });

  it('an order moves the selected units, and the simulation actually advances them', async () => {
    const runner = await ready();
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));

    const before = runner.positions().map((u) => ({ id: u.id, x: u.x }));
    fireEvent.click(screen.getByText('order east'));

    // Commands are stamped two ticks ahead, so nothing moves on the very next tick.
    runner.advance(TICK_MS * 40);
    const after = runner.positions();
    expect(after.some((u, i) => u.x !== before[i].x)).toBe(true);
    // And they head east, toward the ordered point.
    const movedEast = after.filter((u, i) => u.x > before[i].x).length;
    expect(movedEast).toBeGreaterThan(0);
  });

  it('issues nothing when nothing is selected', async () => {
    const runner = await ready();
    const before = runner.positions().map((u) => u.x);
    fireEvent.click(screen.getByText('order east'));
    runner.advance(TICK_MS * 20);
    expect(runner.positions().map((u) => u.x)).toEqual(before);
  });

  it('orders land as whole-integer fixed commands the simulation accepts', async () => {
    const runner = await ready();
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));
    fireEvent.click(screen.getByText('order east'));
    const replay = runner.sim.toReplay();
    // Narrowed to move commands on purpose: the command union is wider than this page
    // uses, and the claim being tested is specifically that pointer positions reach the
    // simulation as whole-integer fixed values.
    const moves = replay.commands.filter((c) => c.command.type === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBe(replay.commands.length);
    for (const c of moves) {
      const move = c.command as { type: 'move'; x: number; y: number };
      expect(Number.isInteger(move.x)).toBe(true);
      expect(Number.isInteger(move.y)).toBe(true);
    }
  });
});

describe('WarfrontPage province panel', () => {
  async function ready() {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    await screen.findByTestId('mock-plane');
  }

  it('prompts before anything is hovered', async () => {
    await ready();
    expect(screen.getByText(/Hover the map for province and terrain detail/)).toBeInTheDocument();
  });

  it('shows the hovered province, its terrain make-up and its lanes', async () => {
    await ready();
    fireEvent.click(screen.getByText('hover gaul'));
    expect(await screen.findByText('Gallia Lugdunensis')).toBeInTheDocument();
    expect(screen.getByText('lugdunensis')).toBeInTheDocument();
    // 12 walkable cells, all plains.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('plains')).toBeInTheDocument();
    // The lane comes from the map's own typed sea links, carried in the asset.
    expect(screen.getByText('britannia')).toBeInTheDocument();
  });

  it('drops back to the prompt when the pointer leaves the map', async () => {
    await ready();
    fireEvent.click(screen.getByText('hover gaul'));
    await screen.findByText('Gallia Lugdunensis');
    fireEvent.click(screen.getByText('hover nothing'));
    await waitFor(() => expect(screen.getByText(/Hover the map for province/)).toBeInTheDocument());
  });

  it('counts the selected units standing in the hovered province', async () => {
    await ready();
    fireEvent.click(screen.getByText('select all'));
    fireEvent.click(screen.getByText('hover gaul'));
    expect(await screen.findByText(/selected units here/)).toBeInTheDocument();
  });

  it('centres the camera on the province on request', async () => {
    await ready();
    fireEvent.click(screen.getByText('hover gaul'));
    const before = screen.getByTestId('focus-nonce').textContent;
    fireEvent.click(await screen.findByRole('button', { name: /Centre on Gallia Lugdunensis/ }));
    await waitFor(() => expect(screen.getByTestId('focus-nonce').textContent).not.toBe(before));
  });
});

describe('WarfrontPage alerts', () => {
  async function ready() {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    await screen.findByTestId('mock-plane');
    return captured!;
  }

  it('refuses an order with no walkable ground anywhere near it, and says so', async () => {
    const runner = await ready();
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));
    const before = runner.sim.toReplay().commands.length;

    fireEvent.click(screen.getByText('order into the deep'));

    expect(await screen.findByText(/Nothing can march there/)).toBeInTheDocument();
    // The order is refused outright rather than issued and silently dropped.
    expect(runner.sim.toReplay().commands.length).toBe(before);
  });

  it('does not raise that alert for an order it can actually carry out', async () => {
    await ready();
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));
    fireEvent.click(screen.getByText('order east'));
    await waitFor(() => expect(screen.queryByText(/Nothing can march there/)).not.toBeInTheDocument());
  });

  it('the jump key centres on the latest alert', async () => {
    await ready();
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));
    fireEvent.click(screen.getByText('order into the deep'));
    await screen.findByText(/Nothing can march there/);

    const before = screen.getByTestId('focus-nonce').textContent;
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(screen.getByTestId('focus-nonce').textContent).not.toBe(before));
    // And it centres on the refused spot, not on wherever the camera happened to be.
    expect(screen.getByTestId('focus-cell')).toHaveTextContent(String(3 * 40 + 38));
  });

  it('clears the alert list on request', async () => {
    await ready();
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));
    fireEvent.click(screen.getByText('order into the deep'));
    await screen.findByText(/Nothing can march there/);
    fireEvent.click(screen.getByRole('button', { name: /Clear alerts/ }));
    await waitFor(() => expect(screen.queryByText(/Nothing can march there/)).not.toBeInTheDocument());
  });
});
