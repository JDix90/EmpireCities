/**
 * Mission reveal (`mission_reveal_enabled`): a game won on a secret mission
 * said only "Secret Mission completed". The game-over screen now lists every
 * player's mission, the completed one first, from the missions game:over sends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const lookup = {
  territories: [
    { territory_id: 'caucasus', name: 'Caucasus' },
    { territory_id: 'iran', name: 'Iran' },
  ],
  regions: [{ region_id: 'pacific', name: 'Pacific Theatre' }],
};

function gameOver(overrides: Partial<GameOverModalData> = {}): GameOverModalData {
  return {
    type: 'game_over',
    gameId: 'g1',
    isWinner: false,
    winnerName: 'Lady Hoshiko (AI)',
    winnerColor: '#3498db',
    turnCount: 4,
    viewerId: 'me',
    winnerIds: ['ai1'],
    victory_condition: 'secret_mission',
    players: [
      {
        player_id: 'me', username: 'Ossawatomix', color: '#e74c3c', territory_count: 9, is_eliminated: false, is_ai: false,
        secret_mission: { kind: 'eliminate_player', target_player_id: 'ai2' },
      },
      {
        player_id: 'ai1', username: 'Lady Hoshiko (AI)', color: '#3498db', territory_count: 11, is_eliminated: false, is_ai: true,
        secret_mission: { kind: 'capture_territories', territory_ids: ['caucasus', 'iran'] },
      },
      {
        player_id: 'ai2', username: 'Marshal Lefèvre (AI)', color: '#2ecc71', territory_count: 8, is_eliminated: false, is_ai: true,
        secret_mission: { kind: 'control_regions', region_ids: ['pacific'] },
      },
    ],
    ...overrides,
  } as GameOverModalData;
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, mission_reveal_enabled: on } }));

const rows = () => screen.queryAllByTestId('gameover-mission').map((li) => li.textContent);

describe('secret missions revealed at game over', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'Ossawatomix', level: 2, xp: 250, mmr: 1000 },
      isAuthenticated: true,
    });
    setFlag(true);
  });
  afterEach(() => setFlag(true));

  it('lists every player\'s mission under how the game ended, the completed one first', () => {
    render(<ActionModal data={gameOver()} onDismiss={() => {}} mapNameLookup={lookup} />);
    expect(screen.getByTestId('gameover-missions').textContent).toMatch(/^Secret missions/);
    expect(rows()).toEqual([
      'Lady Hoshiko (AI): Capture Caucasus and Iran✓ Completed',
      'You: Eliminate Marshal Lefèvre (AI)',
      'Marshal Lefèvre (AI): Control Pacific Theatre',
    ]);
  });

  it('marks both allies when an alliance mission won the game', () => {
    const allied = gameOver({ victory_condition: 'alliance_victory', winnerIds: ['me', 'ai1'], isWinner: true });
    allied.players = [
      { ...allied.players[0], secret_mission: { kind: 'alliance', ally_player_id: 'ai1', territory_threshold: 12 } },
      { ...allied.players[1], secret_mission: { kind: 'alliance', ally_player_id: 'me', territory_threshold: 12 } },
      allied.players[2],
    ];
    render(<ActionModal data={allied} onDismiss={() => {}} mapNameLookup={lookup} />);
    expect(rows()).toEqual([
      'You: Hold 12 territories each with ally Lady Hoshiko (AI)✓ Completed',
      'Lady Hoshiko (AI): Hold 12 territories each with ally Ossawatomix✓ Completed',
      'Marshal Lefèvre (AI): Control Pacific Theatre',
    ]);
  });

  it('leaves out a player who was never dealt a mission', () => {
    const data = gameOver();
    data.players = [{ ...data.players[0], secret_mission: null }, data.players[1], data.players[2]];
    render(<ActionModal data={data} onDismiss={() => {}} mapNameLookup={lookup} />);
    expect(rows()).toHaveLength(2);
  });

  it('stays out of games won another way, and with the flag off', () => {
    const { unmount } = render(<ActionModal data={gameOver({ victory_condition: 'domination' })} onDismiss={() => {}} />);
    expect(screen.queryByTestId('gameover-missions')).toBeNull();
    unmount();

    setFlag(false);
    render(<ActionModal data={gameOver()} onDismiss={() => {}} />);
    expect(screen.queryByTestId('gameover-missions')).toBeNull();
  });
});
