import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopNavBar from './TopNavBar';
import MobileTabBar from './MobileTabBar';

vi.mock('../../hooks/useIsLandscape', () => ({ useIsLandscape: () => false }));

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

/**
 * Campaign is reachable by guests unconditionally — no flag. The account gate
 * lives on the start action inside CampaignPage, mirroring the server, where
 * `rejectGuest` sits only on POST /campaign/start and /continue while
 * /campaign/list and /campaign/paths take any authenticated caller.
 */
describe('Campaign nav entry', () => {
  describe('TopNavBar', () => {
    it('is shown to guests', () => {
      renderTop(true);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('is shown to registered players', () => {
      renderTop(false);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('is a real link, not a disabled control', () => {
      renderTop(true);
      // A disabled control would be unreachable by touch AND drop out of tab
      // order, hiding the very explanation it exists to give.
      const link = campaignLink()!;
      expect(link).not.toHaveAttribute('aria-disabled');
      expect(link.tabIndex).not.toBe(-1);
    });

    it('leaves the other guest-hidden entries hidden', () => {
      renderTop(true);
      expect(screen.queryByRole('link', { name: /Friends/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Map Editor/ })).toBeNull();
    });
  });

  describe('MobileTabBar', () => {
    it('is shown to guests', () => {
      renderMobile(true);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('is shown to registered players', () => {
      renderMobile(false);
      expect(campaignLink()).toHaveAttribute('href', '/campaign');
    });

    it('leaves the Friends tab hidden for guests', () => {
      renderMobile(true);
      expect(screen.queryByRole('link', { name: /Friends/ })).toBeNull();
    });
  });
});
