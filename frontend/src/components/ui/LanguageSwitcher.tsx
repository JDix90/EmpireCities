import React from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useLocalizationEnabled } from '../../store/featureFlagsStore';
import { LOCALE_NAMES, SUPPORTED_LOCALES, isLocaleCode } from '../../i18n/locales';
import { setLanguage } from '../../i18n';

/**
 * Language picker. Renders nothing while `localization_enabled` is off, which
 * is the dark-launch default: the bundles exist, but no player can reach them.
 *
 * A native <select> on purpose — it works with a keyboard, a screen reader and
 * a thumb, and needs no positioning logic inside a portal iframe. Each option
 * is the language's own name, so a player can find theirs without reading ours.
 */
export default function LanguageSwitcher({ className }: { className?: string }) {
  const enabled = useLocalizationEnabled();
  const { t, i18n } = useTranslation('common');
  if (!enabled) return null;
  const active = isLocaleCode(i18n.language) ? i18n.language : 'en';
  return (
    <label className={clsx('inline-flex items-center gap-1.5 text-xs text-bf-muted', className)}>
      <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span className="sr-only">{t('language')}</span>
      <select
        data-testid="language-switcher"
        aria-label={t('language')}
        value={active}
        onChange={(e) => {
          const next = e.target.value;
          if (isLocaleCode(next)) {
            // A failed bundle load keeps the current language; nothing to show.
            void setLanguage(next, { persist: true }).catch(() => {});
          }
        }}
        className="bg-transparent border border-bf-border rounded px-1.5 py-1 text-bf-muted hover:text-bf-gold hover:border-bf-gold/60 focus:outline-none focus:border-bf-gold cursor-pointer"
      >
        {SUPPORTED_LOCALES.map((code) => (
          <option key={code} value={code} className="bg-bf-surface text-bf-text">
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
