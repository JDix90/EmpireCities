/**
 * "By playing, you agree to our Terms of Service and Privacy Policy." under
 * the buttons that make a new player a guest: both documents are links, and
 * every language keeps both of them (a translation that drops a tag would
 * show the text without its link).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PlayTermsNotice from './PlayTermsNotice';
import { SUPPORTED_LOCALES } from '../../i18n/locales';

const COMMON = import.meta.glob<{ default: Record<string, string> }>('../../i18n/locales/*/common.json', { eager: true });

describe('PlayTermsNotice', () => {
  it('says playing is agreeing, and links both documents', () => {
    render(<MemoryRouter><PlayTermsNotice /></MemoryRouter>);
    expect(screen.getByTestId('play-terms-notice')).toHaveTextContent(
      'By playing, you agree to our Terms of Service and Privacy Policy.',
    );
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  it('keeps both links in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const text = COMMON[`../../i18n/locales/${locale}/common.json`]?.default.playTerms;
      expect(text, locale).toBeTruthy();
      expect(text!.match(/<terms>[^<]+<\/terms>/g), locale).toHaveLength(1);
      expect(text!.match(/<privacy>[^<]+<\/privacy>/g), locale).toHaveLength(1);
    }
  });
});
