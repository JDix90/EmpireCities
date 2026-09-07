import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ActionModal, {
  type EliminationModalData,
  type EraAdvanceModalData,
  type GameOverModalData,
} from './ActionModal';

/**
 * The game-over view mounts children that render router links (the come-back
 * panel), so every render here needs a Router around it.
 */
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const getMock = vi.fn();
vi.mock('../../services/api', () => ({ api: { get: (...a: unknown[]) => getMock(...a) } }));

/**
 * The game-over view mounts children that fetch on their own (the come-back
 * panel, the chronicle). Every test in this file therefore needs `api.get` to
 * answer *something* for any URL — an undefined return crashes the mount before
 * a single assertion runs.
 */
beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation((url: unknown) =>
    typeof url === 'string' && url.endsWith('/chronicle')
      ? Promise.resolve({ data: { entries: CHRONICLE } })
      : Promise.resolve({ data: {} }),
  );
});

const CHRONICLE = [
  { turn: 1, date: '200', kind: 'opening' as const, headline: '2 powers divide the map' },
  { turn: 12, date: '288', kind: 'conclusion' as const, headline: 'You stand alone' },
];

function eraAdvance(overrides: Partial<EraAdvanceModalData> = {}): EraAdvanceModalData {
  return {
    type: 'era_advance',
    eraId: 'medieval',
    signatureName: 'Levy of Knights',
    signatureDescription: '+1 attack die on your next attack',
    legacyLabel: 'Atom Bomb',
    vulnerable: true,
    ...overrides,
  };
}

