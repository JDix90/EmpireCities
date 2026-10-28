/**
 * The privacy policy says what the game does with guest accounts and saved
 * ones. It once called a guest account "a temporary account", which stopped
 * being true when guests stayed signed in for 30 days and accounts could be
 * saved with just an email.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPage from './PrivacyPage';
import { PRIVACY_LAST_UPDATED } from '../constants/brand';

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

describe('PrivacyPage', () => {
  it('describes a guest account as it is now, not as temporary', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/temporary account/i);
    expect(text).toContain('playing as a guest creates an account with no email address or password');
    expect(text).toContain('up to 30 days after your last visit');
    expect(text).toContain('if you set one, a secure hash of your password');
    expect(text).toContain('one-time sign-in link');
  });

  it('says what in-game feedback stores, and that deleting the account deletes it', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    expect(text).toContain('if you send us feedback from inside a game, we store what you wrote and your rating');
    expect(text).toContain('your device type (phone, tablet or desktop) and your screen size');
    expect(text).toContain('Deleting your account deletes it.');
  });

  it('shows its own date, so changing it does not re-date the Terms of Service', () => {
    renderPage();
    expect(screen.getByText(`Last updated: ${PRIVACY_LAST_UPDATED}`)).toBeInTheDocument();
  });
});
