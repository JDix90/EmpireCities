import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MobileTurnStrip from './MobileTurnStrip';
import type { TurnRecapEntry } from './AiTurnRecapPanel';
import type { CombatResult } from '../../store/gameStore';

const ME = 'me';
const AI = 'ai_1';
const OTHER_AI = 'ai_2';

function combat(over: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6, 5],
    defender_rolls: [3],
    attacker_losses: 0,
    defender_losses: 1,
    territory_captured: false,
    attackerId: AI,
    defenderId: ME,
    attackerName: 'Admiral Chen',
    defenderName: 'Darth_Jefe',
    fromId: 'kushan',
    toId: 'persia',
    fromName: 'Kushan Empire',
    toName: 'Persia',
    ...over,
  } as CombatResult;
}

function recap(playerName: string, combats: CombatResult[], turnNumber = 4): TurnRecapEntry {
  return { playerName, playerColor: '#0f0', turnNumber, combats };
}

/** The reported turn: Persia lost to Chen, Hispania to Okonkwo, plus AI-on-AI fights. */
const LOSSES = [
  recap('Admiral Chen', [
    combat({ attackerId: AI, defenderId: OTHER_AI, toId: 'china', toName: 'Central China', territory_captured: true }),
    combat({ territory_captured: true }),
  ]),
  recap('Marshal Okonkwo', [combat({ attackerId: OTHER_AI, toId: 'hispania', toName: 'Hispania', territory_captured: true })], 5),
];

function strip(over: Partial<Parameters<typeof MobileTurnStrip>[0]> = {}) {
  return render(
    <MobileTurnStrip
      recaps={LOSSES}
      viewerPlayerId={ME}
      liveCombat={null}
      isMyTurn
      acted={false}
      onOpenFullLog={() => {}}
      {...over}
    />,
  );
}

describe('MobileTurnStrip', () => {
  it('renders nothing with no recaps and no live battle', () => {
    const { container } = strip({ recaps: [] });
    expect(container.firstChild).toBeNull();
  });

  it('names the loss in one line and never opens over the map by itself', () => {
    strip();
    expect(screen.getByTestId('turn-strip-line').textContent).toContain('Lost Persia, Hispania');
    expect(screen.getByTestId('turn-strip-line').textContent).toContain('3 battles');
    expect(screen.queryByTestId('turn-strip-sheet')).toBeNull();
    // The desktop panel's per-player rows are not on screen until asked for.
    expect(screen.queryByText('Admiral Chen')).toBeNull();
  });

  it('opens the sheet with the per-player rows on tap, and closes it', () => {
    const onOpenFullLog = vi.fn();
    strip({ onOpenFullLog });
    fireEvent.click(screen.getByTestId('turn-strip-line'));
    expect(screen.getByTestId('turn-strip-sheet')).toBeTruthy();
    expect(screen.getByText('Admiral Chen')).toBeTruthy();
    expect(screen.getByText('Marshal Okonkwo')).toBeTruthy();
    fireEvent.click(screen.getByText('View full log →'));
    expect(onOpenFullLog).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('turn-strip-sheet')).toBeNull();
  });

  it('shrinks to a pill once the viewer has made their first move', () => {
    strip({ acted: true });
    expect(screen.queryByTestId('turn-strip-line')).toBeNull();
    const pill = screen.getByTestId('turn-strip-pill');
    expect(pill.textContent).toContain('2');
    fireEvent.click(pill);
    expect(screen.getByTestId('turn-strip-sheet')).toBeTruthy();
  });

  it('shows a running count while watching, with the attacked badge', () => {
    const quiet = [recap('Admiral Chen', [combat({ attackerId: AI, defenderId: OTHER_AI }), combat()])];
    strip({ recaps: quiet, isMyTurn: false });
    const line = screen.getByTestId('turn-strip-line');
    expect(line.textContent).toContain('1 turn');
    expect(line.textContent).toContain('2 battles');
    expect(line.textContent).toContain('1'); // the attacked badge
  });

  describe('the live line', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('carries a battle against the viewer during another turn, then gives way', () => {
      const { rerender } = render(
        <MobileTurnStrip recaps={[]} viewerPlayerId={ME} liveCombat={null} isMyTurn={false} acted={false} onOpenFullLog={() => {}} />,
      );
      rerender(
        <MobileTurnStrip recaps={[]} viewerPlayerId={ME} liveCombat={combat({ territory_captured: true })} isMyTurn={false} acted={false} onOpenFullLog={() => {}} />,
      );
      const live = screen.getByTestId('turn-strip-live');
      expect(live.textContent).toContain('Admiral Chen → Persia');
      expect(live.textContent).toContain('Lost!');
      act(() => { vi.advanceTimersByTime(6100); });
      expect(screen.queryByTestId('turn-strip-live')).toBeNull();
    });

    it('ignores a fight between two other players', () => {
      // The reported screenshot: Doukas vs Okonkwo narrated on the player's screen.
      render(
        <MobileTurnStrip
          recaps={[]}
          viewerPlayerId={ME}
          liveCombat={combat({ attackerId: AI, defenderId: OTHER_AI, defenderName: 'Marshal Okonkwo' })}
          isMyTurn={false}
          acted={false}
          onOpenFullLog={() => {}}
        />,
      );
      expect(screen.queryByTestId('turn-strip-live')).toBeNull();
    });

    it("does not narrate the viewer's own attacks: their modal already does", () => {
      render(
        <MobileTurnStrip
          recaps={[]}
          viewerPlayerId={ME}
          liveCombat={combat({ attackerId: ME, defenderId: AI })}
          isMyTurn
          acted={false}
          onOpenFullLog={() => {}}
        />,
      );
      expect(screen.queryByTestId('turn-strip-live')).toBeNull();
    });
  });
});
