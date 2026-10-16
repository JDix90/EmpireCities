import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sword } from 'lucide-react';
import GuestGate from './GuestGate';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

function renderGate(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('GuestGate', () => {
  it('always points at /upgrade so guest progress carries over', () => {
    renderGate(<GuestGate title="Daily Challenge" description="One puzzle a day." />);
    expect(screen.getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/upgrade');
  });

  it('renders the supplied copy rather than a raw permission error', () => {
    renderGate(
      <GuestGate
        title="Play today's challenge"
        description="The Daily Challenge is a free-account feature."
        icon={Sword}
      />,
    );
    expect(screen.getByText("Play today's challenge")).toBeInTheDocument();
    expect(screen.getByText('The Daily Challenge is a free-account feature.')).toBeInTheDocument();
    expect(screen.queryByText(/cannot access this resource/i)).not.toBeInTheDocument();
  });

  it('says "Save your account" with save_account_copy_enabled', () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, save_account_copy_enabled: true } }));
    try {
      renderGate(<GuestGate title="Friends" description="Add friends." />);
      expect(screen.getByRole('link', { name: 'Save your account' })).toHaveAttribute('href', '/upgrade');
    } finally {
      useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, save_account_copy_enabled: false } }));
    }
  });

  it('supports a custom CTA label', () => {
    renderGate(<GuestGate title="Friends" description="Add friends." ctaLabel="Create Account" />);
    expect(screen.getByRole('link', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('renders both variants with the same offer', () => {
    const { unmount } = renderGate(<GuestGate variant="card" title="Solo campaign" description="Six eras." />);
    expect(screen.getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/upgrade');
    unmount();
    renderGate(<GuestGate variant="page" title="Solo campaign" description="Six eras." />);
    expect(screen.getByRole('link', { name: 'Create free account' })).toHaveAttribute('href', '/upgrade');
  });
});
