import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameStartModal, { turnOrderFrom, describeViewerPosition, describeWinConditions, isOpeningState } from './GameStartModal';
import type { GameState, PlayerState } from '../../store/gameStore';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: {
        factions: [
          { faction_id: 'rome', name: 'Rome', ability_description: 'Testudo: negate attacker losses once per game.' },
        ],
      },
    }),
  },
}));

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    player_id: 'p',
    player_index: 0,
    username: 'p',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 0,
    cards: [],
    mmr: 1000,
    ...overrides,
  } as PlayerState;
}

const players = [
  player({ player_id: 'me', player_index: 0, username: 'Jeff', special_resource: 3, tech_points: 2 }),
  player({ player_id: 'a1', player_index: 1, username: 'AI Bot 1', is_ai: true, ai_difficulty: 'medium' }),
  player({ player_id: 'a2', player_index: 2, username: 'AI Bot 2', is_ai: true, ai_difficulty: 'hard' }),
];

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'draft',
    current_player_index: 1,
    starting_player_index: 1,
    turn_number: 1,
    players,
    territories: {},
    card_set_redemption_count: 0,
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 60,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
    },
    ...overrides,
  } as GameState;
}

describe('turnOrderFrom', () => {
  it('rotates the seat list to start at the starting player', () => {
    expect(turnOrderFrom(players, 1).map((p) => p.player_id)).toEqual(['a1', 'a2', 'me']);
  });

  it('is the identity when the first seat starts', () => {
    expect(turnOrderFrom(players, 0).map((p) => p.player_id)).toEqual(['me', 'a1', 'a2']);
  });

  it('tolerates an out-of-range starting index', () => {
    expect(turnOrderFrom(players, 3).map((p) => p.player_id)).toEqual(['me', 'a1', 'a2']);
  });

  it('handles an empty seat list', () => {
    expect(turnOrderFrom([], 0)).toEqual([]);
  });
});

describe('describeViewerPosition', () => {
  it('announces going first', () => {
    expect(describeViewerPosition(turnOrderFrom(players, 0), 'me')).toBe('You go first');
  });

  it('announces a later position with the table size', () => {
    expect(describeViewerPosition(turnOrderFrom(players, 1), 'me')).toBe('You go 3rd of 3');
  });

  it('returns null for non-participants', () => {
    expect(describeViewerPosition(turnOrderFrom(players, 0), 'ghost')).toBeNull();
    expect(describeViewerPosition(turnOrderFrom(players, 0), null)).toBeNull();
  });
});

describe('describeWinConditions', () => {
  it('defaults to domination when nothing is configured', () => {
    expect(describeWinConditions(makeState().settings)).toEqual({
      conditions: ['Control every territory'],
      turnCap: null,
    });
  });

  it('describes a threshold win with its percentage', () => {
    const settings = { ...makeState().settings, allowed_victory_conditions: ['threshold'], victory_threshold: 70 };
    expect(describeWinConditions(settings).conditions).toEqual(['Control 70% of the map']);
  });

  it('falls back to a generic phrase when the threshold percent is missing', () => {
    const settings = { ...makeState().settings, allowed_victory_conditions: ['threshold'] };
    expect(describeWinConditions(settings).conditions).toEqual(['Control most of the map']);
  });

  it('lists every allowed condition and the turn cap', () => {
    const settings = {
      ...makeState().settings,
      allowed_victory_conditions: ['domination', 'capital', 'secret_mission'],
      max_turns: 150,
    };
    const out = describeWinConditions(settings);
    expect(out.conditions).toEqual([
      'Control every territory',
      'Hold your capital and capture every enemy capital',
      'Complete your secret mission',
    ]);
    expect(out.turnCap).toBe('Most territory when turn 150 ends also wins');
  });

  it('uses the single victory_type when no allowed list exists', () => {
    const settings = { ...makeState().settings, victory_type: 'capital' };
    expect(describeWinConditions(settings).conditions).toEqual([
      'Hold your capital and capture every enemy capital',
    ]);
  });

  it('phrases the Lunar Hegemony instead of leaking its enum name', () => {
    // Before this it fell through to `return kind`, so a Moon Race game opened
    // by telling players they could win by 'lunar_hegemony'.
    const settings = { ...makeState().settings, allowed_victory_conditions: ['lunar_hegemony'] };
    expect(describeWinConditions(settings).conditions).toEqual([
      'Hold every lunar territory for 7 turns of your own in a row',
    ]);
  });

  it('counts from the clock length THIS game runs on', () => {
    const settings = {
      ...makeState().settings,
      allowed_victory_conditions: ['lunar_hegemony'],
      space_age_hegemony_turns: 5,
    };
    expect(describeWinConditions(settings).conditions).toEqual([
      'Hold every lunar territory for 5 turns of your own in a row',
    ]);
  });
});

