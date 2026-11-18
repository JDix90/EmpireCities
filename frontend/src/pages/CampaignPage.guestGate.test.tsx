import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CampaignPage from './CampaignPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

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

const PATHS = [
  { path_id: 'iron', name: 'Iron Road', description: 'Six eras, one continent.', eras: ['ancient'] },
];

function renderPage(isGuest: boolean) {
  useAuthStore.setState({ user: { user_id: 'u1', username: 'commander', is_guest: isGuest } as never });
  return render(
    <MemoryRouter>
      <CampaignPage />
    </MemoryRouter>,
  );
}

describe('CampaignPage guest gate', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    navigateMock.mockReset();
    // No campaigns → the page drops straight into path selection, which is the
    // only screen a guest ever reaches (GET /campaign/list is empty for them).
    getMock.mockImplementation((url: string) =>
      url === '/campaign/list'
        ? Promise.resolve({ data: { campaigns: [] } })
        : Promise.resolve({ data: PATHS }),
    );
  });

  it('offers an account instead of starting, and never calls the endpoint that would 403', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Campaigns need a saved account/)).toBeInTheDocument();
    // The whole point of intercepting client-side: the guest never eats a 403.
    // No request but the analytics beacon (funnel_events_v2_enabled records the prompt shown).
    expect(postMock.mock.calls.filter(([url]) => url !== '/analytics/ui-event')).toEqual([]);
  });

  it('sends the guest to /upgrade, which converts the row in place', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Save your account/ }));
    expect(navigateMock).toHaveBeenCalledWith('/upgrade');
  });

  it('dismisses back to the campaign list without starting anything', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Maybe later/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // No request but the analytics beacon (funnel_events_v2_enabled records the prompt shown).
    expect(postMock.mock.calls.filter(([url]) => url !== '/analytics/ui-event')).toEqual([]);
  });

  describe('with guest_campaign_enabled', () => {
    const OPEN_PATHS = [
      { path_id: 'iron', name: 'Iron Road', description: 'Six eras, one continent.', guest_open: true, recommended_start: true },
      { path_id: 'ember', name: 'Ember Line', description: 'The hard way.', guest_open: false },
    ];
    const flagsBefore = useFeatureFlagsStore.getState().flags;
    beforeEach(() => {
      useFeatureFlagsStore.setState({ flags: { ...flagsBefore, guest_campaign_enabled: true } });
      getMock.mockImplementation((url: string) =>
        url === '/campaign/list'
          ? Promise.resolve({ data: { campaigns: [] } })
          : Promise.resolve({ data: OPEN_PATHS }),
      );
      return () => useFeatureFlagsStore.setState({ flags: flagsBefore });
    });

    it('lets a guest start a path open to guests, and says saving is there when they want it', async () => {
      postMock.mockResolvedValue({ data: { campaign_id: 'c1', game_id: 'g1' } });
      renderPage(true);
      fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
      // The same confirmation a saved account gets, with a line about saving: offered, not required.
      expect(await screen.findByRole('dialog', { name: /Iron Road/ })).toBeInTheDocument();
      expect(screen.getByTestId('campaign-start-guest-note').textContent).toMatch(/save your account at any point/);
      fireEvent.click(screen.getByRole('button', { name: /Start campaign/ }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/campaign/start', { path_id: 'iron' }));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g1'));
    });

    it('marks the paths that still need a saved account, and offers one instead of starting them', async () => {
      renderPage(true);
      const closed = await screen.findByRole('button', { name: /Ember Line/ });
      expect(screen.getAllByTestId('campaign-path-needs-account')).toHaveLength(1);
      expect(closed.textContent).toContain('Needs a saved account');
      fireEvent.click(closed);
      expect(await screen.findByText(/This path needs a saved account/)).toBeInTheDocument();
      expect(screen.getByText(/You can play the path marked "Start here" right now/)).toBeInTheDocument();
      expect(postMock.mock.calls.filter(([url]) => url !== '/analytics/ui-event')).toEqual([]);
    });

    it('marks nothing for a saved account', async () => {
      renderPage(false);
      await screen.findByRole('button', { name: /Ember Line/ });
      expect(screen.queryByTestId('campaign-path-needs-account')).toBeNull();
    });

    it('still offers an account for every path when the server marks none open', async () => {
      getMock.mockImplementation((url: string) =>
        url === '/campaign/list' ? Promise.resolve({ data: { campaigns: [] } }) : Promise.resolve({ data: PATHS }),
      );
      renderPage(true);
      fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
      expect(await screen.findByText(/Campaigns need a saved account/)).toBeInTheDocument();
    });
  });

  it('starts normally for a registered player', async () => {
    postMock.mockResolvedValue({ data: { campaign_id: 'c1', game_id: 'g1' } });
    renderPage(false);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
    // The choice opens a confirmation first (PT-017); nothing is created until it is accepted.
    expect(await screen.findByRole('dialog', { name: /Iron Road/ })).toBeInTheDocument();
    // No request but the analytics beacon (funnel_events_v2_enabled records the prompt shown).
    expect(postMock.mock.calls.filter(([url]) => url !== '/analytics/ui-event')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Start campaign/ }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/campaign/start', { path_id: 'iron' }));
    expect(screen.queryByText(/Campaigns need an account/)).not.toBeInTheDocument();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g1'));
  });
});
