import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getMock = vi.fn();
vi.mock('../../services/api', () => ({ api: { get: (...a: unknown[]) => getMock(...a) } }));

import AdminGalaxyReportPanel, {
  pct,
  seriesByDay,
  type GalaxyRate,
  type GalaxyReport,
  type GalaxyReportSeat,
} from './AdminGalaxyReportPanel';

beforeAll(() => {
  // recharts' ResponsiveContainer measures its box; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function rate(key: string, wins: number, seats: number, share: number, low: number, high: number): GalaxyRate {
  return { key, wins, seats, expected: share * seats, rate: wins / seats, expected_rate: share, low, high };
}

function seat(n: number, over: Partial<GalaxyReportSeat>): GalaxyReportSeat {
  return {
    seat: n, user_id: `u${n}`, username: `player${n}`, is_ai: false, ai_difficulty: null, faction_id: null,
    world_id: null, house: null, role: 'home', side: null, reinforce_bonus: null, won: false,
    eliminated: false, resigned: false, territories: 10,
    ...over,
  };
}

const report: GalaxyReport = {
  filters: { days: null, seats: null, mode: null, relations: null },
  total_games: 2,
  truncated: false,
  unrecorded_games: 1,
  analytics: {
    games: 2,
    decisive: 1,
    avg_turns: 30.5,
    median_minutes: 42,
    modes: [{ mode: 'partial_schism', seats: 5, relations: 'allied', games: 2, avg_turns: 30.5 }],
    endings: [{ victory: 'lane_sovereignty', games: 1 }, { victory: 'turn_limit', games: 1 }],
    factions: [rate('stellar_mandate', 4, 4, 0.25, 0.51, 1), rate('forge_syndicate', 0, 2, 0.25, 0, 0.66)],
    roles: [rate('ally', 4, 4, 0.25, 0.51, 1), rate('whole', 0, 20, 0.25, 0, 0.16)],
    houses: [{ ...rate('Western Mandate|ally', 2, 2, 0.25, 0.34, 1), house: 'Western Mandate', role: 'ally' }],
    players: [rate('human', 2, 3, 0.25, 0.21, 0.94), rate('ai:expert', 2, 7, 0.25, 0.08, 0.64)],
    first_seat: rate('first_seat', 1, 2, 0.25, 0.09, 0.91),
    by_day: [{ day: '2026-09-28', games: 1 }, { day: '2026-09-30', games: 1 }],
  },
  games: [
    {
      game_id: 'g1',
      finished_at: '2026-09-30T12:00:00.000Z',
      started_at: '2026-09-30T11:18:00.000Z',
      ended_at: '2026-09-30T12:00:00.000Z',
      seats: 5, mode: 'partial_schism', relations: 'allied', board: 'nexus_station+sol',
      victory: 'lane_sovereignty', turns: 31, first_seat: 0, humans: 2,
      seat_results: [
        seat(0, { username: 'alice', faction_id: 'stellar_mandate', world_id: 'sol', house: 'Western Mandate', role: 'ally', side: 'sol', won: true }),
        seat(1, { user_id: null, username: null, is_ai: true, ai_difficulty: 'expert', faction_id: 'forge_syndicate', world_id: 'rust', role: 'whole', side: 'rust', eliminated: true }),
        seat(2, { user_id: null, username: null, faction_id: 'helion_navigators', world_id: 'verdan', role: 'whole', side: 'verdan', resigned: true, eliminated: true }),
      ],
    },
  ],
};

const empty: GalaxyReport = {
  ...report,
  total_games: 0,
  unrecorded_games: 0,
  analytics: { ...report.analytics, games: 0, decisive: 0, factions: [], roles: [], houses: [], players: [], first_seat: null, by_day: [], endings: [], modes: [] },
  games: [],
};

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ data: report });
});

