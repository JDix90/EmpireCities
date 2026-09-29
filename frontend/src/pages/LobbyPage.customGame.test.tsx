import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LobbyPage from './LobbyPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../services/mapService', () => ({
  fetchMapById: vi.fn(() => Promise.reject(new Error('offline'))),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

/** Every opt-in rule in the Custom Game form, by checkbox id. */
const ADVANCED_FEATURE_IDS = [
  'territory-draft-top',
  'asymmetric-factions-top',
  'create-game-economy',
  'create-game-tech-trees',
  'create-game-events',
  'create-game-naval',
  'create-game-stability',
  'create-game-fog',
  'create-game-diplomacy',
  'create-game-coaching',
  'create-game-uncapped-card-sets',
] as const;

function renderCustomGame(era = 'ww2') {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, xp: 50 } as never,
    isAuthenticated: true,
  });
  // `?era=` opens the Custom Game form on mount, as the era gallery's deep links do.
  return render(
    <MemoryRouter initialEntries={[`/lobby?era=${era}`]}>
      <LobbyPage />
    </MemoryRouter>,
  );
}

function checkbox(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox #${id}`);
  return el;
}

/** Opens the (i) beside a checkbox and returns what it says. */
function tooltipFor(id: string): string {
  const row = checkbox(id).closest('div')!;
  const info = within(row).getByRole('button', { name: 'More info' });
  fireEvent.click(info);
  const text = screen.getByRole('tooltip').textContent ?? '';
  fireEvent.click(info);
  return text;
}

function stubMatchMedia() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe('LobbyPage Custom Game defaults', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    navigateMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    stubMatchMedia();
  });

  it('starts every advanced feature unchecked, Diplomacy included', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    for (const id of ADVANCED_FEATURE_IDS) {
      expect({ id, checked: checkbox(id).checked }).toEqual({ id, checked: false });
    }
  });

  it('creates a game with diplomacy off unless the player ticks it', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    // Sent explicitly: the create route defaults an omitted flag to ON.
    expect(body.settings.diplomacy_enabled).toBe(false);
  });

  it('still lets the player turn Diplomacy on', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    fireEvent.click(checkbox('create-game-diplomacy'));
    expect(checkbox('create-game-diplomacy').checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    expect(body.settings.diplomacy_enabled).toBe(true);
  });
});

/**
 * What each tooltip must say, checked against the engine, and the claims the
 * old copy made that the game does not do. Evidence for each is in the commit
 * that rewrote them; the short version is beside each row.
 */
const TOOLTIP_FACTS: Array<{ id: string; says: RegExp[]; neverSays: RegExp[] }> = [
  // Territories are dealt round-robin, one claim at a time, 3 units each.
  { id: 'territory-draft-top', says: [/one territory at a time/, /3 units/], neverSays: [/start neutral/i] },
  // Kits come from the era's roster; seats past it get none (the Civil War has 2).
  // 18 of the 52 powers have no reinforcement or dice bonus, and a homeland
  // missing from the map seeds the best-connected free territory instead.
  { id: 'asymmetric-factions-top', says: [/homeland/, /extra seats without one/, /for most powers extra reinforcements or dice/, /best-connected free territory/], neverSays: [/defensive perks/i, /kit: extra reinforcements or dice/] },
  // The building chain is Workshop/Palisade/Laboratory/Port; no farms exist.
  // Only a capture in battle razes (onTerritoryCapture); Influence keeps them.
  { id: 'create-game-economy', says: [/Production Points \(PP\)/, /Workshops/, /Ports need Naval Warfare/, /taken by Influence keeps them/], neverSays: [/farms/i, /Capturing a territory razes/] },
  // TP is paid inside collectProduction, which returns early with economy off.
  { id: 'create-game-tech-trees', says: [/Tech Points \(TP\)/, /Economy & Buildings/], neverSays: [/faster production/i, /naval range/i] },
  // One card when the round wraps, not one per player turn.
  { id: 'create-game-events', says: [/Every round after the first/, /choice of two/], neverSays: [/drawn each turn/i] },
  // Fleets only come from Ports and Naval Bases; nothing blockades.
  { id: 'create-game-naval', says: [/Economy & Buildings on too/, /Ports/], neverSays: [/blockade/i, /distant shores/i] },
  // Rebellion is a <=10% rule; income scaling needs the economy.
  // Fleet income (collectFleetIncome) is flat; PP and TP are scaled.
  { id: 'create-game-stability', says: [/10% or less/, /Economy & Buildings/, /not the fleets/], neverSays: [/Low stability reduces income/i, /both scale what your buildings produce/] },
  // Ownership stays visible to everyone under fog.
  // The one faction that sees further is the Galactic Age's Helion Navigators.
  { id: 'create-game-fog', says: [/who owns every territory/, /AI plays under the same fog/, /one Galactic Age faction/], neverSays: [/only see territories they own/i, /techs and factions reveal/] },
  // Truces are human-to-human; AI always declines. There is no alliance mechanic.
  { id: 'create-game-diplomacy', says: [/AI players always decline/, /3 rounds/], neverSays: [/alliances/i, /Disable for/i] },
  // "Draft" is the reinforcement phase, not Territory Draft.
  // No tip on the game's opening turn; one resign suggestion a game.
  { id: 'create-game-coaching', says: [/reinforcement phases/, /after the game’s opening turn/, /suggests resigning/], neverSays: [/draft phases/i] },
];