describe('what a Moon Race game tells players before their first turn', () => {
  const spaceAge = (settings: Record<string, unknown>) => makeState({
    era: 'space_age',
    settings: { ...makeState().settings, ...settings },
  } as Partial<GameState>);

  it('gives the era a section of its own, from this game\'s phases', () => {
    render(
      <GameStartModal
        open
        onClose={() => {}}
        gameState={spaceAge({ space_age_moon_helium3_enabled: true })}
        viewerPlayerId="me"
        moonTiles={9}
      />,
    );
    const section = screen.getByTestId('start-era-section');
    expect(section).toHaveTextContent('In this era');
    expect(section).toHaveTextContent(/9 more territories/);
    expect(section).toHaveTextContent(/mine Helium-3 every turn/);
    // The blockade is not running in this game, so it is not named.
    expect(section).not.toHaveTextContent(/blockade/);
  });

  it('still explains the orbit gate with every phase dark', () => {
    // The operator's kill switch: the Moon Race off, the Moon itself unchanged.
    render(
      <GameStartModal open onClose={() => {}} gameState={spaceAge({})} viewerPlayerId="me" moonTiles={9} />,
    );
    const section = screen.getByTestId('start-era-section');
    expect(section).toHaveTextContent(/Spaceport Infrastructure, a Launch Pad/);
    expect(section).not.toHaveTextContent(/Helium-3/);
  });

  it('stays quiet on a board with no Moon', () => {
    render(
      <GameStartModal open onClose={() => {}} gameState={spaceAge({})} viewerPlayerId="me" moonTiles={0} />,
    );
    expect(screen.queryByTestId('start-era-section')).not.toBeInTheDocument();
  });
});

