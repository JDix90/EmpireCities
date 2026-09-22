import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import { LANGUAGE_PREF_KEY } from '../i18n/languagePreference';
import { setLanguage } from '../i18n';

vi.mock('../services/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: {} }), put: vi.fn(), post: vi.fn() },
}));

vi.mock('../components/settings/NotificationPreferences', () => ({
  default: () => <div />,
}));

function setFlag(on: boolean) {
  const st = useFeatureFlagsStore.getState();
  useFeatureFlagsStore.setState({ ...st, flags: { ...st.flags, localization_enabled: on } });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('SettingsPage — language', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { user_id: 'u1', username: 'commander', is_guest: false } as never,
      isAuthenticated: true,
    } as never);
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    localStorage.removeItem(LANGUAGE_PREF_KEY);
  });

  afterEach(async () => {
    await setLanguage('en');
    localStorage.removeItem(LANGUAGE_PREF_KEY);
  });

  it('offers every shipped language once localization is on', () => {
    setFlag(true);
    renderPage();
    const select = screen.getByLabelText('Preferred language') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'English', 'Español', 'Português (Brasil)', 'Deutsch', 'Français',
    ]);
  });

  it('switches the language and remembers the choice', async () => {
    setFlag(true);
    renderPage();
    fireEvent.change(screen.getByLabelText('Preferred language'), { target: { value: 'fr' } });
    await waitFor(() => expect(localStorage.getItem(LANGUAGE_PREF_KEY)).toBe('fr'));
    await waitFor(() => expect((screen.getByLabelText('Preferred language') as HTMLSelectElement).value).toBe('fr'));
  });

  it('hides the whole section while localization is dark', () => {
    setFlag(false);
    renderPage();
    expect(screen.queryByLabelText('Preferred language')).toBeNull();
  });
});
