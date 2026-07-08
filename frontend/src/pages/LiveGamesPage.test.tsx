import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LiveGamesPage from './LiveGamesPage';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const apiGet = vi.fn((..._args: unknown[]) => Promise.resolve({ data: [] }));
vi.mock('../services/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

function setFlags(spectateEnabled: boolean, loaded = true) {
  useFeatureFlagsStore.setState((s) => ({
    loaded,
    flags: { ...s.flags, spectate_enabled: spectateEnabled },
  }));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LiveGamesPage />
    </MemoryRouter>,
  );
}

describe('LiveGamesPage spectate flag', () => {
  beforeEach(() => {
    apiGet.mockClear();
  });

  it('shows the disabled notice (and does not poll) when spectating is flagged off', () => {
    setFlags(false);
    renderPage();
    expect(screen.getByText('Spectating is currently disabled')).toBeInTheDocument();
    expect(screen.getByText(/back to the lobby/i)).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('renders the live list and fetches games when spectating is enabled', async () => {
    setFlags(true);
    renderPage();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByText('No live games right now')).toBeInTheDocument();
    expect(screen.queryByText('Spectating is currently disabled')).not.toBeInTheDocument();
  });

  it('does not flash the disabled notice while flags are still loading', () => {
    setFlags(false, false);
    renderPage();
    expect(screen.queryByText('Spectating is currently disabled')).not.toBeInTheDocument();
  });
});
