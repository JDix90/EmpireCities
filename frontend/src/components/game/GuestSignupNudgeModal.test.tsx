import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GuestSignupNudgeModal from './GuestSignupNudgeModal';

function renderModal(isWinner: boolean) {
  const onCreateAccount = vi.fn();
  const onSkip = vi.fn();
  render(
    <GuestSignupNudgeModal
      isWinner={isWinner}
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
    expect(screen.getByText('Save your progress')).toBeInTheDocument();
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