describe('AdminGalaxyReportPanel', () => {
  it('fetches the report and shows its tallies, rates, endings, boards and games', async () => {
    render(<AdminGalaxyReportPanel />);
    expect(await screen.findByText('Games finished')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/admin/metrics/galaxy', { params: {} });

    expect(screen.getByText('Won on the board').parentElement).toHaveTextContent('50%'); // 1 of 2
    expect(screen.getByText('30.5 turns')).toBeInTheDocument();
    expect(screen.getByText('median 42 min')).toBeInTheDocument();

    const sol = screen.getByLabelText(/^Stellar Mandate \(Sol\): won 4 of 4 seats, 100%; fair share 25%/);
    expect(sol).toHaveTextContent('above share');
    const rust = screen.getByLabelText(/^Forge Syndicate \(Rust\): won 0 of 2 seats/);
    expect(rust).not.toHaveTextContent('above share');
    expect(rust).not.toHaveTextContent('below share');

    expect(screen.getByText('Lane Sovereignty', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Turn limit')).toBeInTheDocument();
    expect(screen.getByText('Partial Schism · 5 seats · Allied')).toBeInTheDocument();
    expect(screen.getByText('Partial Schism · 5 seats · Allied · Sol + Nexus split')).toBeInTheDocument();

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('AI (expert)')).toBeInTheDocument();
    expect(screen.getByText('Deleted account')).toBeInTheDocument();
    expect(screen.getByText(/· resigned/)).toBeInTheDocument();
    expect(screen.getByText('42 min')).toBeInTheDocument();
    expect(screen.getByText(/1 finished Galactic Age game in\s+this window ended before the report started recording/)).toBeInTheDocument();
  });

  it('switches the win-rate breakdown between factions, roles, houses and players', async () => {
    render(<AdminGalaxyReportPanel />);
    await screen.findByText('Games finished');
    fireEvent.click(screen.getByRole('button', { name: 'Roles' }));
    expect(screen.getByLabelText(/^Allied house: won 4 of 4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Whole world \(Allied\): won 0 of 20/)).toHaveTextContent('below share');
    fireEvent.click(screen.getByRole('button', { name: 'Schism houses' }));
    expect(screen.getByLabelText(/^Western Mandate · allied house: won 2 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Humans & AI' }));
    expect(screen.getByLabelText(/^Humans: won 2 of 3/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^AI · expert: won 2 of 7/)).toBeInTheDocument();
  });

  it('refetches with its filters, as query parameters', async () => {
    render(<AdminGalaxyReportPanel />);
    await screen.findByText('Games finished');
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '5' } });
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/admin/metrics/galaxy', { params: { seats: 5 } }));
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Board'), { target: { value: 'partial_schism' } });
    fireEvent.change(screen.getByLabelText('House relations'), { target: { value: 'allied' } });
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/admin/metrics/galaxy', {
      params: { days: 30, seats: 5, mode: 'partial_schism', relations: 'allied' },
    }));
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '' } });
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith('/admin/metrics/galaxy', {
      params: { days: 30, mode: 'partial_schism', relations: 'allied' },
    }));
  });

  it('refetches when the page refreshes it', async () => {
    const { rerender } = render(<AdminGalaxyReportPanel refreshKey={1} />);
    await screen.findByText('Games finished');
    expect(getMock).toHaveBeenCalledTimes(1);
    rerender(<AdminGalaxyReportPanel refreshKey={2} />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('says when nothing is recorded, and shows the server error when the fetch fails', async () => {
    getMock.mockResolvedValueOnce({ data: empty });
    const { unmount } = render(<AdminGalaxyReportPanel />);
    expect(await screen.findByText('No finished Galactic Age games recorded for these filters.')).toBeInTheDocument();
    unmount();
    getMock.mockRejectedValueOnce({ response: { data: { error: 'Admin access required' } } });
    render(<AdminGalaxyReportPanel />);
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });
});

describe('formatting', () => {
  it('prints a rate without a trailing .0', () => {
    expect(pct(0.25)).toBe('25%');
    expect(pct(0.125)).toBe('12.5%');
    expect(pct(0)).toBe('0%');
  });

  it('fills the days between games with zero, and goes weekly past 60 days', () => {
    expect(seriesByDay([{ day: '2026-09-28', games: 1 }, { day: '2026-09-30', games: 2 }])).toEqual({
      points: [
        { day: '2026-09-28', games: 1 },
        { day: '2026-09-29', games: 0 },
        { day: '2026-09-30', games: 2 },
      ],
      weekly: false,
    });
    const long = seriesByDay([{ day: '2026-06-01', games: 3 }, { day: '2026-09-30', games: 1 }]);
    expect(long.weekly).toBe(true);
    expect(long.points[0]).toEqual({ day: '2026-06-01', games: 3 }); // a Monday
    expect(long.points.reduce((n, p) => n + p.games, 0)).toBe(4);
    expect(seriesByDay([])).toEqual({ points: [], weekly: false });
  });
});
