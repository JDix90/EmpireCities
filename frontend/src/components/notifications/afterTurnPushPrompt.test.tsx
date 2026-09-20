/**
 * offerPushAfterAsyncTurn: the ask at the moment of motivation.
 *
 * Fires once per page load when an async turn has just been handed over and a
 * click can lead somewhere; shares the lobby card's 30-day snooze; a toast
 * that merely times out is not a "no". The iPhone-tab variant gives Home
 * Screen advice instead of a button that could not work there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import {
  offerPushAfterAsyncTurn,
  resetAfterTurnPromptForTests,
  deadlineLabel,
  AFTER_TURN_PROMPT_TOAST_ID,
} from './afterTurnPushPrompt';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';
import { PUSH_NUDGE_SNOOZE_MS } from './PushOptInBanner';

const push = vi.hoisted(() => ({
  status: 'default' as string,
  homeScreen: false,
  enable: vi.fn(),
}));
vi.mock('../../services/pushNotifications', () => ({
  getWebPushStatus: () => push.status,
  needsHomeScreenInstall: () => push.homeScreen,
  enableWebPush: () => push.enable(),
}));

type ToastRender = (t: { id: string }) => ReactElement;
const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & {
    dismiss: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  fn.dismiss = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  return fn;
});
vi.mock('react-hot-toast', () => ({ default: toastMock }));

const asyncGame = (over: Partial<{ async_mode: boolean; async_turn_deadline_seconds: number; phase: string }> = {}) => ({
  settings: { async_mode: over.async_mode ?? true, async_turn_deadline_seconds: over.async_turn_deadline_seconds ?? 86_400 },
  phase: over.phase ?? 'draft',
});

/** Render what the toast would show, as the toaster would. */
function renderPrompt() {
  const renderFn = toastMock.mock.calls.at(-1)?.[0] as ToastRender;
  return render(renderFn({ id: AFTER_TURN_PROMPT_TOAST_ID }));
}

describe('offerPushAfterAsyncTurn', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAfterTurnPromptForTests();
    push.status = 'default';
    push.homeScreen = false;
    push.enable.mockReset().mockResolvedValue('granted');
    toastMock.mockReset();
    toastMock.dismiss.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('asks once per page load after an async turn ends, with the deadline in the copy', () => {
    expect(offerPushAfterAsyncTurn(asyncGame())).toBe(true);
    expect(toastMock).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ id: AFTER_TURN_PROMPT_TOAST_ID }));
    renderPrompt();
    expect(screen.getByText(/up to 24 hours to play/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();

    expect(offerPushAfterAsyncTurn(asyncGame())).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a real-time game', () => asyncGame({ async_mode: false })],
    ['a game that just ended', () => asyncGame({ phase: 'game_over' })],
  ])('does not ask after %s', (_label, game) => {
    expect(offerPushAfterAsyncTurn(game())).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it.each([
    ['permission already granted', 'granted'],
    ['permission already refused', 'denied'],
    ['a build without Firebase', 'unconfigured'],
    ['a browser without push that is not an iPhone tab', 'unsupported'],
  ])('does not ask with %s', (_label, status) => {
    push.status = status;
    expect(offerPushAfterAsyncTurn(asyncGame())).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('honours a "Not now" from the lobby card — one snooze for both', () => {
    markPushNudgeDismissed();
    expect(offerPushAfterAsyncTurn(asyncGame())).toBe(false);
    markPushNudgeDismissed(Date.now() - PUSH_NUDGE_SNOOZE_MS - 1);
    expect(offerPushAfterAsyncTurn(asyncGame())).toBe(true);
  });

  it('Turn on asks inside the click, then thanks the player and closes the prompt', async () => {
    offerPushAfterAsyncTurn(asyncGame());
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(push.enable).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(toastMock.dismiss).toHaveBeenCalledWith(AFTER_TURN_PROMPT_TOAST_ID);
    // Not a "no": nothing snoozed.
    expect(getPushNudgeDismissedAt()).toBeNull();
  });

  it('explains a refusal', async () => {
    push.enable.mockResolvedValue('denied');
    offerPushAfterAsyncTurn(asyncGame());
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringMatching(/blocked/)));
  });

  it('"Not now" closes the prompt and snoozes the lobby card too', () => {
    offerPushAfterAsyncTurn(asyncGame());
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(toastMock.dismiss).toHaveBeenCalledWith(AFTER_TURN_PROMPT_TOAST_ID);
    expect(getPushNudgeDismissedAt()).not.toBeNull();
  });

  it('gives Home Screen advice instead of a button in an iPhone browser tab', () => {
    push.status = 'unsupported';
    push.homeScreen = true;
    expect(offerPushAfterAsyncTurn(asyncGame())).toBe(true);
    renderPrompt();
    expect(screen.getByText(/Add Borderfall to your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(getPushNudgeDismissedAt()).not.toBeNull();
  });
});

describe('deadlineLabel', () => {
  it('reads naturally for the usual async deadlines', () => {
    expect(deadlineLabel(86_400)).toBe('24 hours');
    expect(deadlineLabel(172_800)).toBe('2 days');
    expect(deadlineLabel(43_200)).toBe('12 hours');
    expect(deadlineLabel(3_600)).toBe('1 hour');
    expect(deadlineLabel(undefined)).toBe('24 hours');
  });
});