describe('LobbyPage Custom Game tooltips', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    stubMatchMedia();
  });

  it.each(TOOLTIP_FACTS)('$id says what the setting does', async ({ id, says, neverSays }) => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    const text = tooltipFor(id);
    for (const phrase of says) expect(text).toMatch(phrase);
    for (const phrase of neverSays) expect(text).not.toMatch(phrase);
  });

  it('says turning the dice cap off lets bonuses stack, not that it restores classic dice', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    // The cap only shows once something can grant dice.
    fireEvent.click(checkbox('create-game-economy'));
    const text = tooltipFor('create-game-combat-dice-cap');
    expect(text).toMatch(/stack without limit/);
    expect(text).not.toMatch(/for classic rules/i);
  });

  it('describes what Era Advancement costs and switches on', async () => {
    renderCustomGame('ancient');
    await screen.findByText('Advanced Features');
    const text = tooltipFor('create-game-era-advancement');
    expect(text).toMatch(/army shrinks by about 30%/);
    expect(text).toMatch(/every territory keeps at least 1 unit/);
    expect(text).toMatch(/Turns on Economy & Buildings/);
    expect(text).not.toMatch(/Stronger units/i);
  });
});

describe('LobbyPage Custom Game rules the copy depends on', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    stubMatchMedia();
  });

  it('offers Uncapped card sets in a plain game, where card sets still pay out', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    // No dice-granting system is on, so Conditional Settings is hidden.
    expect(screen.queryByText('Conditional Settings')).toBeNull();
    fireEvent.click(checkbox('create-game-uncapped-card-sets'));
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    expect(body.settings.card_set_bonus_cap).toBe(0);
  });

  it('Era Advancement locks Economy on and leaves research and stability optional', async () => {
    renderCustomGame('ancient');
    await screen.findByText('Advanced Features');
    fireEvent.click(checkbox('create-game-era-advancement'));
    expect(checkbox('create-game-economy')).toMatchObject({ checked: true, disabled: true });
    fireEvent.click(checkbox('create-game-tech-trees'));
    fireEvent.click(checkbox('create-game-stability'));
    fireEvent.click(checkbox('create-game-naval'));
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    expect(body.settings).toMatchObject({ era_advancement_enabled: true, economy_enabled: true });
    expect(body.settings.tech_trees_enabled).toBeUndefined();
    expect(body.settings.stability_enabled).toBeUndefined();
  });

  it.each(['create-game-tech-trees', 'create-game-naval'])('ticking %s turns Economy on and locks it', async (id) => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    fireEvent.click(checkbox(id));
    expect(checkbox('create-game-economy')).toMatchObject({ checked: true, disabled: true });
    fireEvent.click(checkbox(id));
    expect(checkbox('create-game-economy')).toMatchObject({ checked: false, disabled: false });
    fireEvent.click(checkbox(id));
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    expect(body.settings.economy_enabled).toBe(true);
  });

  it('shows the curated map lore and rules, without the flavour line', async () => {
    useAuthStore.setState({ user: { user_id: 'u1', username: 'c', is_guest: false, xp: 50 } as never, isAuthenticated: true });
    render(
      <MemoryRouter initialEntries={['/lobby?map=community_divided_japan']}>
        <LobbyPage />
      </MemoryRouter>,
    );
    await screen.findByText('Advanced Features');
    const text = tooltipFor('create-game-naval');
    expect(text).toMatch(/Rules: Attacking across a sea connection/);
    expect(text).not.toMatch(/How it feels here/);
  });
});

describe('LobbyPage Custom Game victory conditions', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(() => Promise.reject(new Error('offline')));
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
    stubMatchMedia();
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, space_age_moon_race_enabled: true } }));
  });

  it('says a Capital win needs your own capital as well as every rival one', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    expect(tooltipFor('create-game-victory-capital')).toMatch(/Hold your own and capture every rival capital/);
  });

  it('describes secret missions as they are dealt', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    const text = tooltipFor('create-game-victory-secret_mission');
    expect(text).toMatch(/eliminate a named player yourself/);
    expect(text).toMatch(/one or two named regions/);
    expect(text).toMatch(/two players can draw the same one/);
    expect(text).not.toMatch(/unique/i);
  });

  it('sends at most 99% as a territory threshold, the most the server accepts', async () => {
    renderCustomGame();
    await screen.findByText('Advanced Features');
    fireEvent.click(checkbox('create-game-victory-threshold'));
    fireEvent.change(screen.getByLabelText('Threshold %'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Create & Enter Lobby/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/games', expect.anything()));
    const body = postMock.mock.calls.find(([url]) => url === '/games')![1] as { settings: Record<string, unknown> };
    expect(body.settings.victory_threshold).toBe(99);
  });

  it('names the endings a Space Age game adds: the Lunar Hegemony and the turn cap', async () => {
    renderCustomGame('space_age');
    await screen.findByText('Advanced Features');
    const note = screen.getByTestId('create-game-extra-endings').textContent ?? '';
    expect(note).toMatch(/every lunar territory for 7 of your own turns in a row also wins/);
    expect(note).toMatch(/by the end of turn 90, the player holding the most territories wins/);
  });

  it('leaves the Lunar Hegemony out when the Moon Race is switched off', async () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, space_age_moon_race_enabled: false } }));
    renderCustomGame('space_age');
    await screen.findByText('Advanced Features');
    const note = screen.getByTestId('create-game-extra-endings').textContent ?? '';
    expect(note).not.toMatch(/lunar/i);
    expect(note).toMatch(/by the end of turn 90/);
  });

  it('adds no note for an era without endings of its own', async () => {
    renderCustomGame('ww2');
    await screen.findByText('Advanced Features');
    expect(screen.queryByTestId('create-game-extra-endings')).toBeNull();
  });
});
