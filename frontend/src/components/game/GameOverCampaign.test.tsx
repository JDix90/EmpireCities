/**
 * A campaign stage's results: the stage's closing text, what was carried
 * forward, and one button for where the campaign goes next. Rematch is not
 * offered: the campaign makes the stage's next game.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';
import type { CampaignGameResult } from '../../utils/campaignResult';

const campaign = (overrides: Partial<CampaignGameResult> = {}): CampaignGameResult => ({
  campaign_id: 'c1',
  path_id: 'blood_empire',
  path_name: 'Blood & Empire',
  stage: 1,
  stage_count: 6,
  outcome: 'advanced',
  next_era: 'medieval',
  outro_text: 'The eagle flies from the Rhine to the Euphrates.',
  carry: { label: 'Prestige', before: 0, after: 2 },
  carry_effects: [{ key: 'prestige', label: 'Prestige', text: '+2 attack dice in rounds 1\u20133', until_round: 3 }],
  ...overrides,
});

function gameOver(overrides: Partial<GameOverModalData> = {}): GameOverModalData {
  return {
    type: 'game_over',
    gameId: 'g1',
    isWinner: true,
    winnerName: 'commander',
    winnerColor: '#3498db',
    turnCount: 19,
    players: [
      { player_id: 'me', username: 'commander', color: '#3498db', territory_count: 17, is_eliminated: false, is_ai: false },
      { player_id: 'ai1', username: 'AI Bot 1', color: '#e74c3c', territory_count: 9, is_eliminated: false, is_ai: true },
    ],
    xpEarned: 100,
    rematchConfig: { era_id: 'ancient', map_id: 'era_ancient', settings: { is_campaign: true }, human_player_ids: [] },
    campaign: campaign(),
    ...overrides,
  } as GameOverModalData;
}

describe('campaign stage results', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({
      user: { user_id: 'me', username: 'commander', level: 2, xp: 250, mmr: 1000, is_guest: false },
      isAuthenticated: true,
    });
  });

  it('shows the closing text, the carry gained, and leads with the next step', () => {
    const next = vi.fn();
    render(
      <ActionModal
        data={gameOver()}
        onDismiss={() => {}}
        onRematch={() => {}}
        nextBattle={{ label: 'Next era: Medieval Era', onClick: next }}
      />,
    );
    const block = within(screen.getByTestId('gameover-campaign'));
    expect(block.getByText(/Blood & Empire · Era 1 of 6/)).toBeTruthy();
    expect(block.getByText(/The eagle flies/)).toBeTruthy();
    expect(screen.getByTestId('gameover-campaign-carry').textContent).toBe('Carried into the next eraPrestige: +2 attack dice in rounds 1\u20133');

    fireEvent.click(screen.getByRole('button', { name: /Next era: Medieval Era/ }));
    expect(next).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Rematch/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Campaign HQ/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Return to Lobby/ })).toBeNull();
  });

  it('says the campaign is complete after the last stage', () => {
    render(
      <ActionModal
        data={gameOver({ campaign: campaign({ stage: 6, outcome: 'completed', next_era: null }) })}
        onDismiss={() => {}}
        nextBattle={{ label: 'See your campaign', onClick: () => {} }}
      />,
    );
    expect(within(screen.getByTestId('gameover-campaign')).getByText('Campaign complete.')).toBeTruthy();
  });

  it('never offers Rematch for a campaign stage, even with no campaign result sent', () => {
    // A stage resigned in its opening turns ends as abandoned, with no result
    // for the campaign; a rematch of it would still be an empty lobby.
    render(<ActionModal data={gameOver({ isWinner: false, campaign: undefined })} onDismiss={() => {}} onRematch={() => {}} />);
    expect(screen.queryByTestId('gameover-campaign')).toBeNull();
    expect(screen.queryByRole('button', { name: /Rematch/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Campaign HQ/ })).toBeTruthy();
  });

  it('leaves an ordinary game as it was', () => {
    render(
      <ActionModal
        data={gameOver({ campaign: undefined, rematchConfig: { era_id: 'ancient', map_id: 'm', settings: {}, human_player_ids: [] } })}
        onDismiss={() => {}}
        onRematch={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Rematch/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Return to Lobby/ })).toBeTruthy();
  });
});
