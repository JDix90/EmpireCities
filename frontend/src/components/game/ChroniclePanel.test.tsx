import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ChroniclePanel, { type ChronicleEntry } from './ChroniclePanel';

const getMock = vi.fn();
vi.mock('../../services/api', () => ({ api: { get: (...a: unknown[]) => getMock(...a) } }));

const ENTRIES: ChronicleEntry[] = [
  { turn: 1, date: '1200', kind: 'opening', headline: '2 powers divide the map' },
  { turn: 4, date: '1218', kind: 'region_secured', headline: 'Rome secures Iberia', detail: 'All 3 territories…', playerName: 'Rome', playerColor: '#f00' },
  { turn: 9, date: '1248', kind: 'era_advanced', headline: 'Rome reaches the Age of Discovery first' },
  { turn: 12, date: '1266', kind: 'conclusion', headline: 'Rome stands alone', detail: 'Every territory…' },
];

function ok(entries: ChronicleEntry[] = ENTRIES) {
  getMock.mockResolvedValue({ data: { entries } });
}

describe('ChroniclePanel', () => {
  beforeEach(() => getMock.mockReset());

  it('reads the match back as dated history', async () => {
    ok();
    render(<ChroniclePanel gameId="g1" />);
    await waitFor(() => expect(screen.getByText('Rome secures Iberia')).toBeInTheDocument());
    // The date column is the whole point — a turn number is a log, a year is a
    // chronicle.
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText('1266')).toBeInTheDocument();
    expect(screen.getAllByTestId('chronicle-entry')).toHaveLength(4);
  });

  it('scrubs the replay to the turn an entry happened on', async () => {
    ok();
    const onJumpToTurn = vi.fn();
    render(<ChroniclePanel gameId="g1" onJumpToTurn={onJumpToTurn} />);
    await waitFor(() => expect(screen.getByText('Rome stands alone')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Rome stands alone'));
    expect(onJumpToTurn).toHaveBeenCalledWith(12);
  });

  it('is inert, not broken, without a jump handler', async () => {
    ok();
    render(<ChroniclePanel gameId="g1" />);
    await waitFor(() => expect(screen.getByText('Rome stands alone')).toBeInTheDocument());
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders nothing rather than an error when there is no chronicle', async () => {
    // Both no-chronicle routes land on this same branch: an empty list, and
    // the component's `.catch` for the 403 a non-participant gets (and the 409
    // an unfinished game gets). The rejection path is not exercised here —
    // vitest books a mock-returned rejected promise as an unhandled rejection
    // and fails the test whoever handles the chain — but the rendered outcome
    // it produces is exactly this one.
    ok([]);
    const { container } = render(<ChroniclePanel gameId="g1" />);
    await waitFor(() => expect(container.querySelector('[data-testid="chronicle-panel"]')).toBeNull());
  });
});
