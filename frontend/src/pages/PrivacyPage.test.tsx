/**
 * The privacy policy says what the game does with guest accounts and saved
 * ones, and with chat reports, blocks, push tokens and crash reports. It once
 * called a guest account "a temporary account", which stopped being true when
 * guests stayed signed in for 30 days and accounts could be saved with just an
 * email.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPage from './PrivacyPage';
import { PRIVACY_LAST_UPDATED } from '../constants/brand';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

function setFlags(flags: { chat_safety_enabled?: boolean; guest_account_deletion_enabled?: boolean }) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, ...flags } }));
}

// Before each test, not after: the page is still mounted when an afterEach runs.
beforeEach(() => {
  setFlags({ chat_safety_enabled: false, guest_account_deletion_enabled: false });
});

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
    expect(text).toContain('if you send us feedback, from the menu or from inside a game, we store what you wrote, and any rating or category you picked');
    expect(text).toContain('the page or the game and turn you sent it from');
    expect(text).toContain('your device type (phone, tablet or desktop) and your screen size');
    expect(text).toContain('Deleting your account deletes it.');
  });

  it('shows its own date, so changing it does not re-date the Terms of Service', () => {
    renderPage();
    expect(screen.getByText(`Last updated: ${PRIVACY_LAST_UPDATED}`)).toBeInTheDocument();
  });

  // The policy describes what the server does, and two of those things are
  // behind flags. It must not promise a report tool or a delete form that the
  // player cannot find, nor go on calling chat unstored once reports keep it.
  describe('chat reports and blocks (chat_safety_enabled)', () => {
    it('off: chat is not stored and there is nothing to say about reports', () => {
      const { container } = renderPage();
      const text = container.textContent ?? '';
      expect(text).toContain('chat messages are delivered to players in your game and are not stored on our servers');
      expect(screen.queryByTestId('privacy-chat-reports')).toBeNull();
      expect(screen.queryByTestId('privacy-blocks')).toBeNull();
    });

    it('on: says what is held, what a report keeps and what a block stores', () => {
      setFlags({ chat_safety_enabled: true });
      const { container } = renderPage();
      const text = container.textContent ?? '';
      expect(text).not.toContain('are not stored on our servers');
      expect(text).toContain('hold the most recent messages of each game for up to six hours');
      const report = screen.getByTestId('privacy-chat-reports').textContent ?? '';
      expect(report).toContain('the reported message');
      expect(report).toContain('your account as the reporter');
      expect(report).toContain('the reason you chose');
      expect(report).toContain('stays without the link to that account');
      const blocks = screen.getByTestId('privacy-blocks').textContent ?? '';
      expect(blocks).toContain('we store that you blocked them');
      expect(blocks).toContain('Settings → Blocked players');
      expect(blocks).toContain('deleted when either account is deleted');
    });
  });

  describe('where to delete an account (guest_account_deletion_enabled)', () => {
    it('off: keeps the profile-page wording and does not send a guest to a form that is not there', () => {
      renderPage();
      const text = screen.getByTestId('privacy-delete-account').textContent ?? '';
      expect(text).toContain('Guest accounts have no self-service deletion');
      expect(text).not.toContain('Settings → Account → Delete account');
    });

    it('on: names Settings → Account → Delete account, guests included', () => {
      setFlags({ guest_account_deletion_enabled: true });
      renderPage();
      const text = screen.getByTestId('privacy-delete-account').textContent ?? '';
      expect(text).toContain('Settings → Account → Delete account');
      expect(text).toContain('This works for guest accounts as well as saved ones');
      expect(text).not.toContain('no self-service deletion');
    });
  });

  it('says what a push token is, on iOS too, and when it is deleted', () => {
    renderPage();
    const text = screen.getByTestId('privacy-push').textContent ?? '';
    expect(text).toContain('only if you allow them');
    expect(text).toContain('in the iPhone and iPad app, one that Apple issues for the app on your device');
    expect(text).toContain('The token is deleted when you delete your account');
  });

  it('says what a crash report holds and who receives it', () => {
    const { container } = renderPage();
    const text = screen.getByTestId('privacy-crash-reports').textContent ?? '';
    expect(text).toContain('Sentry, our error-monitoring provider');
    expect(text).toContain('the error and where in the code it happened');
    expect(text).toContain('IP address');
    expect(container.textContent).toContain('crash and error reports go to Sentry');
  });
});
