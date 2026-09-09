import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GameHUD from './GameHUD';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../services/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));

function player(id: string, idx: number, extra: Record<string, unknown> = {}) {
  return {
    player_id: id, player_index: idx, username: id, color: '#fff', is_ai: false,
    is_eliminated: false, territory_count: 3, cards: [], mmr: 1000,
    capital_territory_id: null, secret_mission: null,
    special_resource: 42, tech_points: 11, ...extra,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1', era: 'ancient', map_id: 'm1', phase: 'attack',
    current_player_index: 0, turn_number: 7,
    players: [player('me', 0), player('rival', 1, { username: 'Rival' })],
    territories: {},
    card_set_redemption_count: 0,
    turn_started_at: Date.now(),
    settings: { economy_enabled: true, tech_trees_enabled: true } as GameState['settings'],
    ...overrides,
  } as GameState;
}

function renderHud(props: Partial<React.ComponentProps<typeof GameHUD>> = {}) {
  return render(
    <MemoryRouter>
      <GameHUD
        onAdvancePhase={() => {}}
        onRedeemCards={() => {}}
        onResign={() => {}}
        onSaveAndLeave={() => {}}
        onOpenTechTree={() => {}}
        onOpenBonuses={() => {}}
        lastCombatLog={[]}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('GameHUD — tabbed redesign (#9)', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
    useGameStore.setState({ gameState: makeState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
  });

  it('renders the three reference tabs and the pinned phase header', () => {
    renderHud();
    expect(screen.getByRole('tab', { name: /Status/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Players/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Log/ })).toBeInTheDocument();
    // Phase header pinned (turn + phase always visible).
    expect(screen.getByText(/Turn 7/)).toBeInTheDocument();
  });

  it('defaults to Status (resources visible, roster hidden)', () => {
    renderHud();
    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('42 PP')).toBeInTheDocument();
    expect(screen.queryByText('Rival')).toBeNull();
  });

  it('shows Helium-3 whenever the Space Age lunar economy is on', () => {
    // Shown from the moment the rules are on, not once the player has some: a
    // resource you only discover after already earning it is not an incentive
    // to go and get it.
    useGameStore.setState({
      gameState: makeState({
        settings: {
          economy_enabled: true, tech_trees_enabled: true, space_age_moon_helium3_enabled: true,
        } as GameState['settings'],
      }),
      draftUnitsRemaining: 0, lastCombatResult: null,
    } as never);
    renderHud();
    expect(screen.getByTestId('hud-helium3')).toHaveTextContent('0 He-3');
  });

  it('keeps Helium-3 off the HUD in every era that does not have a Moon', () => {
    renderHud();
    expect(screen.queryByTestId('hud-helium3')).toBeNull();
  });

  it('shows the roster only on the Players tab', () => {
    renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    expect(screen.getByText('Rival')).toBeInTheDocument();
    expect(screen.queryByText('Resources')).toBeNull();
  });

  it('shows the combat log only on the Log tab', () => {
    renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Log/ }));
    expect(screen.getByText(/No battles yet/)).toBeInTheDocument();
  });

  it('keeps the end-phase action button pinned regardless of tab', () => {
    renderHud();
    // In the attack phase the advance button reads "Begin Fortify →".
    expect(screen.getByRole('button', { name: /Begin Fortify/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Log/ }));
    expect(screen.getByRole('button', { name: /Begin Fortify/ })).toBeInTheDocument();
  });

  it('tucks utilities behind the Tools drawer', () => {
    renderHud();
    expect(screen.queryByRole('button', { name: /Resign/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tools & options/ }));
    expect(screen.getByRole('button', { name: /Resign/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Leave/ })).toBeInTheDocument();
  });

  it('persists the selected tab across remounts', () => {
    const first = renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    first.unmount();
    renderHud();
    // Players tab restored from localStorage → roster visible immediately.
    expect(screen.getByText('Rival')).toBeInTheDocument();
  });
});

describe('GameHUD — the eliminated player\'s way out', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
  });

  it('offers an exit once you are out of the game', () => {
    // Turn actions — and with them Save & Leave, inside Tools & options — are
    // hidden for an eliminated player. Without a dedicated exit, a player who
    // chose "Spectate" (or pressed the old, broken "Leave") was stuck in the
    // match with no control that would take them out of it.
    const onLeaveGame = vi.fn();
    useGameStore.setState({
      gameState: makeState({
        players: [player('me', 0, { is_eliminated: true, territory_count: 0 }), player('rival', 1, { username: 'Rival' })],
        current_player_index: 1,
      }),
      draftUnitsRemaining: 0,
      lastCombatResult: null,
    } as never);
    renderHud({ onLeaveGame });
    const exit = screen.getByRole('button', { name: /Leave game/ });
    fireEvent.click(exit);
    expect(onLeaveGame).toHaveBeenCalledTimes(1);
    // The turn-action block really is gone — this is the only way out.
    expect(screen.queryByRole('button', { name: /Begin Fortify/ })).toBeNull();
  });

  it('stays out of the way while you are still playing', () => {
    useGameStore.setState({ gameState: makeState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ onLeaveGame: () => {} });
    expect(screen.queryByRole('button', { name: /Leave game/ })).toBeNull();
    // Save & Leave (which promises a resumable game) is still the live path.
    fireEvent.click(screen.getByRole('button', { name: /Tools & options/ }));
    expect(screen.getByRole('button', { name: /Save & Leave/ })).toBeInTheDocument();
  });
});
