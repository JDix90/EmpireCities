import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopNavBar from './TopNavBar';
import MobileTabBar from './MobileTabBar';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

vi.mock('../../hooks/useIsLandscape', () => ({ useIsLandscape: () => false }));

function setUpsell(on: boolean) {
  const s = useFeatureFlagsStore.getState();
  useFeatureFlagsStore.setState({
    ...s,
    flags: { ...s.flags, guest_account_upsell_enabled: on },
  });
}

function renderTop(isGuest: boolean) {
  render(
    <MemoryRouter>
      <TopNavBar user={{ username: 'commander', is_guest: isGuest }} onLogout={vi.fn()} />
    </MemoryRouter>,
  );
}

function renderMobile(isGuest: boolean) {
  render(
    <MemoryRouter>
      <MobileTabBar isGuest={isGuest} onCreateGame={vi.fn()} onLogout={vi.fn()} />
    </MemoryRouter>,
  );
}

const campaignLink = () => screen.queryByRole('link', { name: /Campaign/ });

describe('Campaign nav entry for guests', () => {
  beforeEach(() => setUpsell(false));

  describe('TopNavBar', () => {
    it('stays hidden from guests while the flag is off', () => {
      renderTop(true);
      expect(campaignLink()).toBeNull();
    });

    it('appears for guests once the flag is on', () => {
      setUpsell(true);
      renderTop(true);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('is a real link, not a disabled control', () => {
      setUpsell(true);
      renderTop(true);
      // The gate lives on the start action inside the page. A disabled control
      // would be unreachable by touch AND drop out of tab order, hiding the
      // very explanation it exists to give.
      const link = campaignLink()!;
      expect(link).not.toHaveAttribute('aria-disabled');
      expect(link.tabIndex).not.toBe(-1);
    });

    it('is unaffected for registered players either way', () => {
      renderTop(false);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('does not lift any other guest-hidden entry', () => {
      setUpsell(true);
      renderTop(true);
      expect(screen.queryByRole('link', { name: /Friends/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Map Editor/ })).toBeNull();
    });
  });

  describe('MobileTabBar', () => {
    it('stays hidden from guests while the flag is off', () => {
      renderMobile(true);
      expect(campaignLink()).toBeNull();
    });

    it('appears for guests once the flag is on', () => {
      setUpsell(true);
      renderMobile(true);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('does not lift the Friends tab', () => {
      setUpsell(true);
      renderMobile(true);
      expect(screen.queryByRole('link', { name: /Friends/ })).toBeNull();
    });

    it('is unaffected for registered players', () => {
      renderMobile(false);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });
  });
});
