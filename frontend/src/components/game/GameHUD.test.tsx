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

  const withMoon = {
    map_id: 'era_space_age',
    territories: [
      { territory_id: 'na_launch_base', region_id: 'north_america_2100' },
      { territory_id: 'moon_polar_north', region_id: 'lunar_surface', globe_id: 'moon' },
    ],
    connections: [],
  };

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
    renderHud({ mapData: withMoon });
    expect(screen.getByTestId('hud-helium3')).toHaveTextContent('0 He-3');
  });

  it('keeps Helium-3 off the HUD in every era that does not have a Moon', () => {
    renderHud();
    expect(screen.queryByTestId('hud-helium3')).toBeNull();
  });

  it('keeps it off a moonless board even with the phase baked in', () => {
    // An Epic climb from Ancient carries the Moon Race settings (they are baked
    // at create for any game that will reach the Space Age) but never gets a
    // Moon: the board transform that would bring one is parked.
    useGameStore.setState({
      gameState: makeState({
        settings: {
          economy_enabled: true, tech_trees_enabled: true, space_age_moon_helium3_enabled: true,
        } as GameState['settings'],
      }),
      draftUnitsRemaining: 0, lastCombatResult: null,
    } as never);
    renderHud({
      mapData: { map_id: 'era_ancient', territories: [{ territory_id: 'italia', region_id: 'europe' }], connections: [] },
    });
    expect(screen.queryByTestId('hud-helium3')).toBeNull();
  });

  describe('the Lunar Hegemony clock', () => {
    // Shown to everyone, not just the holder: the whole phase rests on rivals
    // being able to see the countdown and go break it.
    const hegemonyState = (owner: string, turnsHeld: number) => makeState({
      settings: {
        economy_enabled: true, tech_trees_enabled: true,
        space_age_moon_hegemony_enabled: true,
        allowed_victory_conditions: ['domination', 'lunar_hegemony'],
      } as GameState['settings'],
      lunar_hegemony: { owner_id: owner, turns_held: turnsHeld, started_turn: 3 },
    } as Partial<GameState>);

    it('counts down for a rival who has to answer it', () => {
      useGameStore.setState({
        gameState: hegemonyState('rival', 4), draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud();
      expect(screen.getByTestId('hud-hegemony')).toHaveTextContent('Rival holds the Moon · Hegemony in 3');
    });

    it('reads differently when the Moon is yours', () => {
      useGameStore.setState({
        gameState: hegemonyState('me', 1), draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud();
      expect(screen.getByTestId('hud-hegemony')).toHaveTextContent('You hold the Moon · Hegemony in 6');
    });

    it('counts down from the clock length THIS game runs on', () => {
      // §9 lists 4-8 as the range a game may be set to. A banner counting from
      // the default when the game runs a shorter clock tells every rival they
      // have turns they do not have.
      useGameStore.setState({
        gameState: makeState({
          settings: {
            economy_enabled: true, tech_trees_enabled: true,
            space_age_moon_hegemony_enabled: true, space_age_hegemony_turns: 5,
            allowed_victory_conditions: ['domination', 'lunar_hegemony'],
          } as GameState['settings'],
          lunar_hegemony: { owner_id: 'rival', turns_held: 4, started_turn: 3 },
        } as Partial<GameState>),
        draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud();
      expect(screen.getByTestId('hud-hegemony')).toHaveTextContent('Hegemony in 1');
    });

    it('shows nothing while no clock is running', () => {
      useGameStore.setState({
        gameState: makeState({
          settings: {
            economy_enabled: true, tech_trees_enabled: true,
            space_age_moon_hegemony_enabled: true,
          } as GameState['settings'],
        }),
        draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud();
      expect(screen.queryByTestId('hud-hegemony')).toBeNull();
    });

    it('shows nothing in a game that cannot be won that way', () => {
      // The phase without the victory condition: every lobby game created
      // before the Hegemony joined the lobby's own list. The server leaves such
      // a clock alone, so counting it down would be a threat that isn't one.
      useGameStore.setState({
        gameState: makeState({
          settings: {
            economy_enabled: true, tech_trees_enabled: true,
            space_age_moon_hegemony_enabled: true,
            allowed_victory_conditions: ['domination'],
          } as GameState['settings'],
          lunar_hegemony: { owner_id: 'rival', turns_held: 5, started_turn: 1 },
        } as Partial<GameState>),
        draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud();
      expect(screen.queryByTestId('hud-hegemony')).toBeNull();
    });

    it('shows nothing in a game without the phase, clock or not', () => {
      useGameStore.setState({
        gameState: makeState({
          lunar_hegemony: { owner_id: 'rival', turns_held: 5, started_turn: 1 },
        } as Partial<GameState>),
        draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud();
      expect(screen.queryByTestId('hud-hegemony')).toBeNull();
    });
  });

  describe('the Moon\'s own powers', () => {
    // Phase 1 shipped Lunar Export as a socket handler with no way to reach it:
    // abilities are surfaced by walking the tech tree for `unlocks_ability`, and
    // it deliberately has none, so no button ever rendered and only bots used
    // the sink. These pin the human path.
    const moonMap = {
      map_id: 'space_age', territories: [
        { territory_id: 'moon_polar_north', region_id: 'lunar_surface', globe_id: 'moon', name: 'North Polar Basin' },
        { territory_id: 'moon_mare_imbrium', region_id: 'lunar_surface', globe_id: 'moon', name: 'Mare Imbrium' },
        { territory_id: 'na_launch_base', region_id: 'north_america_2100', globe_id: 'earth', name: 'Launch Base' },
      ],
      connections: [],
    };
    const lunarState = (ownedMoonTiles: string[]) => makeState({
      phase: 'draft',
      settings: {
        economy_enabled: true, tech_trees_enabled: true, space_age_moon_helium3_enabled: true,
      } as GameState['settings'],
      territories: Object.fromEntries(
        moonMap.territories.map((t) => [t.territory_id, {
          territory_id: t.territory_id,
          owner_id: ownedMoonTiles.includes(t.territory_id) ? 'me' : 'rival',
          unit_count: 3, unit_type: 'infantry',
        }]),
      ) as GameState['territories'],
    });

    it('offers Lunar Export to a player holding lunar ground', () => {
      useGameStore.setState({
        gameState: lunarState(['moon_polar_north']), draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud({ onUseAbility: () => {}, mapData: moonMap });
      expect(screen.getByTestId('ability-btn-lunar_export')).toBeInTheDocument();
    });

    it('withholds it from a player with no Moon territory', () => {
      useGameStore.setState({
        gameState: lunarState([]), draftUnitsRemaining: 0, lastCombatResult: null,
      } as never);
      renderHud({ onUseAbility: () => {}, mapData: moonMap });
      expect(screen.queryByTestId('ability-btn-lunar_export')).toBeNull();
    });
  });

  it('shows the roster only on the Players tab', () => {
    renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    expect(screen.getByText('Rival')).toBeInTheDocument();
    expect(screen.queryByText('Resources')).toBeNull();
  });

  it('shows a bot commander\'s style on its seat, as an icon that says what it is', () => {
    useGameStore.setState({
      gameState: makeState({
        players: [
          player('me', 0),
          player('ai_1', 1, { username: 'Khan Ulan (AI)', is_ai: true, ai_difficulty: 'hard', ai_style: 'raider' }),
        ],
      }),
    } as never);
    renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    expect(screen.getByText('Khan Ulan (AI)')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Raider: Breaks rivals/)).toBeInTheDocument();
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

describe('GameHUD — Lane Sovereignty tracker', () => {
  const galaxyMap = {
    map_kind: 'galaxy' as const,
    territories: [],
    connections: [
      { from: 'g1', to: 'g2', type: 'orbit' as const },
      { from: 'g3', to: 'g4', type: 'orbit' as const },
      { from: 'g5', to: 'g6', type: 'orbit' as const },
    ],
  };
  const galaxyState = () => makeState({
    era: 'galaxy_age',
    settings: {
      economy_enabled: true,
      tech_trees_enabled: true,
      allowed_victory_conditions: ['domination', 'threshold', 'lane_sovereignty'],
    } as GameState['settings'],
    players: [player('me', 0, { lane_sovereignty_streak: 1 }), player('rival', 1)],
    territories: {
      g1: { owner_id: 'me' }, g2: { owner_id: 'me' },
      g3: { owner_id: 'me' }, g4: { owner_id: 'rival' },
      g5: { owner_id: 'rival' }, g6: { owner_id: 'rival' },
    } as unknown as GameState['territories'],
  });

  it('shows corridors held and the round streak when the condition is in play', () => {
    useGameStore.setState({ gameState: galaxyState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ mapData: galaxyMap, resolvedViewerPlayerId: 'me' });
    const panel = screen.getByTestId('lane-sovereignty-progress');
    expect(panel.textContent).toContain('corridors 1 of 3');
    // A two-player duel runs the streak for five rounds, not three: one rival
    // has fewer turns in which to break it (LANE_SOVEREIGNTY_ROUNDS_BY_SEATS).
    expect(panel.textContent).toContain('held 1 of 5 rounds');
    expect(panel.textContent).toContain('at the start of 5 turns running');
  });

  it('counts three rounds with three or four seats', () => {
    const state = galaxyState();
    state.players = [...state.players, player('third', 2), player('fourth', 3)];
    useGameStore.setState({ gameState: state, draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ mapData: galaxyMap, resolvedViewerPlayerId: 'me' });
    expect(screen.getByTestId('lane-sovereignty-progress').textContent).toContain('held 1 of 3 rounds');
  });

  it('stays hidden when the game is not playing for it', () => {
    const state = galaxyState();
    state.settings.allowed_victory_conditions = ['domination', 'threshold'];
    useGameStore.setState({ gameState: state, draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ mapData: galaxyMap, resolvedViewerPlayerId: 'me' });
    expect(screen.queryByTestId('lane-sovereignty-progress')).toBeNull();
  });
});

describe('GameHUD — map control tracker', () => {
  // Quick Match's default ending: hold 65% of the 35 territories WW2 deals.
  const thresholdState = (overrides: Partial<GameState['settings']> = {}) => {
    const territories: Record<string, { owner_id: string | null }> = {};
    for (let i = 0; i < 35; i++) territories[`t${i}`] = { owner_id: i < 9 ? 'me' : 'rival' };
    return makeState({
      settings: {
        allowed_victory_conditions: ['domination', 'threshold'],
        victory_threshold: 65,
        ...overrides,
      } as GameState['settings'],
      players: [player('me', 0, { territory_count: 9 }), player('rival', 1, { territory_count: 26 })],
      territories: territories as unknown as GameState['territories'],
    });
  };

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
  });

  it('shows the share of the map held against the share that wins', () => {
    useGameStore.setState({ gameState: thresholdState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ resolvedViewerPlayerId: 'me' });
    const panel = screen.getByTestId('map-control-progress');
    expect(panel.textContent).toContain('25% of 65%');
    expect(panel.textContent).toContain('9 of 23 territories');
    expect(panel.textContent).toContain('14 more to go');
    expect(screen.getByRole('meter', { name: 'Map control' })).toHaveAttribute('aria-valuenow', '25');
    // It is an objective: the empty-state line must not claim there are none.
    expect(screen.queryByText(/No objectives/)).toBeNull();
  });

  it('stays hidden when the game is not won by holding a share of the map', () => {
    useGameStore.setState({
      gameState: thresholdState({ allowed_victory_conditions: ['domination'] }),
      draftUnitsRemaining: 0,
      lastCombatResult: null,
    } as never);
    renderHud({ resolvedViewerPlayerId: 'me' });
    expect(screen.queryByTestId('map-control-progress')).toBeNull();
  });
});

describe('GameHUD — a team game', () => {
  const TEAMS = [
    { team_id: 'team_1', name: 'Stellar Mandate & Forge Syndicate', player_ids: ['me', 'pal'] },
    { team_id: 'team_2', name: 'Helion Navigators & Void Custodians', player_ids: ['rival', 'other'] },
  ];
  const galaxyMap = {
    map_kind: 'galaxy' as const,
    territories: [],
    connections: [{ from: 'g1', to: 'g2', type: 'orbit' as const }],
  };
  const teamState = (teams: typeof TEAMS | null = TEAMS) => makeState({
    era: 'galaxy_age',
    teams: teams ?? undefined,
    settings: {
      allowed_victory_conditions: ['threshold', 'lane_sovereignty'],
      victory_threshold: 75,
    } as GameState['settings'],
    players: [
      player('me', 0, { territory_count: 5 }),
      player('rival', 1, { username: 'Rival', territory_count: 2 }),
      player('pal', 2, { username: 'Pal', territory_count: 1 }),
      player('other', 3, { username: 'Other', territory_count: 2 }),
    ],
    territories: Object.fromEntries(
      ['me', 'me', 'me', 'me', 'me', 'rival', 'rival', 'pal', 'other', 'other'].map((owner, i) => [
        i === 0 ? 'g1' : i === 7 ? 'g2' : `t${i}`,
        { owner_id: owner },
      ]),
    ) as unknown as GameState['territories'],
  } as Partial<GameState>);

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
  });

  it('lists each side under its name, members in seat order', () => {
    useGameStore.setState({ gameState: teamState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ mapData: galaxyMap, resolvedViewerPlayerId: 'me' });
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    const headings = screen.getAllByTestId('hud-team-heading');
    expect(headings.map((h) => h.textContent)).toEqual([
      'Stellar Mandate & Forge Syndicate · your side',
      'Helion Navigators & Void Custodians',
    ]);
    // Each heading is followed by its side's players, in seat order.
    const order = [...document.querySelectorAll('[data-testid="hud-team-heading"], .truncate')].map((n) => n.textContent);
    expect(order).toEqual([
      'Stellar Mandate & Forge Syndicate · your side', 'me', 'Pal',
      'Helion Navigators & Void Custodians', 'Rival', 'Other',
    ]);
  });

  it("counts the side's share of the map, and the side's corridors", () => {
    useGameStore.setState({ gameState: teamState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ mapData: galaxyMap, resolvedViewerPlayerId: 'me' });
    const control = screen.getByTestId('map-control-progress');
    expect(control.textContent).toContain('Map control (your side): 60% of 75%');
    expect(control.textContent).toContain('6 of 8 territories');
    expect(control.textContent).toContain('Hold 75% of the map as a side');
    const sovereignty = screen.getByTestId('lane-sovereignty-progress');
    // g1 is mine and g2 my ally's: one corridor, held by the side.
    expect(sovereignty.textContent).toContain('corridors 1 of 1');
    expect(sovereignty.textContent).toContain("you or an ally, to make it your side's corridor");
    // Two sides: the streak runs five rounds, as a duel's does.
    expect(sovereignty.textContent).toContain('held 0 of 5 rounds');
  });

  it('is one list, counted player by player, without teams', () => {
    useGameStore.setState({ gameState: teamState(null), draftUnitsRemaining: 0, lastCombatResult: null } as never);
    renderHud({ mapData: galaxyMap, resolvedViewerPlayerId: 'me' });
    expect(screen.getByTestId('map-control-progress').textContent).toContain('Map control: 50% of 75%');
    expect(screen.getByTestId('lane-sovereignty-progress').textContent).toContain('corridors 0 of 1');
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    expect(screen.queryByTestId('hud-team-heading')).toBeNull();
  });
});

describe('GameHUD — fleet battle dice', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
  });

  it('shows a fleet battle’s dice in the Log tab, above the landing’s', () => {
    useGameStore.setState({
      gameState: makeState(),
      draftUnitsRemaining: 0,
      lastCombatResult: {
        attacker_rolls: [5], defender_rolls: [2], attacker_losses: 0, defender_losses: 1,
        territory_captured: true, fromId: 'a', toId: 'b',
      },
      lastNavalCombat: {
        fromId: 'a', toId: 'b', attacker_rolls: [6, 1], defender_rolls: [4],
        attacker_losses: 1, defender_losses: 1, attacker_won: true,
      },
    } as never);
    renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Log/ }));
    const naval = screen.getByTestId('naval-dice-result');
    expect(naval).toHaveTextContent('Fleet battle');
    expect(naval).toHaveTextContent('Lost 1 fleet');
    // Fleet battle first, then the land battle's "Territory Captured!".
    const captured = screen.getByText('Territory Captured!');
    expect(naval.compareDocumentPosition(captured) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('GameHUD — nothing to fight', () => {
  // A cleared daily board: the player's ground borders only an empty
  // neutral, and the enemy sits beyond it where no attack can reach.
  const CONNS = [
    { from: 'home', to: 'coast', type: 'land' as const },
    { from: 'coast', to: 'far', type: 'land' as const },
  ];
  const mapData = { map_id: 'm1', territories: [], connections: CONNS };
  const board = (enemyAtCoast: boolean) => ({
    home: { territory_id: 'home', owner_id: 'me', unit_count: 5 },
    coast: enemyAtCoast
      ? { territory_id: 'coast', owner_id: 'rival', unit_count: 4 }
      : { territory_id: 'coast', owner_id: null, unit_count: 0 },
    far: { territory_id: 'far', owner_id: 'rival', unit_count: 7 },
  });

  beforeEach(() => {
    useAuthStore.setState({ user: { user_id: 'me', username: 'me' } as never, isAuthenticated: true });
  });

  it('says so in the attack phase when no enemy borders any of my ground', () => {
    useGameStore.setState({ gameState: makeState({ territories: board(false) as never }) } as never);
    renderHud({ mapData, resolvedViewerPlayerId: 'me' });
    expect(screen.getByTestId('nothing-to-fight')).toHaveTextContent(
      'Nothing to fight: no enemy borders any of your territories, and empty land cannot be taken. Carry on to Fortify.',
    );
  });

  it('stays quiet when an enemy borders me', () => {
    useGameStore.setState({ gameState: makeState({ territories: board(true) as never }) } as never);
    renderHud({ mapData, resolvedViewerPlayerId: 'me' });
    expect(screen.queryByTestId('nothing-to-fight')).toBeNull();
  });

  it('stays quiet outside the attack phase', () => {
    useGameStore.setState({ gameState: makeState({ phase: 'draft', territories: board(false) as never }) } as never);
    renderHud({ mapData, resolvedViewerPlayerId: 'me' });
    expect(screen.queryByTestId('nothing-to-fight')).toBeNull();
  });
});
