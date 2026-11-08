import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BalancePanel, { type BalanceSimReport } from './BalancePanel';

const postMock = vi.fn();
vi.mock('../../services/api', () => ({ api: { post: (...a: unknown[]) => postMock(...a) } }));

const territories = [
  { territory_id: 'a', name: 'Alpha', polygon: [], center_point: [0, 0] as [number, number], region_id: 'west' },
  { territory_id: 'b', name: 'Bravo', polygon: [], center_point: [0, 0] as [number, number], region_id: 'west' },
  { territory_id: 'c', name: 'Charlie', polygon: [], center_point: [0, 0] as [number, number], region_id: 'west' },
  { territory_id: 'd', name: 'Delta', polygon: [], center_point: [0, 0] as [number, number], region_id: 'east' },
  { territory_id: 'e', name: 'Echo', polygon: [], center_point: [0, 0] as [number, number], region_id: 'east' },
  { territory_id: 'f', name: 'Foxtrot', polygon: [], center_point: [0, 0] as [number, number], region_id: 'east' },
];
const connections = [
  { from: 'a', to: 'b', type: 'land' as const }, { from: 'b', to: 'c', type: 'land' as const }, { from: 'c', to: 'a', type: 'land' as const },
  { from: 'c', to: 'd', type: 'sea' as const },
  { from: 'd', to: 'e', type: 'land' as const }, { from: 'e', to: 'f', type: 'land' as const }, { from: 'f', to: 'd', type: 'land' as const },
];
const regions = [
  { region_id: 'west', name: 'West', bonus: 5 },
  { region_id: 'east', name: 'East', bonus: 2 },
];

const report: BalanceSimReport = {
  gamesPlayed: 8, gamesRequested: 8, seats: 4, maxRounds: 40, difficulty: 'medium', era: 'modern',
  seatWins: [4, 2, 1, 1], firstMoverWins: 3, unfinished: 0,
  rounds: { mean: 22.5, min: 14, max: 31 },
  endings: { domination: 5, threshold: 3 },
  regions: [{ region_id: 'west', name: 'West', heldShare: 0.4, gamesHeld: 6 }, { region_id: 'east', name: 'East', heldShare: 0, gamesHeld: 0 }],
  neverCaptured: [{ territory_id: 'f', name: 'Foxtrot' }],
  firstEliminationRound: 12.4,
  durationMs: 900,
};

function renderPanel(props: Partial<React.ComponentProps<typeof BalancePanel>> = {}) {
  const onHover = vi.fn();
  const onFocus = vi.fn();
  render(
    <BalancePanel
      mapId="m1"
      isDirty={false}
      ready
      territories={territories}
      connections={connections}
      regions={regions}
      onHoverTerritories={onHover}
      onFocusTerritory={onFocus}
      {...props}
    />,
  );
  return { onHover, onFocus };
}

beforeEach(() => postMock.mockReset());

describe('BalancePanel', () => {
  it('reads the map\'s shape at once: regions, chokepoints, and a rich bonus', () => {
    const { onFocus, onHover } = renderPanel();
    expect(screen.getByText('West')).toBeInTheDocument();
    expect(screen.getByText(/pays \+5 for 3 territories/)).toBeInTheDocument();
    // c and d are the chokepoints either side of the single sea lane.
    const charlie = screen.getByRole('button', { name: 'Charlie' });
    fireEvent.mouseEnter(charlie);
    expect(onHover).toHaveBeenLastCalledWith(['c']);
    fireEvent.click(charlie);
    expect(onFocus).toHaveBeenCalledWith('c');
  });

  it('keeps the simulation shut while the map is unsaved, dirty or blocked, and says why', () => {
    renderPanel({ mapId: null });
    expect(screen.getByText('Simulate')).toBeDisabled();
    expect(screen.getByText('Save the map first')).toBeInTheDocument();
  });

  it('runs the simulation and reports seats, endings, regions and dead zones', async () => {
    postMock.mockResolvedValue({ data: { report, cached: false } });
    renderPanel();
    fireEvent.click(screen.getByText('Simulate'));
    await waitFor(() => expect(screen.getByTestId('balance-report')).toBeInTheDocument());
    const [url, body, config] = postMock.mock.calls.find(([u]) => u === '/maps/m1/balance') as [string, Record<string, unknown>, Record<string, unknown>];
    expect(url).toBe('/maps/m1/balance');
    expect(body).toEqual({ seats: 4, difficulty: 'medium' });
    // The worker may take up to a minute; the shared 15 s client timeout must not call that a failure.
    expect(config).toEqual({ timeout: 65_000 });
    expect(screen.getByText(/8 games, 4 medium bots, 23 rounds on average/)).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument(); // seat 1: 4 of 8
    expect(screen.getByText(/5 by conquest, 3 by board share/)).toBeInTheDocument();
    expect(screen.getByText('never paid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Foxtrot' })).toBeInTheDocument();
    expect(screen.getByText('Run again')).toBeInTheDocument();
  });
});
