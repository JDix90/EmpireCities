import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let localizationEnabled = true;

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../utils/visitAnalytics', () => ({ trackVisitEvent: vi.fn() }));
vi.mock('../components/landing/GameplayShowcase', () => ({ default: () => null }));
vi.mock('../store/featureFlagsStore', () => ({
  useOnboardingTutorialFirstEnabled: () => false,
  useHeroSingleCtaEnabled: () => true,
  useLocalizationEnabled: () => localizationEnabled,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));

import LandingPage from './LandingPage';
import { applyLocalizationPolicy, setLanguage } from '../i18n';
import { clearLanguagePreference, readLanguagePreference } from '../i18n/languagePreference';

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('LandingPage in another language', () => {
  afterEach(async () => {
    localizationEnabled = true;
    await setLanguage('en');
    clearLanguagePreference();
  });

  it('renders the Spanish bundle and switches back through the picker, persisting the choice', async () => {
    await setLanguage('es');
    renderPage();
    expect(screen.getByTestId('hero-guest-cta')).toHaveTextContent('Juega gratis ahora');
    expect(screen.getByTestId('hero-tagline')).toHaveTextContent('Toda frontera es temporal.');
    expect(screen.getByRole('heading', { name: 'Elige tu era' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');

    const picker = screen.getByTestId('language-switcher') as HTMLSelectElement;
    expect(picker.value).toBe('es');
    fireEvent.change(picker, { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByTestId('hero-guest-cta')).toHaveTextContent('Play Free Now'));
    expect(readLanguagePreference()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('with the flag off: English, no picker, whatever the stored choice', async () => {
    localizationEnabled = false;
    await setLanguage('de', { persist: true });
    await applyLocalizationPolicy(false);
    renderPage();
    expect(screen.queryByTestId('language-switcher')).toBeNull();
    expect(screen.getByTestId('hero-guest-cta')).toHaveTextContent('Play Free Now');
  });
});
