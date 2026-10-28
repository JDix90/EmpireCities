/**
 * The landing's regional map cards show each community map's own glyph
 * (data/regionalMaps.ts `icon`, the one the Map Hub shows). They used to take
 * one from a short pool by position, so Africa wore an Easter Island head.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { REGIONAL_MAPS } from '../data/regionalMaps';

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));
vi.mock('../components/landing/GameplayShowcase', () => ({ default: () => null }));
vi.mock('../store/featureFlagsStore', () => ({
  useOnboardingTutorialFirstEnabled: () => false,
  useHeroSingleCtaEnabled: () => true,
  useLocalizationEnabled: () => false,
  useGalaxyAgeBetaEnabled: () => false,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));

import LandingPage from './LandingPage';

describe('the landing\'s regional map cards', () => {
  it('show each community map\'s own glyph', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    for (const rm of REGIONAL_MAPS) {
      const card = screen.getByText(rm.name).closest('button');
      expect(card, rm.name).not.toBeNull();
      expect(card!.textContent, rm.name).toContain(rm.icon);
    }
    expect(screen.getByText('Uncolonized Africa').closest('button')!.textContent).not.toContain('🗿');
  });
});
