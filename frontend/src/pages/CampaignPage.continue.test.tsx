/**
 * ?continue=1: a stage's results send the player to the campaign page to go
 * straight on. The page makes the campaign's next game once and opens it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CampaignPage from './CampaignPage';
import { useAuthStore } from '../store/authStore';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const campaignRow = (status: 'active' | 'completed') => ({
  campaign_id: 'c1',
  status,
  current_era: 'medieval',
  current_era_index: 1,
  next_era: 'discovery',
  prestige_points: 2,
  started_at: '2026-11-18T00:00:00Z',
  completed_at: null,
  path_id: null,
  path_carry: {},
  path_narrative: {},
  path_config: null,
  eras: [],
});

function renderAt(url: string, status: 'active' | 'completed' = 'active', over: Record<string, unknown> = {}) {
  useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: false } as never });
  getMock.mockImplementation((path: string) =>
    path === '/campaign/list'
      ? Promise.resolve({ data: { campaigns: [{ ...campaignRow(status), ...over }] } })
      : Promise.resolve({ data: [] }),
  );
  postMock.mockImplementation((path: string) =>
    path === '/campaign/continue' ? Promise.resolve({ data: { game_id: 'g2' } }) : Promise.resolve({ data: {} }),
  );
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CampaignPage />
    </MemoryRouter>,
  );
}

const continueCalls = () => postMock.mock.calls.filter(([path]) => path === '/campaign/continue');

describe('CampaignPage ?continue=1', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    navigateMock.mockReset();
  });

  it('makes the next game once and opens it', async () => {
    renderAt('/campaign?campaign_id=c1&continue=1');
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g2'));
    expect(continueCalls()).toEqual([['/campaign/continue', { campaign_id: 'c1' }]]);
  });

  it('starts nothing without the parameter', async () => {
    renderAt('/campaign?campaign_id=c1');
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(continueCalls()).toEqual([]);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('starts nothing for a campaign that is already complete', async () => {
    renderAt('/campaign?campaign_id=c1&continue=1', 'completed');
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(continueCalls()).toEqual([]);
  });

  describe('at a stage that offers a side', () => {
    const lineChoice = {
      choose_at: 3,
      chosen: null,
      options: [
        { line_id: 'allies', name: 'The Western Allies', pitch: 'Land in France.', title: 'The Second Front, 1944', faction_id: 'usa' },
        { line_id: 'soviets', name: 'The Soviet Union', pitch: 'Drive west.', title: 'Berlin and Manchuria, 1945', faction_id: 'soviet_union' },
      ],
    };
    const stage4 = (era3: Record<string, unknown> = {}) => ({
      current_era: 'ww2', current_era_index: 3, next_era: 'coldwar', path_id: 'blood_empire', line_choice: lineChoice,
      eras: [0, 1, 2, 3, 4, 5].map((index) => ({
        era_id: ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'][index], index, won: index < 3, completed: index < 3,
        game_id: null, faction_id: null, map_id: 'm', intro_text: null, outro_win_text: null, outro_loss_text: null,
        ...(index === 3 ? era3 : {}),
      })),
    });

    it('asks for the side before it makes the game, and sends the one chosen', async () => {
      renderAt('/campaign?campaign_id=c1&continue=1', 'active', stage4());
      const dialog = await screen.findByTestId('campaign-line-chooser');
      expect(dialog.textContent).toContain('The Second Front, 1944');
      expect(dialog.textContent).toContain('You command: Soviet Union');
      expect(continueCalls()).toEqual([]);
      fireEvent.click(screen.getByTestId('campaign-line-soviets'));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g2'));
      expect(continueCalls()).toEqual([['/campaign/continue', { campaign_id: 'c1', line: 'soviets' }]]);
    });

    it('goes straight back into a stage game still in progress', async () => {
      renderAt('/campaign?campaign_id=c1&continue=1', 'active', stage4({ game_id: 'g1', completed: false }));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g2'));
      expect(continueCalls()).toEqual([['/campaign/continue', { campaign_id: 'c1' }]]);
      expect(screen.queryByTestId('campaign-line-chooser')).toBeNull();
    });

    it('makes nothing when the choice is put off', async () => {
      renderAt('/campaign?campaign_id=c1', 'active', stage4());
      fireEvent.click(await screen.findByRole('button', { name: /^Continue/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Not yet' }));
      await waitFor(() => expect(screen.queryByTestId('campaign-line-chooser')).toBeNull());
      expect(continueCalls()).toEqual([]);
    });
  });
});
