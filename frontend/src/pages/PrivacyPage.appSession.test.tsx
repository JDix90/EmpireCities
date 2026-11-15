/**
 * The privacy page says how the iPhone and iPad app keeps a player signed in:
 * a token in the device keychain, not the website's cookie.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPage from './PrivacyPage';

describe('PrivacyPage: the app session', () => {
  it('says the app keeps a keychain token, where it stays, and what removes it', () => {
    const { container } = render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    );
    const text = screen.getByTestId('privacy-app-session').textContent ?? '';
    expect(text).toContain('uses no cookie');
    expect(text).toContain("a sign-in token in the device's keychain");
    expect(text).toContain('not synced to iCloud');
    expect(text).toContain('deleting and reinstalling the app on the same device signs you back in');
    expect(text).toContain('Signing out, or deleting your account, removes the token.');
    // The website's own sentence is still there, and no longer speaks for the app.
    expect(container.textContent).toContain('We use an HTTP-only cookie to keep you signed in');
    expect(container.textContent).not.toContain('Mobile apps using the same backend follow the same model');
  });
});