describe('ActionModal — era advance payoff', () => {
  it('leads with the era entered and its flavor', () => {
    render(<ActionModal data={eraAdvance()} onDismiss={() => {}} />);
    expect(screen.getByText('Medieval Era')).toBeTruthy();
    expect(screen.getByText('Civilization Ascends')).toBeTruthy();
  });

  it('spotlights the newly-unlocked signature ability', () => {
    render(<ActionModal data={eraAdvance()} onDismiss={() => {}} />);
    expect(screen.getByText('New power unlocked')).toBeTruthy();
    expect(screen.getByText('Levy of Knights')).toBeTruthy();
    expect(screen.getByText('+1 attack die on your next attack')).toBeTruthy();
  });

  it('shows the legacy carry and the vulnerability warning', () => {
    render(<ActionModal data={eraAdvance()} onDismiss={() => {}} />);
    expect(screen.getByText('Atom Bomb')).toBeTruthy();
    expect(screen.getByText(/Vulnerable window/)).toBeTruthy();
  });

  it('omits the new-power and vulnerability sections when absent', () => {
    render(
      <ActionModal
        data={eraAdvance({ signatureName: undefined, signatureDescription: undefined, legacyLabel: undefined, vulnerable: false })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText('New power unlocked')).toBeNull();
    expect(screen.queryByText(/Vulnerable window/)).toBeNull();
    // The era + tech-tree line still render.
    expect(screen.getByText('Medieval Era')).toBeTruthy();
  });

  it('dismisses via the Onward button', () => {
    const onDismiss = vi.fn();
    render(<ActionModal data={eraAdvance()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Onward →'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

function gameOver(overrides: Partial<GameOverModalData> = {}): GameOverModalData {
  return {
    type: 'game_over',
    gameId: 'game-123',
    isWinner: true,
    winnerName: 'You',
    winnerColor: '#fff',
    turnCount: 12,
    players: [
      { player_id: 'p1', username: 'You', color: '#fff', territory_count: 10, is_eliminated: false, is_ai: false },
      { player_id: 'ai_1', username: 'AI', color: '#000', territory_count: 0, is_eliminated: true, is_ai: true },
    ],
    victory_condition: 'domination',
    ...overrides,
  };
}

describe('ActionModal — game-over Clip CTA', () => {
  it('deep-links the auto-clip flow with the game id', () => {
    const onShareClip = vi.fn();
    render(
      <ActionModal
        data={gameOver()}
        onDismiss={() => {}}
        onWatchReplay={() => {}}
        onShareClip={onShareClip}
      />,
    );
    fireEvent.click(screen.getByText('Clip'));
    expect(onShareClip).toHaveBeenCalledWith('game-123');
  });

  it('is absent without a handler, and when no replay exists to link into', () => {
    const { rerender } = render(
      <ActionModal data={gameOver()} onDismiss={() => {}} onWatchReplay={() => {}} />,
    );
    expect(screen.queryByText('Clip')).toBeNull();
    // Abandoned matches hide Watch Replay; the clip CTA rides the same gate.
    rerender(
      <MemoryRouter>
        <ActionModal
          data={gameOver({ victory_condition: 'abandoned' })}
          onDismiss={() => {}}
          onWatchReplay={() => {}}
          onShareClip={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Clip')).toBeNull();
  });
});

function elimination(overrides: Partial<EliminationModalData> = {}): EliminationModalData {
  return {
    type: 'elimination',
    eliminatedName: 'You',
    eliminatorName: 'Carthage',
    isSelf: true,
    ...overrides,
  };
}

describe('ActionModal — elimination exit', () => {
  it('leaves the game for real, rather than only closing the card', () => {
    // The bug: "Leave" was wired to the same `onDismiss` as "Spectate", so the
    // player pressed it, stayed in the match, and then had no exit at all —
    // Save & Leave lives in the turn-actions block, which is hidden once you
    // are eliminated.
    const onDismiss = vi.fn();
    const onLeaveGame = vi.fn();
    render(<ActionModal data={elimination()} onDismiss={onDismiss} onLeaveGame={onLeaveGame} />);
    fireEvent.click(screen.getByText('Leave'));
    expect(onLeaveGame).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('still keeps Spectate as a dismiss', () => {
    const onDismiss = vi.fn();
    const onLeaveGame = vi.fn();
    render(<ActionModal data={elimination()} onDismiss={onDismiss} onLeaveGame={onLeaveGame} />);
    fireEvent.click(screen.getByText('Spectate'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onLeaveGame).not.toHaveBeenCalled();
  });

  it('does not hijack the Continue button when someone else was eliminated', () => {
    const onDismiss = vi.fn();
    const onLeaveGame = vi.fn();
    render(
      <ActionModal
        data={elimination({ isSelf: false, eliminatedName: 'Gaul' })}
        onDismiss={onDismiss}
        onLeaveGame={onLeaveGame}
      />,
    );
    fireEvent.click(screen.getByText('Continue'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onLeaveGame).not.toHaveBeenCalled();
  });
});

describe('ActionModal — game-over Chronicle tab', () => {
  it('offers the match as a history beside the numbers', async () => {
    render(<ActionModal data={gameOver()} onDismiss={() => {}} />);
    const tab = await screen.findByRole('button', { name: 'Chronicle' });
    fireEvent.click(tab);
    expect(await screen.findByTestId('gameover-chronicle')).toBeInTheDocument();
    expect(screen.getByText('2 powers divide the map')).toBeInTheDocument();
    expect(screen.getByText('288')).toBeInTheDocument();
  });

  it('carries the chronicle into the replay rather than dropping you on a bare board', async () => {
    const onWatchReplay = vi.fn();
    render(<ActionModal data={gameOver()} onDismiss={() => {}} onWatchReplay={onWatchReplay} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chronicle' }));
    fireEvent.click(await screen.findByRole('button', { name: /Watch it play out/ }));
    expect(onWatchReplay).toHaveBeenCalledWith('game-123', { withChronicle: true });
  });

  it('hides the tab entirely when the match has no history to tell', async () => {
    getMock.mockImplementation((url: unknown) =>
      typeof url === 'string' && url.endsWith('/chronicle')
        ? Promise.resolve({ data: { entries: [] } })
        : Promise.resolve({ data: {} }),
    );
    render(<ActionModal data={gameOver()} onDismiss={() => {}} />);
    // Results is always there; wait on it so the fetch has settled first.
    await screen.findByRole('button', { name: 'Results' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Chronicle' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Match Stats' })).toBeInTheDocument();
  });
});
