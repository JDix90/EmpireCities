import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GuestSignupNudgeModal from './GuestSignupNudgeModal';
import { GUEST_NO_PERSIST, GUEST_SAVED_HERE } from '../../utils/guestGate';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import TutorialAccountPromptModal from './TutorialAccountPromptModal';

function renderModal(isWinner: boolean, gold?: number) {
  const onCreateAccount = vi.fn();
  const onSkip = vi.fn();
  render(
    <GuestSignupNudgeModal
      isWinner={isWinner}
      gold={gold}
      onCreateAccount={onCreateAccount}
      onSkip={onSkip}
    />,
  );
  return { onCreateAccount, onSkip };
}

describe('GuestSignupNudgeModal', () => {
  it('shows victory copy when the guest won', () => {
    renderModal(true);
    expect(screen.getByText('Victory!')).toBeInTheDocument();
  });

  it('shows neutral copy on a loss/finish', () => {
    renderModal(false);
    expect(screen.getByText(GUEST_NO_PERSIST)).toBeInTheDocument();
  });

  it('names why an account matters instead of promising vague permanence', () => {
    renderModal(false);
    expect(screen.getByText(/no email or password/i)).toBeInTheDocument();
  });

  it('surfaces banked gold when there is some, and stays quiet when there is not', () => {
    const { unmount } = render(
      <GuestSignupNudgeModal isWinner={false} gold={340} onCreateAccount={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(screen.getByTestId('nudge-banked-gold')).toHaveTextContent('340 gold');
    unmount();
    renderModal(false, 0);
    expect(screen.queryByTestId('nudge-banked-gold')).toBeNull();
  });

  it('omits a "Sign In" option (would abandon the guest progress it promises to save)', () => {
    renderModal(false);
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it('wires the two CTAs to their callbacks', () => {
    const { onCreateAccount, onSkip } = renderModal(false);
    fireEvent.click(screen.getByText('Create Free Account'));
    fireEvent.click(screen.getByText('Maybe later'));
    expect(onCreateAccount).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('skips on Escape', () => {
    const { onSkip } = renderModal(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe('guest prompts v2 (guest_prompt_v2_enabled)', () => {
  const setV2 = (on: boolean) =>
    useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, guest_prompt_v2_enabled: on } }));
  afterEach(() => setV2(false));

  it('titles the nudge "Saved in this browser" instead of "do not persist"', () => {
    setV2(true);
    renderModal(false);
    expect(screen.getByText('Saved in this browser')).toBeTruthy();
    expect(screen.queryByText(GUEST_NO_PERSIST)).toBeNull();
  });

  it('tells a winner where the win is saved', () => {
    setV2(true);
    renderModal(true);
    expect(screen.getByText(new RegExp(GUEST_SAVED_HERE))).toBeTruthy();
  });

  it('the tutorial prompt promises every device, not "across sessions"', () => {
    const props = { onSkip: vi.fn(), onCreateAccount: vi.fn(), onSignIn: vi.fn() };
    setV2(true);
    const { unmount } = render(<TutorialAccountPromptModal {...props} />);
    expect(screen.getByText('Keep XP, gold, ratings and unlocks on every device.')).toBeTruthy();
    unmount();
    setV2(false);
    render(<TutorialAccountPromptModal {...props} />);
    expect(screen.getByText('Save XP, gold, ratings, and unlocks across sessions.')).toBeTruthy();
  });
});