describe('How the Space Age works, inside the briefing', () => {
  const spaceAge = makeState({ era: 'space_age' });

  it('leads a first-timer into the guide instead of straight to battle', () => {
    // The guide opens by itself once — as the briefing's second page, never as
    // a second modal stacked on it (the mobile overlay budget).
    const onClose = vi.fn();
    const onGuideShown = vi.fn();
    render(
      <GameStartModal
        open
        onClose={onClose}
        gameState={spaceAge}
        viewerPlayerId="me"
        moonTiles={9}
        guideFirst
        onGuideShown={onGuideShown}
      />,
    );
    expect(screen.queryByRole('button', { name: /to battle/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next: how the Space Age works/ }));
    expect(onGuideShown).toHaveBeenCalledWith('next');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('How the Space Age works')).toBeInTheDocument();
    expect(screen.getByTestId('space-age-guide-program')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /to battle/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the guide behind a link once it has been seen', () => {
    const onClose = vi.fn();
    const onGuideShown = vi.fn();
    render(
      <GameStartModal
        open
        onClose={onClose}
        gameState={spaceAge}
        viewerPlayerId="me"
        moonTiles={9}
        onGuideShown={onGuideShown}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^How the Space Age works$/ }));
    expect(onGuideShown).toHaveBeenCalledWith('link');
    expect(screen.getByTestId('space-age-guide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to the briefing/ }));
    expect(screen.getByText('Turn order')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /to battle/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never leads into a guide that has nothing to say', () => {
    const onClose = vi.fn();
    render(
      <GameStartModal open onClose={onClose} gameState={makeState()} viewerPlayerId="me" moonTiles={0} guideFirst />,
    );
    fireEvent.click(screen.getByRole('button', { name: /to battle/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('GameStartModal', () => {
  it('shows turn order with the viewer marked and starting resources', () => {
    render(
      <GameStartModal open onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />,
    );
    expect(screen.getByText('You go 3rd of 3.')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText('Medium AI')).toBeInTheDocument();
    expect(screen.getByText('3 PP')).toBeInTheDocument();
    expect(screen.getByText('2 TP')).toBeInTheDocument();
  });

  it('hides resources when economy and tech are disabled', () => {
    const state = makeState({
      settings: { ...makeState().settings, economy_enabled: false, tech_trees_enabled: false },
    });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" />);
    expect(screen.queryByText(/starting resources/i)).toBeNull();
  });

  it('dismisses via the To battle button', () => {
    const onClose = vi.fn();
    render(<GameStartModal open onClose={onClose} gameState={makeState()} viewerPlayerId="me" />);
    fireEvent.click(screen.getByRole('button', { name: /to battle/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <GameStartModal open={false} onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the win conditions section', () => {
    render(<GameStartModal open onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />);
    expect(screen.getByText('How to win')).toBeInTheDocument();
    expect(screen.getByText('Control every territory')).toBeInTheDocument();
  });

  it('shows the turn cap when configured', () => {
    const state = makeState({ settings: { ...makeState().settings, max_turns: 150 } });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" />);
    expect(screen.getByText('Most territory when turn 150 ends also wins.')).toBeInTheDocument();
  });

  it("shows the viewer's secret mission when assigned", () => {
    const withMission = players.map((p) =>
      p.player_id === 'me'
        ? { ...p, secret_mission: { kind: 'eliminate_player', target_player_id: 'a2' } }
        : p,
    ) as PlayerState[];
    render(
      <GameStartModal
        open
        onClose={() => {}}
        gameState={makeState({ players: withMission })}
        viewerPlayerId="me"
      />,
    );
    expect(screen.getByText('Your secret mission')).toBeInTheDocument();
    expect(screen.getByText('Eliminate AI Bot 2')).toBeInTheDocument();
  });

  it('says when a Territory Draft deals the secret mission', () => {
    // The server deals missions once the map is claimed, so the draft opens
    // with none.
    const state = makeState({
      phase: 'territory_select',
      settings: { ...makeState().settings, allowed_victory_conditions: ['secret_mission'] },
    });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" />);
    expect(screen.getByText('Your secret mission')).toBeInTheDocument();
    expect(screen.getByText('Dealt when the draft ends.')).toBeInTheDocument();
  });

  it('says nothing about a mission when the game has none', () => {
    render(<GameStartModal open onClose={() => {}} gameState={makeState({ phase: 'territory_select' })} viewerPlayerId="me" />);
    expect(screen.queryByText('Your secret mission')).toBeNull();
  });

  it('tells a Space Age player the Moon counts and how to reach it', () => {
    // "How to win" listed domination and threshold without ever mentioning that
    // 9 of the board's territories sit behind an orbit gate, so a stalled
    // domination bar read as a bug rather than as the era's mechanic.
    const state = makeState({ era: 'space_age' });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" moonTiles={9} />);
    expect(screen.getByText(/count toward every way to win/)).toBeInTheDocument();
    expect(screen.getByText(/Spaceport Infrastructure, a Launch Pad/)).toBeInTheDocument();
  });

  it('gives Lunar Pioneers the short version', () => {
    const withFaction = players.map((p) =>
      p.player_id === 'me' ? { ...p, faction_id: 'lunar_pioneers' } : p,
    ) as PlayerState[];
    const state = makeState({ era: 'space_age', players: withFaction });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" moonTiles={9} />);
    expect(screen.getByText(/can land from turn one/)).toBeInTheDocument();
  });

  it('says nothing about the Moon outside the Space Age', () => {
    render(<GameStartModal open onClose={() => {}} gameState={makeState()} viewerPlayerId="me" moonTiles={9} />);
    expect(screen.queryByTestId('start-era-section')).not.toBeInTheDocument();
  });

  it("fetches and shows the viewer's faction ability when factions are enabled", async () => {
    const withFaction = players.map((p) =>
      p.player_id === 'me' ? { ...p, faction_id: 'rome' } : p,
    ) as PlayerState[];
    const state = makeState({
      players: withFaction,
      settings: { ...makeState().settings, factions_enabled: true },
    });
    render(<GameStartModal open onClose={() => {}} gameState={state} viewerPlayerId="me" />);
    expect(await screen.findByText('Rome')).toBeInTheDocument();
    expect(screen.getByText(/Testudo/)).toBeInTheDocument();
  });

  it('treats only the first seat\'s first turn as the opening', () => {
    // The daily puzzle that exposed this starts in the attack phase, so the
    // first draft-phase state of turn 1 is the opponent's: the briefing used
    // to open there and tell a player who had just moved that they go first.
    const opening = makeState({ phase: 'attack', current_player_index: 1, starting_player_index: 1 });
    expect(isOpeningState(opening)).toBe(true);
    const opponentsTurn = makeState({ phase: 'draft', current_player_index: 0, starting_player_index: 1 });
    expect(isOpeningState(opponentsTurn)).toBe(false);
    const laterTurn = makeState({ phase: 'draft', current_player_index: 1, starting_player_index: 1, turn_number: 2 });
    expect(isOpeningState(laterTurn)).toBe(false);
    // Missing indices (older states) fall back to seat 0 on both sides.
    expect(isOpeningState({ turn_number: 1 } as GameState)).toBe(true);
  });
});

describe('what a Galactic Age Colonies game tells players before their first turn', () => {
  const galaxy = (overrides: Partial<GameState> = {}) => makeState({
    era: 'galaxy_age',
    settings: { ...makeState().settings, allowed_victory_conditions: ['lane_sovereignty'] },
    ...overrides,
  } as Partial<GameState>);

  it('counts Lane Sovereignty rounds for this game\'s seats', () => {
    const settings = galaxy().settings;
    expect(describeWinConditions(settings, 2).conditions).toEqual(['Hold both gateways of 5 hyperspace lanes for 5 turns running']);
    expect(describeWinConditions(settings, 3).conditions).toEqual(['Hold both gateways of 5 hyperspace lanes for 3 turns running']);
    expect(describeWinConditions(settings, 4).conditions).toEqual(['Hold both gateways of 5 hyperspace lanes for 3 turns running']);
  });

  it('names the colonies when the board has them, and says nothing otherwise', () => {
    const { unmount } = render(
      <GameStartModal
        open
        onClose={() => {}}
        gameState={galaxy({ galaxy_mode: { id: 'colonies', neutral_worlds: ['nexus_station'], lanes: [{ from: 'a', to: 'b' }] } })}
        viewerPlayerId="me"
      />,
    );
    const section = screen.getByTestId('start-colonies-section');
    expect(section).toHaveTextContent(/Nexus Station starts neutral and garrisoned/);
    expect(section).toHaveTextContent(/Two extra lanes link every world/);
    // Three seats in the fixture: the briefing reads three rounds.
    expect(screen.getByText('Hold both gateways of 5 hyperspace lanes for 3 turns running')).toBeInTheDocument();
    unmount();

    render(<GameStartModal open onClose={() => {}} gameState={galaxy()} viewerPlayerId="me" />);
    expect(screen.queryByTestId('start-colonies-section')).not.toBeInTheDocument();
  });
});

describe('what a Schism briefing tells each house', () => {
  const schismState = (relations: 'concord' | 'civil_war') => makeState({
    era: 'galaxy_age',
    players: [
      player({ player_id: 'me', player_index: 0, username: 'Jeff', faction_id: 'stellar_mandate' }),
      player({ player_id: 'a1', player_index: 1, username: 'AI Bot 1', is_ai: true, faction_id: 'stellar_mandate' }),
    ],
    settings: { ...makeState().settings, factions_enabled: true },
    galaxy_mode: {
      id: 'schism',
      relations,
      concord_rounds: relations === 'concord' ? 3 : 0,
      lane_crown_bonus: 2,
      houses: [
        { player_id: 'me', world_id: 'sol', half: 0, name: 'Western Mandate' },
        { player_id: 'a1', world_id: 'sol', half: 1, name: 'Eastern Mandate' },
      ],
      crown_gateways: { sol: ['sol_amazonia', 'sol_cathay', 'sol_guinea', 'sol_pacific_rim'] },
    },
  } as Partial<GameState>);

  it('names the house, the rival at home, the Concord and the Crown', () => {
    render(<GameStartModal open onClose={() => {}} gameState={schismState('concord')} viewerPlayerId="me" />);
    const section = screen.getByTestId('start-schism-section');
    expect(section).toHaveTextContent('You are the Western Mandate. The Eastern Mandate (AI Bot 1) holds the rest of Sol III');
    expect(section).toHaveTextContent(/The Concord: you and the Eastern Mandate are under a truce for the first 3 rounds/);
    expect(section).toHaveTextContent(/The Lane Crown: hold all four of Sol III's gateways/);
    expect(screen.queryByTestId('start-colonies-section')).not.toBeInTheDocument();
  });

  it('says Civil War when there is no Concord', () => {
    render(<GameStartModal open onClose={() => {}} gameState={schismState('civil_war')} viewerPlayerId="me" />);
    expect(screen.getByTestId('start-schism-section')).toHaveTextContent('Civil War: the Eastern Mandate is your enemy from the first turn.');
  });

  it('is absent from any other board', () => {
    render(<GameStartModal open onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />);
    expect(screen.queryByTestId('start-schism-section')).not.toBeInTheDocument();
  });
});

describe('what a team game tells players before their first turn', () => {
  const TEAMS = [
    { team_id: 'team_1', name: 'Stellar Mandate & Forge Syndicate', player_ids: ['me', 'a2'] },
    { team_id: 'team_2', name: 'Helion Navigators & Void Custodians', player_ids: ['a1', 'a3'] },
  ];
  const teamState = (overrides: Partial<GameState> = {}) => makeState({
    era: 'galaxy_age',
    players: [
      ...players,
      player({ player_id: 'a3', player_index: 3, username: 'AI Bot 3', is_ai: true }),
    ],
    teams: TEAMS,
    settings: {
      ...makeState().settings,
      allowed_victory_conditions: ['domination', 'threshold', 'capital', 'lane_sovereignty'],
      victory_threshold: 75,
    },
    ...overrides,
  } as Partial<GameState>);

  it('phrases every condition for the side, and counts Sovereignty by sides', () => {
    expect(describeWinConditions(teamState().settings, 4, 2).conditions).toEqual([
      'Your side controls every territory',
      'Your side controls 75% of the map between you',
      'Your side holds every capital',
      'Your side holds both gateways of 5 hyperspace lanes for 5 turns running',
    ]);
    // Eight seats in four sides: three rounds, as a four-player game.
    expect(describeWinConditions(teamState().settings, 8, 4).conditions[3]).toBe(
      'Your side holds both gateways of 5 hyperspace lanes for 3 turns running',
    );
    // No sides: the free-for-all phrasing, rounds by seats.
    expect(describeWinConditions(teamState().settings, 4).conditions[0]).toBe('Control every territory');
  });

  it("names the viewer's side and the one it faces", () => {
    render(<GameStartModal open onClose={() => {}} gameState={teamState()} viewerPlayerId="me" />);
    const section = screen.getByTestId('start-teams-section');
    expect(section).toHaveTextContent('Your side, the Stellar Mandate & Forge Syndicate: you and AI Bot 2.');
    expect(section).toHaveTextContent('Against the Helion Navigators & Void Custodians: AI Bot 1 and AI Bot 3.');
    expect(screen.getByText('Your side holds both gateways of 5 hyperspace lanes for 5 turns running')).toBeInTheDocument();
  });

  it('is absent from a free-for-all game', () => {
    render(<GameStartModal open onClose={() => {}} gameState={makeState()} viewerPlayerId="me" />);
    expect(screen.queryByTestId('start-teams-section')).not.toBeInTheDocument();
  });
});

describe("what a Colonies duel tells players about a kit it changes", () => {
  it('names the Navigators drafting +1 in a duel, from the whole roster', async () => {
    const { api } = await import('../../services/api');
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        factions: [
          { faction_id: 'helion_navigators', name: 'Helion Navigators', reinforce_bonus: 2, colony_reinforce_bonus: { '2': 1 } },
          { faction_id: 'forge_syndicate', name: 'Forge Syndicate', reinforce_bonus: 2 },
        ],
      },
    });
    const duel = makeState({
      era: 'galaxy_age',
      players: [
        player({ player_id: 'me', player_index: 0, username: 'Jeff', faction_id: 'forge_syndicate' }),
        player({ player_id: 'a1', player_index: 1, username: 'AI Bot 1', is_ai: true, faction_id: 'helion_navigators' }),
      ],
      settings: { ...makeState().settings, factions_enabled: true },
      galaxy_mode: { id: 'colonies', neutral_worlds: ['nexus_station', 'rust'] },
    } as Partial<GameState>);
    render(<GameStartModal open onClose={() => {}} gameState={duel} viewerPlayerId="me" />);
    // A rival's kit, not the viewer's: the briefing reads the whole roster.
    expect(await screen.findByText('The Helion Navigators draft +1 a turn in this game, not +2.')).toBeInTheDocument();
  });
});

