/**
 * ?continue=1: a stage's results send the player to the campaign page to go
 * straight on. The page makes the campaign's next game once and opens it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

function renderAt(url: string, status: 'active' | 'completed' = 'active') {
  useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: false } as never });
  getMock.mockImplementation((path: string) =>
    path === '/campaign/list'
      ? Promise.resolve({ data: { campaigns: [campaignRow(status)] } })
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
});
