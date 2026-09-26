import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { markerLook } from '@borderfall/shared';
import GameHUD from '../game/GameHUD';
import ActionModal, { CombatResultView, type GameOverModalData } from '../game/ActionModal';
import { useGameStore, type CombatResult, type GameState } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import FrameRing from './FrameRing';
import SkinnedMiniDie from './SkinnedMiniDie';
import { markerSvgElement, markerSvgMarkup } from './markerSvg';

vi.mock('../../services/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));
// The game-over card mounts panels that fetch on their own.
vi.mock('../../services/api', () => ({ api: { get: () => Promise.resolve({ data: {} }), post: () => Promise.resolve({ data: {} }) } }));

function player(id: string, idx: number, extra: Record<string, unknown> = {}) {
  return {
    player_id: id, player_index: idx, username: id, color: '#fff', is_ai: false,
    is_eliminated: false, territory_count: 3, cards: [], mmr: 1000,
    capital_territory_id: null, secret_mission: null, ...extra,
  };
}

/** Me wearing a frame, a banner and bone dice; the rival wearing holographic dice; an AI wearing nothing. */
function makeState(): GameState {
  return {
    game_id: 'g1', era: 'ancient', map_id: 'm1', phase: 'attack',
    current_player_index: 0, turn_number: 7,
    players: [
      player('me', 0, { cosmetics: { frame: 'frame_level_50', banner: 'emperor_title', dice: 'bone_dice' } }),
      player('rival', 1, { username: 'Rival', cosmetics: { dice: 'holo_dice' } }),
      player('ai_2', 2, { username: 'General Varro (AI)', is_ai: true }),
    ],
    territories: {},
    card_set_redemption_count: 0,
    turn_started_at: Date.now(),
    settings: {} as GameState['settings'],
  } as GameState;
}

const battle: CombatResult = {
  attacker_rolls: [6, 5, 2],
  defender_rolls: [4, 3],
  attacker_losses: 0,
  defender_losses: 2,
  territory_captured: false,
  fromName: 'Gaul',
  toName: 'Italia',
  attackerId: 'me',
  defenderId: 'rival',
  attackerName: 'me',
  defenderName: 'Rival',
};

const setStoreV2 = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, store_v2_enabled: on } }));

function renderHud() {
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
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
  useGameStore.setState({ gameState: makeState(), draftUnitsRemaining: 0, lastCombatResult: battle } as never);
});
// In act: mounted components re-render on the flag.
afterEach(() => act(() => setStoreV2(false)));

describe('cosmetics in a match, with store_v2_enabled on', () => {
  beforeEach(() => setStoreV2(true));

  it('rings each player in their frame and shows their banner in the players list', () => {
    const { container } = renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));

    expect(container.querySelector('[data-frame="frame_level_50"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Emperor' })).toBeInTheDocument();
    // Every dot gets the ring's padding, so the rows stay aligned.
    expect(container.querySelectorAll('.p-0\\.5.rounded-full')).toHaveLength(3);
  });

  it('shows the last battle in each side’s dice skin', () => {
    renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Log/ }));

    const dice = screen.getAllByTestId('skinned-die');
    expect(dice).toHaveLength(5);
    expect(dice.slice(0, 3).every((d) => d.classList.contains('ring-red-500/80'))).toBe(true);
    expect(dice.slice(3).every((d) => d.classList.contains('ring-blue-500/80'))).toBe(true);
    expect(dice[0].style.color).toBe('rgb(74, 53, 32)'); // bone ink
    expect(dice[3]).toHaveClass('cosmetic-shimmer'); // holographic
  });

  it('rolls the combat card’s dice in each side’s skin, banner beside the name', () => {
    render(<CombatResultView result={battle} onDismiss={() => {}} />);

    const dice = screen.getAllByTestId('skinned-die');
    expect(dice).toHaveLength(5);
    expect(dice.filter((d) => d.classList.contains('ring-red-500/80'))).toHaveLength(3);
    expect(dice.filter((d) => d.classList.contains('ring-blue-500/80'))).toHaveLength(2);
    expect(within(screen.getByText('me', { selector: 'p' })).getByRole('img', { name: 'Emperor' })).toBeInTheDocument();
  });

  it('keeps the plain dice for a side wearing none', () => {
    render(<CombatResultView result={{ ...battle, defenderId: 'ai_2', defenderName: 'General Varro (AI)' }} onDismiss={() => {}} />);
    expect(screen.getAllByTestId('skinned-die')).toHaveLength(3);
  });
});

