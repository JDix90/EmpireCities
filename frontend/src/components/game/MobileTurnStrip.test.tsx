import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MobileTurnStrip from './MobileTurnStrip';
import type { TurnRecapEntry } from './AiTurnRecapPanel';
import { useGameStore, type CombatResult, type GameState } from '../../store/gameStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

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

    it('rolls each side in its dice skin (store_v2_enabled), plain otherwise', () => {
      const players = [
        { player_id: AI, cosmetics: undefined },
        { player_id: ME, cosmetics: { dice: 'bone_dice' } },
      ];
      useGameStore.setState({ gameState: { players } as unknown as GameState });
      const setStoreV2 = (on: boolean) =>
        useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, store_v2_enabled: on } }));
      const live = () => (
        <MobileTurnStrip recaps={[]} viewerPlayerId={ME} liveCombat={combat()} isMyTurn={false} acted={false} onOpenFullLog={() => {}} />
      );
      try {
        setStoreV2(true);
        const { unmount } = render(live());
        // The AI attacker wears nothing; the viewer defends in bone dice.
        expect(screen.getAllByTestId('skinned-die')).toHaveLength(1);
        expect(screen.getByTestId('skinned-die')).toHaveClass('ring-blue-500/80');
        unmount();

        setStoreV2(false);
        render(live());
        expect(screen.queryAllByTestId('skinned-die')).toHaveLength(0);
      } finally {
        setStoreV2(false);
        useGameStore.setState({ gameState: null });
      }
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

  describe('notices (phase 2)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const deploy = (key: number, remaining: number) => ({
      key,
      data: {
        type: 'reinforce' as const,
        text: '+1 troops deployed to Persia',
        subtext: `${remaining} remaining`,
        icon: 'shield' as const,
        accentBg: 'bg-emerald-500/20',
        accentBorder: 'border-emerald-500/30',
        accentText: 'text-emerald-400',
      },
    });
    const el = (over: Partial<Parameters<typeof MobileTurnStrip>[0]> = {}) => (
      <MobileTurnStrip recaps={LOSSES} viewerPlayerId={ME} liveCombat={null} isMyTurn acted notice={null} onOpenFullLog={() => {}} {...over} />
    );

    it("shows the viewer's own move in the line in place of the pill, then gives the pill back", () => {
      const { rerender } = render(el());
      expect(screen.getByTestId('turn-strip-pill')).toBeTruthy();
      rerender(el({ notice: deploy(1, 2) }));
      const notice = screen.getByTestId('turn-strip-notice');
      expect(notice.textContent).toContain('+1 troops deployed to Persia');
      expect(notice.textContent).toContain('2 remaining');
      expect(screen.queryByTestId('turn-strip-pill')).toBeNull();
      act(() => { vi.advanceTimersByTime(2300); });
      expect(screen.queryByTestId('turn-strip-notice')).toBeNull();
      expect(screen.getByTestId('turn-strip-pill')).toBeTruthy();
    });

    it('lets a newer notice replace the one showing instead of queueing behind it', () => {
      const first = deploy(1, 2);
      const second = deploy(2, 1);
      const { rerender } = render(el({ notice: first }));
      act(() => { vi.advanceTimersByTime(1500); });
      rerender(el({ notice: second }));
      expect(screen.getByTestId('turn-strip-notice').textContent).toContain('1 remaining');
      // The clock restarted with the second notice: still up past the first one's deadline.
      act(() => { vi.advanceTimersByTime(1500); });
      rerender(el({ notice: second }));
      expect(screen.getByTestId('turn-strip-notice').textContent).toContain('1 remaining');
      act(() => { vi.advanceTimersByTime(800); });
      expect(screen.queryByTestId('turn-strip-notice')).toBeNull();
    });

    it('shows a notice with nothing else to say, and nothing once it is gone', () => {
      const { container } = render(el({ recaps: [], notice: deploy(1, 0) }));
      expect(screen.getByTestId('turn-strip-notice').textContent).toContain('0 remaining');
      act(() => { vi.advanceTimersByTime(2300); });
      expect(container.firstChild).toBeNull();
    });

    it('keeps a fresh battle against the viewer ahead of a notice', () => {
      const { rerender } = render(el({ recaps: [], isMyTurn: false, acted: false }));
      rerender(el({ recaps: [], isMyTurn: false, acted: false, liveCombat: combat(), notice: deploy(1, 2) }));
      expect(screen.getByTestId('turn-strip-live')).toBeTruthy();
      expect(screen.queryByTestId('turn-strip-notice')).toBeNull();
    });
  });

  describe('history (phase 3)', () => {
    const HISTORY = [
      { turnNumber: 3, entries: [recap('Marshal Okonkwo', [combat({ attackerId: OTHER_AI, toId: 'hispania', toName: 'Hispania', territory_captured: true })], 3)] },
      { turnNumber: 4, entries: [recap('Admiral Chen', [combat({ attackerId: AI, defenderId: OTHER_AI })], 4)] },
    ];

    it('keeps the pill alone when only history is left, and opens on the latest round', () => {
      const onScrub = vi.fn();
      strip({ recaps: [], history: HISTORY, isMyTurn: false, onScrub });
      expect(screen.queryByTestId('turn-strip-line')).toBeNull();
      fireEvent.click(screen.getByTestId('turn-strip-pill'));
      expect(screen.getByTestId('turn-strip-sheet-title').textContent).toBe('Turn 4 · 1 turn ago');
      expect(screen.getByText('Admiral Chen')).toBeTruthy();
      expect(screen.queryByText('Marshal Okonkwo')).toBeNull();
      expect((screen.getByTestId('turn-strip-scrubber') as HTMLInputElement).value).toBe('1');
      // No losses of the viewer's in that round: nothing for the map to pulse.
      expect(onScrub).toHaveBeenLastCalledWith([]);
    });

    it('scrubs to an earlier round, pulses its losses, and hands the map back on Now', () => {
      const onScrub = vi.fn();
      strip({ history: HISTORY, onScrub });
      fireEvent.click(screen.getByTestId('turn-strip-line'));
      // Something current: the sheet opens on Now.
      const slider = screen.getByTestId('turn-strip-scrubber') as HTMLInputElement;
      expect(slider.value).toBe('2');
      expect(screen.getByTestId('turn-strip-sheet-title').textContent).toContain('While you were away');
      expect(onScrub).toHaveBeenLastCalledWith(null);

      fireEvent.change(slider, { target: { value: '0' } });
      expect(screen.getByTestId('turn-strip-sheet-title').textContent).toBe('Turn 3 · 2 turns ago');
      expect(screen.getByText('Marshal Okonkwo')).toBeTruthy();
      expect(onScrub).toHaveBeenLastCalledWith(['hispania']);

      fireEvent.click(screen.getByRole('button', { name: 'Later turn' }));
      expect(screen.getByTestId('turn-strip-sheet-title').textContent).toBe('Turn 4 · 1 turn ago');
      fireEvent.click(screen.getByRole('button', { name: 'Later turn' }));
      expect(screen.getByTestId('turn-strip-sheet-title').textContent).toContain('While you were away');
      expect(onScrub).toHaveBeenLastCalledWith(null);
      expect(screen.getByRole('button', { name: 'Later turn' })).toHaveProperty('disabled', true);
    });

    it('stops pulsing when the sheet closes', () => {
      const onScrub = vi.fn();
      strip({ history: HISTORY, onScrub });
      fireEvent.click(screen.getByTestId('turn-strip-line'));
      fireEvent.change(screen.getByTestId('turn-strip-scrubber'), { target: { value: '0' } });
      expect(onScrub).toHaveBeenLastCalledWith(['hispania']);
      fireEvent.click(screen.getAllByRole('button', { name: 'Close recap' })[0]);
      expect(screen.queryByTestId('turn-strip-sheet')).toBeNull();
      expect(onScrub).toHaveBeenLastCalledWith(null);
    });

    it('shows no scrubber without history', () => {
      strip();
      fireEvent.click(screen.getByTestId('turn-strip-line'));
      expect(screen.queryByTestId('turn-strip-scrubber')).toBeNull();
    });
  });
});
