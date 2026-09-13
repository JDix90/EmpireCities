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
import { BuildingKind, START_FOOD, START_SILVER, START_TIMBER, UnitKind } from '@borderfall/warfront-sim';
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
    selectedBuildingId: number | null;
    placing: boolean;
    onSelectRect: (r: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => void;
    onSelectPoint: (x: number, y: number, additive: boolean) => void;
    onOrder: (x: number, y: number) => void;
    onHoverCell: (cell: number) => void;
    onFrame: (info: { ticks: number; units: number }) => void;
    focus: { cell: number; nonce: number } | null;
  }) => {
    captured = props.runner;
    const seat = props.runner?.sim.buildings.all()[0];
    const grid = props.runner?.sim.terrain;
    const seatPoint = seat && grid ? { x: grid.colOf(seat.cell) + 0.5, y: grid.rowOf(seat.cell) + 0.5 } : null;
    return (
      <div data-testid="mock-plane">
        <span data-testid="selected-count">{props.selectedIds.size}</span>
        <span data-testid="selected-building">{props.selectedBuildingId ?? 'none'}</span>
        <span data-testid="placing">{props.placing ? 'yes' : 'no'}</span>
        <span data-testid="focus-cell">{props.focus ? props.focus.cell : 'none'}</span>
        <span data-testid="focus-nonce">{props.focus ? props.focus.nonce : 0}</span>
        <button onClick={() => props.onSelectRect({ x0: -1, y0: -1, x1: 1e6, y1: 1e6 }, false)}>select all</button>
        <button onClick={() => props.onSelectPoint(-99, -99, false)}>click empty ground</button>
        <button onClick={() => seatPoint && props.onSelectPoint(seatPoint.x, seatPoint.y, false)}>click the seat</button>
        <button onClick={() => props.onSelectPoint(EMPTY_LAND.x, EMPTY_LAND.y, false)}>click empty land</button>
        <button onClick={() => props.onOrder(5.5, 1.5)}>order east</button>
        <button onClick={() => props.onOrder(FAR_SEA_CELL.x, FAR_SEA_CELL.y)}>order into the deep</button>
        <button onClick={() => props.onHoverCell(1 * 40 + 2)}>hover gaul</button>
        <button onClick={() => props.onHoverCell(-1)}>hover nothing</button>
        <button onClick={() => props.onFrame({ ticks: props.runner?.ticks ?? 0, units: props.runner?.positions().length ?? 0 })}>
          pump frame
        </button>
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
/** Walkable Lugdunensis with nothing standing on it — a site for a new building. */
const EMPTY_LAND = { x: 5.5, y: 2.5 };

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

describe('WarfrontPage economy', () => {
  async function ready() {
    apiGet.mockResolvedValue({ data: tinyAsset() });
    renderPage();
    await screen.findByTestId('mock-plane');
    return captured!;
  }

  /**
   * Advances the simulation a frame at a time, then pushes one frame report — the way the
   * render loop does. One `advance` per tick on purpose: the runner caps a single call at
   * MAX_STEPS_PER_FRAME so a backgrounded tab cannot simulate a minute inside one frame,
   * and a test that handed it a big number would quietly advance five ticks.
   */
  function pump(runner: SimRunner, ticks: number) {
    for (let i = 0; i < ticks; i++) runner.advance(TICK_MS);
    fireEvent.click(screen.getByText('pump frame'));
  }

  it("opens with the brief's stock on the resource bar", async () => {
    await ready();
    const bar = await screen.findByTestId('warfront-resources');
    expect(bar).toHaveTextContent(`Food${START_FOOD}`);
    expect(bar).toHaveTextContent(`Timber${START_TIMBER}`);
    expect(bar).toHaveTextContent(`Silver${START_SILVER}`);
    // Four villagers and a scout at 3 food a minute each.
    expect(bar).toHaveTextContent('Upkeep15/min');
    expect(bar).toHaveTextContent('Provinces1');
  });

  it('shows the rising colonisation price, and marks it when it cannot be paid', async () => {
    const runner = await ready();
    const bar = screen.getByTestId('warfront-resources');
    const price = runner.sim.colonisePriceFor(1);
    expect(bar).toHaveTextContent(`Next colony${price} food`);
    runner.sim.players.get(1)!.food = 0;
    pump(runner, 1);
    await waitFor(() => expect(screen.getByText(`${price} food`)).toHaveClass('text-red-300'));
  });

  it('prompts for a selection before offering any command', async () => {
    await ready();
    expect(screen.getByText(/Select villagers to build or colonise/)).toBeInTheDocument();
  });

  it('offers the build palette once villagers are selected, and no seat in it', async () => {
    await ready();
    fireEvent.click(screen.getByText('select all'));
    const commands = await screen.findByTestId('warfront-commands');
    expect(commands).toHaveTextContent('farm');
    expect(commands).toHaveTextContent('lumber camp');
    expect(commands).toHaveTextContent('barracks');
    // A seat is planted by colonising, never built — rule I. (The colonise button says
    // "Plant a seat", so this asks about the BUILD buttons rather than the whole bar.)
    expect(screen.queryAllByRole('button', { name: /^seat/ })).toEqual([]);
  });

  it('sites a building where the next click lands, and puts the villagers on it', async () => {
    const runner = await ready();
    fireEvent.click(screen.getByText('select all'));
    await screen.findByTestId('warfront-commands');
    fireEvent.click(screen.getByRole('button', { name: /^house/ }));
    await waitFor(() => expect(screen.getByTestId('placing')).toHaveTextContent('yes'));

    fireEvent.click(screen.getByText('click empty land'));
    await waitFor(() => expect(screen.getByTestId('placing')).toHaveTextContent('no'));

    pump(runner, 6);
    const site = runner.sim.buildings.all().find((b) => b.kind === BuildingKind.House);
    expect(site).toBeDefined();
    // The villager that sited it is on it, and the rest of the selection joined — two
    // builders halve the time, which is the whole reason the others are sent.
    pump(runner, 10);
    expect(site!.workers.length).toBeGreaterThan(1);
  });

  it('cancels a placement on Escape without spending anything', async () => {
    const runner = await ready();
    fireEvent.click(screen.getByText('select all'));
    await screen.findByTestId('warfront-commands');
    fireEvent.click(screen.getByRole('button', { name: /^house/ }));
    await waitFor(() => expect(screen.getByTestId('placing')).toHaveTextContent('yes'));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('placing')).toHaveTextContent('no'));
    // Escape cancelled the placement, not the selection: the villagers are still picked.
    expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0');
    expect(runner.sim.players.get(1)!.timber).toBe(START_TIMBER);
  });

  it('selects a building when it is clicked, and offers what it trains', async () => {
    await ready();
    fireEvent.click(screen.getByText('click the seat'));
    await waitFor(() => expect(screen.getByTestId('selected-building')).toHaveTextContent('1'));
    const commands = screen.getByTestId('warfront-commands');
    expect(commands).toHaveTextContent('villager');
    expect(commands).toHaveTextContent('scout');
  });

  it('trains from the selected building, and the unit actually arrives', async () => {
    const runner = await ready();
    const before = runner.positions().length;
    fireEvent.click(screen.getByText('click the seat'));
    await waitFor(() => expect(screen.getByTestId('selected-building')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: /^villager/ }));

    // Twenty seconds of training, plus the two-tick command delay.
    pump(runner, 15 * 21);
    expect(runner.positions().length).toBe(before + 1);
    expect(runner.sim.players.get(1)!.food).toBeLessThan(200);
  });

  it('assigns selected villagers by clicking the building they are to work', async () => {
    const runner = await ready();
    const grid = runner.sim.terrain!;
    const farm = runner.sim.buildings.place({
      owner: 1,
      kind: BuildingKind.Farm,
      cell: grid.index(5, 2),
      complete: true,
    });
    fireEvent.click(screen.getByText('select all'));
    await waitFor(() => expect(screen.getByTestId('selected-count')).not.toHaveTextContent('0'));

    fireEvent.click(screen.getByText('click empty land'));
    pump(runner, 5);

    // Rule II: villagers are assigned, never clicked.
    expect(farm.workers.length).toBeGreaterThan(0);
    for (const id of farm.workers) {
      expect(runner.sim.entities.get(id)!.kind).toBe(UnitKind.Villager);
    }
  });

  it('counts only villagers as builders — the scout in the selection is not labour', () => {
    // The opening is four villagers and a scout, and "select all" takes the lot.
    return ready().then(async (runner) => {
      const scouts = [...runner.sim.entities.all()].filter((u) => u.kind === UnitKind.Scout).length;
      const villagers = [...runner.sim.entities.all()].filter((u) => u.kind === UnitKind.Villager).length;
      expect(scouts).toBeGreaterThan(0);
      fireEvent.click(screen.getByText('select all'));
      const commands = await screen.findByTestId('warfront-commands');
      expect(commands).toHaveTextContent(`Build (${villagers} villagers)`);
    });
  });

  it('raises an alert when a seat falls, and the jump key goes to it', async () => {
    const runner = await ready();
    const seatCell = runner.sim.buildings.get(1)!.cell;
    // One frame first, so the watch has seen the match standing before it falls: the
    // opening position is not news, and reporting it would greet every player with an
    // alert about the seat they just started with.
    pump(runner, 1);
    runner.sim.damageBuilding(1, 99999);
    pump(runner, 3);

    expect(await screen.findByText(/has fallen/)).toBeInTheDocument();
    const before = screen.getByTestId('focus-nonce').textContent;
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(screen.getByTestId('focus-nonce').textContent).not.toBe(before));
    expect(screen.getByTestId('focus-cell')).toHaveTextContent(String(seatCell));
  });

  it('shows the province holding and what stands in it', async () => {
    await ready();
    fireEvent.click(screen.getByText('hover gaul'));
    expect(await screen.findByText('Held by')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
    expect(screen.getByText('seat')).toBeInTheDocument();
  });

  it('refuses to colonise a province that is already yours, and says why', async () => {
    await ready();
    fireEvent.click(screen.getByText('select all'));
    const colonise = await screen.findByRole('button', { name: /Plant a seat/ });
    expect(colonise).toBeDisabled();
    expect(screen.getByText('Already yours.')).toBeInTheDocument();
  });
});