const gameOver: GameOverModalData = {
  type: 'game_over',
  gameId: 'g1',
  isWinner: true,
  winnerName: 'me',
  winnerColor: '#fff',
  turnCount: 12,
  players: [
    { player_id: 'me', username: 'me', color: '#fff', territory_count: 10, is_eliminated: false, is_ai: false },
    { player_id: 'rival', username: 'Rival', color: '#000', territory_count: 0, is_eliminated: true, is_ai: false },
  ],
  victory_condition: 'domination',
};

const renderGameOver = () =>
  render(
    <MemoryRouter>
      <ActionModal data={gameOver} onDismiss={() => {}} />
    </MemoryRouter>,
  );

describe('final standings', () => {
  it('ring the player in their frame and show their banner, on both tabs (store_v2_enabled on)', () => {
    setStoreV2(true);
    const { container } = renderGameOver();
    expect(container.querySelector('[data-frame="frame_level_50"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Emperor' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Match Stats' }));
    expect(container.querySelector('[data-frame="frame_level_50"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Emperor' })).toBeInTheDocument();
  });

  it('are unchanged with the flag off', () => {
    const { container } = renderGameOver();
    expect(container.querySelector('[data-frame]')).toBeNull();
    expect(container.querySelector('[data-banner]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Match Stats' }));
    expect(container.querySelector('[data-frame]')).toBeNull();
  });
});

describe('cosmetics in a match, with store_v2_enabled off', () => {
  it('draws nothing new, even in a game that took cosmetics when it started', () => {
    const { container } = renderHud();
    fireEvent.click(screen.getByRole('tab', { name: /Players/ }));
    expect(container.querySelector('[data-frame]')).toBeNull();
    expect(container.querySelector('[data-banner]')).toBeNull();
    expect(container.querySelectorAll('.p-0\\.5.rounded-full')).toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: /Log/ }));
    expect(screen.queryAllByTestId('skinned-die')).toHaveLength(0);
    expect(screen.getByText('6')).toHaveClass('bg-red-500/20');
  });

  it('rolls plain red and blue dice on the combat card', () => {
    const { container } = render(<CombatResultView result={battle} onDismiss={() => {}} />);
    expect(screen.queryAllByTestId('skinned-die')).toHaveLength(0);
    expect(container.querySelector('[data-banner]')).toBeNull();
  });
});

describe('Reduced animations (lite mode)', () => {
  beforeEach(() => localStorage.setItem('cc-lite-mode', 'true'));

  it('stills a turning frame and a shimmering die', () => {
    render(
      <>
        <FrameRing frameId="frame_s1_diamond"><span>C</span></FrameRing>
        <SkinnedMiniDie value={6} look={{ kind: 'dice', face: ['#fff'], ink: '#000', edge: '#000', effect: 'shimmer' }} side="attacker" className="w-5 h-5" />
      </>,
    );
    expect(screen.getByTestId('frame-ring')).not.toHaveClass('animate-frame-spin');
    expect(screen.getByTestId('skinned-die')).not.toHaveClass('cosmetic-shimmer');
  });
});

describe('capital marker SVG', () => {
  const crown = markerLook('marker_crown')!;

  it('draws the glyph in its colour over a dark outline', () => {
    const markup = markerSvgMarkup(crown, 64);
    expect(markup).toContain('stroke="#fbbf24"');
    expect(markup).toContain('stroke="#0b0d12"');
    expect(markup).toContain('width="64"');
    expect(markup.match(/<path /g)).toHaveLength(4); // crown's two paths, outline and glyph
  });

  it('builds the same drawing as DOM nodes for the globe', () => {
    const svg = markerSvgElement(crown, 16);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const groups = svg.querySelectorAll('g');
    expect(groups).toHaveLength(2);
    expect(groups[1].getAttribute('stroke')).toBe('#fbbf24');
    expect(svg.querySelectorAll('path')).toHaveLength(4);
  });
});
