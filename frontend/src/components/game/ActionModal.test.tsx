import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionModal, { type EraAdvanceModalData, type GameOverModalData } from './ActionModal';

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
      <ActionModal
        data={gameOver({ victory_condition: 'abandoned' })}
        onDismiss={() => {}}
        onWatchReplay={() => {}}
        onShareClip={() => {}}
      />,
    );
    expect(screen.queryByText('Clip')).toBeNull();
  });
});
