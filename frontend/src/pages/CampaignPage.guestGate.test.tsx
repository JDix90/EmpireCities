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
    expect(screen.getByText(/Campaigns need an account/)).toBeInTheDocument();
    // The whole point of intercepting client-side: the guest never eats a 403.
    expect(postMock).not.toHaveBeenCalled();
  });

  it('sends the guest to /upgrade, which converts the row in place', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Create Free Account/ }));
    expect(navigateMock).toHaveBeenCalledWith('/upgrade');
  });

  it('dismisses back to the campaign list without starting anything', async () => {
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Maybe later/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(postMock).not.toHaveBeenCalled();
  });

  it('starts normally for a registered player', async () => {
    postMock.mockResolvedValue({ data: { campaign_id: 'c1', game_id: 'g1' } });
    renderPage(false);
    fireEvent.click(await screen.findByRole('button', { name: /Iron Road/ }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/campaign/start', { path_id: 'iron' }));
    expect(screen.queryByText(/Campaigns need an account/)).not.toBeInTheDocument();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g1'));
  });
});
