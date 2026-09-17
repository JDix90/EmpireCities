/**
 * Starting the tutorial counts as first-visit triage.
 *
 * `onboarding_tutorial_first_enabled` sends a landing guest straight to
 * `/tutorial?start=1`, skipping the lobby — the only other place the welcome
 * flag was ever set. The lobby then shows its "Start Tutorial / Quick Match"
 * modal to any account with 0 XP that has not completed the tutorial and has
 * not been welcomed, which is precisely the state of a player who pressed
 * "Exit Tutorial" on step 2. They were asked whether they would like to try
 * the tutorial they had just walked out of.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TutorialPage from './TutorialPage';
import { useAuthStore } from '../store/authStore';
import { hasSeenWelcome } from '../components/ui/NewUserWelcomeModal';

const postMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { post: (...a: unknown[]) => postMock(...a) },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// The page waits for `bootstrapped` before it will call an authenticated route.
vi.mock('../hooks/useAuthStoreHydrated', () => ({ useAuthStoreHydrated: () => true }));

function renderAutoStart() {
  useAuthStore.setState({
    isAuthenticated: true,
    bootstrapped: true,
    user: { user_id: 'u1', username: 'guest', is_guest: true } as never,
  });
  return render(
    <MemoryRouter initialEntries={['/tutorial?start=1']}>
      <TutorialPage />
    </MemoryRouter>,
  );
}

describe('TutorialPage first-visit triage', () => {
  beforeEach(() => {
    postMock.mockReset();
    navigateMock.mockReset();
    localStorage.clear();
    postMock.mockResolvedValue({ data: { game_id: 'g1' } });
  });

  it('marks the welcome seen once the tutorial game starts', async () => {
    expect(hasSeenWelcome()).toBe(false);
    renderAutoStart();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/game/g1', { replace: true }));
    // Without this the player who exits at step 2 lands in the lobby with 0 XP,
    // nothing marked complete and no welcome flag — and gets re-offered the
    // tutorial they just left.
    expect(hasSeenWelcome()).toBe(true);
  });

  it('does not mark it when the tutorial fails to start', async () => {
    postMock.mockRejectedValue(new Error('nope'));
    renderAutoStart();

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    // The player never saw a tutorial, so the lobby should still triage them.
    expect(hasSeenWelcome()).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

/**
 * A failed auto-start used to be a dead end. `?start=1` renders a spinner keyed
 * on the param alone, so when the start call failed the toast faded and the
 * visitor was left on "Starting tutorial…" with no link out — and because
 * `onboarding_tutorial_first` routes landing guests straight here, that screen
 * is the first thing they ever see of Borderfall.
 */
describe('TutorialPage auto-start failure', () => {
  beforeEach(() => {
    postMock.mockReset();
    navigateMock.mockReset();
    localStorage.clear();
  });

  it('offers a way out instead of spinning forever', async () => {
    postMock.mockRejectedValue(new Error('nope'));
    renderAutoStart();

    const alert = await screen.findByTestId('tutorial-autostart-failed');
    expect(alert).toHaveTextContent(/couldn.t start the tutorial/i);
    // The spinner is gone and the picker — retry buttons and an exit — is up.
    expect(screen.queryByText(/Starting tutorial/i)).toBeNull();
    expect(screen.getByRole('link', { name: /skip it and just play/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Start Lesson|Start lesson/i }).length).toBeGreaterThan(0);
  });

  it('keeps spinning while the start is still in flight', async () => {
    // Never settles: the spinner is correct here, and must not be mistaken for
    // the failure state.
    postMock.mockReturnValue(new Promise(() => {}));
    renderAutoStart();

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(screen.getByText(/Starting tutorial/i)).toBeInTheDocument();
    expect(screen.queryByTestId('tutorial-autostart-failed')).toBeNull();
  });

  it('does not retry on its own', async () => {
    postMock.mockRejectedValue(new Error('nope'));
    renderAutoStart();

    await screen.findByTestId('tutorial-autostart-failed');
    // Rendering the picker must not re-trigger the auto-start effect: a retry
    // loop against a failing endpoint is worse than the dead end it replaced.
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
