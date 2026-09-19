import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore, waitForAuthBootstrap } from '../store/authStore';
import { ownAuthUiAllowed } from '../utils/embedContext';
import { useOnboardingTutorialFirstEnabled, useHeroSingleCtaEnabled } from '../store/featureFlagsStore';
import { trackVisitEvent } from '../utils/visitAnalytics';
import { canAccessGalacticAge, GALACTIC_AGE_ERA_ID } from '../constants/galacticAgeAccess';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import LanguageSwitcher from '../components/ui/LanguageSwitcher';
import GameplayShowcase from '../components/landing/GameplayShowcase';
import { APP_NAME, SUPPORT_EMAIL } from '../constants/brand';
import { REGIONAL_MAPS } from '../data/regionalMaps';
import { LANDING_ERAS, type LandingEra, type LandingEraCopy } from '../data/landingEras';

/**
 * Every visible string on this page comes from the `landing` bundle
 * (src/i18n/locales/<lang>/landing.json); the English file is the source and
 * mirrors the brand constants (localeBundles.test.ts). With
 * `localization_enabled` off the page renders that English verbatim.
 */
type EraDefinition = LandingEra;

/** The subset of i18next's `t` the era helpers need. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Era card copy in the active language; community maps fall back to their own data. */
function eraCopy(t: Translate, era: EraDefinition): LandingEraCopy {
  const fb = era.fallback;
  return {
    label: t(`eras.${era.id}.label`, { defaultValue: fb?.label ?? era.id }),
    years: t(`eras.${era.id}.years`, { defaultValue: fb?.years ?? '' }),
    summary: t(`eras.${era.id}.summary`, { defaultValue: fb?.summary ?? '' }),
  };
}

const COMMUNITY_REGIONAL_ERAS: EraDefinition[] = REGIONAL_MAPS.map((rm) => ({
  id: rm.map_id,
  mapId: rm.map_id,
  color: rm.color,
  scope: 'regional',
  territoryCount: rm.territory_count,
  playersRange: '2–4',
  fallback: { label: rm.name, years: rm.year, summary: rm.description },
}));

/** Themed glyph per built-in era, keyed by id. Falls back to the map emoji. */
const ERA_ICONS: Record<string, string> = {
  ancient: '🏛️',
  medieval: '🏰',
  discovery: '⛵',
  ww2: '✈️',
  coldwar: '☢️',
  modern: '🌐',
  acw: '🎖️',
  risorgimento: '🇮🇹',
  space_age: '🚀',
  galaxy_age: '🌌',
};

/** Community maps are data-driven (no fixed ids) — vary their glyphs by position. */
const COMMUNITY_ICON_POOL = ['🧭', '🌊', '🏔️', '🏝️', '🗿', '🏯', '🐎', '⚓'];

const withIcon = (e: EraDefinition, fallback: string): EraDefinition => ({
  ...e,
  icon: ERA_ICONS[e.id] ?? fallback,
});

const GLOBAL_ERAS = LANDING_ERAS.filter((e) => e.scope === 'global').map((e) => withIcon(e, '🗺️'));
const REGIONAL_ERAS = [
  ...LANDING_ERAS.filter((e) => e.scope === 'regional').map((e) => withIcon(e, '🗺️')),
  ...COMMUNITY_REGIONAL_ERAS.map((e, i) => withIcon(e, COMMUNITY_ICON_POOL[i % COMMUNITY_ICON_POOL.length])),
];

function EraDetailModal({
  era,
  onClose,
  playHref,
  playLocked,
}: {
  era: EraDefinition;
  onClose: () => void;
  playHref: string;
  /** Non-admins cannot start Galactic Age yet (marketing “coming soon”). */
  playLocked: boolean;
}) {
  const { t } = useTranslation('landing');
  const copy = eraCopy(t, era);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto px-3 pt-safe-4 pb-safe-4 sm:px-4 sm:pt-safe-6 sm:pb-safe-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="era-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label={t('eras.closeDialog')}
      />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div
          className="relative w-full max-w-lg rounded-xl border border-bf-border bg-[#0f1419] shadow-2xl shadow-black/50 p-4 sm:p-6 md:p-8 max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain"
          style={{ boxShadow: `0 0 0 1px ${era.color}33, 0 25px 50px -12px rgba(0,0,0,0.5)` }}
        >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-bf-muted hover:text-bf-gold hover:bg-white/5 transition-colors"
          aria-label={t('eras.close')}
        >
          <X className="w-5 h-5" />
        </button>

        <div
          className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl"
          style={{ backgroundColor: era.color + '33', border: `2px solid ${era.color}` }}
        >
          {era.icon ?? '🗺️'}
        </div>

        <h4 id="era-modal-title" className="font-display text-2xl text-bf-gold text-center mb-1">
          {copy.label}
        </h4>
        <p className="text-center text-bf-muted text-sm mb-6">{copy.years}</p>

        <div className="space-y-4 text-bf-muted text-sm leading-relaxed">
          <p>{copy.summary}</p>
          <div className="flex flex-wrap gap-4 pt-2 border-t border-bf-border text-xs">
            <span>
              <span className="text-bf-gold/90 font-medium">{t('eras.suggestedPlayers')}</span>{' '}
              {t('eras.playersRange', { range: era.playersRange })}
            </span>
            <span>
              <span className="text-bf-gold/90 font-medium">{t('eras.territories')}</span>{' '}
              {era.territoryCount}
            </span>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary order-2 sm:order-1">
            {t('eras.close')}
          </button>
          {playLocked ? (
            <span className="btn-primary text-center order-1 sm:order-2 opacity-70 cursor-not-allowed select-none">
              {t('eras.comingSoon')}
            </span>
          ) : (
            <Link to={playHref} className="btn-primary text-center order-1 sm:order-2">
              {t('eras.playThisMap')}
            </Link>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function EraCardButton({ era, onOpen }: { era: EraDefinition; onOpen: (e: EraDefinition) => void }) {
  const { t } = useTranslation('landing');
  const copy = eraCopy(t, era);
  return (
    <button
      type="button"
      onClick={() => onOpen(era)}
      className="card text-center hover:border-bf-gold transition-colors cursor-pointer group w-full"
    >
      <div
        className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl"
        style={{ backgroundColor: era.color + '33', border: `2px solid ${era.color}` }}
      >
        {era.icon ?? '🗺️'}
      </div>
      <p className="font-display text-sm text-bf-gold group-hover:text-white transition-colors">{copy.label}</p>
      <p className="text-xs text-bf-muted mt-1">{copy.years}</p>
    </button>
  );
}

/** Compact modal shown when the user clicks "Play Free" / "Play Free Now". */
function GetStartedModal({
  onClose,
  onGuest,
  guestLoading,
}: {
  onClose: () => void;
  onGuest: () => void;
  guestLoading: boolean;
}) {
  const { t } = useTranslation('landing');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 pt-safe pb-safe"
      onClick={onClose}
    >
      <div
        className="bg-bf-surface border border-bf-border rounded-2xl p-6 sm:p-8 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="get-started-title"
      >
        <p id="get-started-title" className="font-display text-2xl text-bf-gold mb-1 text-center">{t('getStarted.title')}</p>
        <p className="text-bf-muted text-sm text-center mb-6">
          {t('getStarted.body')}
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={guestLoading}
            onClick={onGuest}
            className="btn-primary py-3 text-base disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {guestLoading ? t('common:starting') : t('actions.playAsGuest')}
          </button>
          {ownAuthUiAllowed() && <Link
            to="/register"
            className="btn-secondary py-3 text-base text-center"
            onClick={onClose}
          >
            {t('actions.createFreeAccount')}
          </Link>}
        </div>

        {ownAuthUiAllowed() && (
          <p className="text-center text-xs text-bf-muted mt-4">
            {t('getStarted.haveAccount')}{' '}
            <Link to="/login" className="text-bf-gold hover:underline" onClick={onClose}>
              {t('actions.signIn')}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { t } = useTranslation('landing');
  const [modalEra, setModalEra] = useState<EraDefinition | null>(null);
  const [showGetStarted, setShowGetStarted] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const navigate = useNavigate();
  const loginAsGuest = useAuthStore((s) => s.loginAsGuest);
  const user = useAuthStore((s) => s.user);
  const tutorialFirst = useOnboardingTutorialFirstEnabled();
  const singleCta = useHeroSingleCtaEnabled();

  // Pre-auth visitor funnel: landing_viewed once per tab, hero_play_clicked on
  // every Play CTA. `placement` tells the buttons apart; `variant` labels the
  // hero A/B (single dominant CTA vs control) so the funnel reads the test
  // directly. Logged-in users are not "visitors" — skip them.
  useEffect(() => {
    if (!user) trackVisitEvent('landing_viewed', undefined, { oncePerTab: true });
    // Intentionally mount-only (oncePerTab also dedupes remounts).
  }, []);
  const trackPlayClick = (placement: string) => {
    if (!user) trackVisitEvent('hero_play_clicked', { placement, variant: singleCta ? 'single' : 'control' });
  };

  const handleGuest = async () => {
    setGuestLoading(true);
    try {
      // Settle the silent refresh first: until it lands, the persisted auth
      // flags are only a guess at whether this player still has a session.
      await waitForAuthBootstrap();
      // NEVER mint a second account over a live session. Doing so abandons the
      // player's guest account, its XP and any game in progress — and in a
      // portal iframe that is the common path, not an edge case: reloading the
      // portal page resets the iframe to `/`, so a recovered session lands
      // right back on this CTA. Measured in the itch embed, click → reload →
      // click produced two guests (Guest_b8dc0234, then Guest_8ab38fb8) and
      // orphaned the first one's game.
      const isNewGuest = !useAuthStore.getState().isAuthenticated;
      if (isNewGuest) await loginAsGuest();
      if (tutorialFirst && isNewGuest) {
        // One-click onboarding: a BRAND-NEW landing guest goes straight to the
        // guided tutorial match — collapsing landing → lobby → welcome-modal →
        // tutorial into one click. `?start=1` auto-starts the core lesson and
        // routes into the game. A returning player has already been triaged,
        // so they get the lobby instead.
        navigate('/tutorial?start=1');
      } else {
        // Plain /lobby: the welcome modal owns first-visit triage (Start
        // Tutorial / Quick Match / lobby). The old ?quickstart=true param
        // auto-opened the dense Configure New Game form ON TOP of that modal,
        // making the config form every new guest's first screen.
        navigate('/lobby');
      }
    } catch {
      toast.error(t('errors.guestStart'));
      setGuestLoading(false);
    }
  };

  useEffect(() => {
    if (modalEra || showGetStarted) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [modalEra, showGetStarted]);

  const startingLabel = t('common:starting');

  return (
    <div className="min-h-screen bg-bf-dark">
      {/* Navigation */}
      <nav className="border-b border-bf-border px-safe-4 sm:px-safe-6 pb-3 sm:pb-4 flex items-center justify-between pt-safe-3 sm:pt-safe-4 gap-2">
        <BrandWordmark className="text-lg sm:text-2xl" />
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Single-CTA variant: the hero owns the Play action; the nav keeps
              only the Sign In utility so nothing competes with the primary. */}
          {!singleCta && (
            <>
              <Link to="/tutorial" className="btn-secondary text-sm hidden sm:inline-flex">
                {t('actions.learnToPlay')}
              </Link>
              <button
                type="button"
                className="btn-secondary text-sm sm:hidden"
                disabled={guestLoading}
                onClick={() => { trackPlayClick('nav_mobile_guest'); void handleGuest(); }}
              >
                {guestLoading ? startingLabel : t('actions.playAsGuest')}
              </button>
            </>
          )}
          {ownAuthUiAllowed() && <Link to="/login" className="btn-secondary text-sm">{t('actions.signIn')}</Link>}
          {!singleCta && (
            <button
              type="button"
              className="btn-primary text-sm hidden sm:inline-flex"
              onClick={() => { trackPlayClick('nav'); setShowGetStarted(true); }}
            >
              {t('actions.playFree')}
            </button>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center pt-16 sm:pt-24 pb-10 sm:pb-12 px-4 sm:px-6">
        <h2 className="font-display text-4xl sm:text-5xl md:text-7xl text-bf-gold mb-4 sm:mb-6 leading-tight">
          {APP_NAME}
        </h2>
        <p data-testid="hero-tagline" className="font-display text-lg sm:text-xl text-bf-gold/90 italic mb-4">
          {t('hero.tagline')}
        </p>
        <p className="text-bf-muted text-base sm:text-xl max-w-2xl mx-auto mb-8 sm:mb-10">
          {t('hero.description')} {t('hero.descriptionSuffix')}
        </p>
        {singleCta ? (
          /* One dominant action: click → guest session → straight into play
             (pairs with onboarding_tutorial_first for landing → tutorial).
             Friction-removers under the button; one low-emphasis secondary. */
          <div className="flex flex-col gap-3 justify-center items-center max-w-sm mx-auto">
            <button
              type="button"
              data-testid="hero-guest-cta"
              className="btn-primary text-lg sm:text-xl px-12 sm:px-14 py-4 w-full sm:w-auto disabled:opacity-60"
              disabled={guestLoading}
              onClick={() => { trackPlayClick('hero'); void handleGuest(); }}
            >
              {guestLoading ? startingLabel : t('actions.playFreeNow')}
            </button>
            <p className="text-bf-muted text-sm">{t('hero.friction')}</p>
            <button
              type="button"
              className="text-bf-gold/80 hover:text-bf-gold text-sm underline underline-offset-4"
              onClick={() => document.getElementById('gameplay')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('actions.seeGameplay')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-stretch sm:items-center sm:flex-wrap max-w-sm sm:max-w-none mx-auto">
            <button
              type="button"
              className="btn-primary text-base sm:text-lg px-8 sm:px-10 py-3"
              onClick={() => { trackPlayClick('hero'); setShowGetStarted(true); }}
            >
              {t('actions.playFreeNow')}
            </button>
            <Link to="/tutorial" className="btn-secondary text-base sm:text-lg px-8 sm:px-10 py-3 text-center">
              {t('actions.learnToPlay')}
            </Link>
            {ownAuthUiAllowed() && <Link to="/login" className="btn-secondary text-base sm:text-lg px-8 sm:px-10 py-3 text-center hidden sm:inline-flex justify-center">{t('actions.signIn')}</Link>}
          </div>
        )}
      </section>

      {/* Gameplay showcase — show the game instead of pitching it (replaces the old "Why Borderfall?" grid) */}
      <section id="gameplay" className="py-12 sm:py-16 px-6 max-w-6xl mx-auto">
        <GameplayShowcase />
        <p className="mt-4 text-center text-sm text-bf-muted">
          {t('showcase.caption')}
        </p>
      </section>

      {/* Era Showcase */}
      <section className="pt-8 pb-16 px-6 max-w-6xl mx-auto">
        <h3 className="font-display text-3xl text-center text-bf-gold mb-10">{t('eras.heading')}</h3>

        <div className="mb-12">
          <h4 className="font-display text-lg text-bf-gold/95 mb-4 tracking-wide">{t('eras.globalHeading')}</h4>
          <p className="text-bf-muted text-sm mb-6 max-w-2xl">
            {t('eras.globalDescription')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {GLOBAL_ERAS.map((era) => (
              <EraCardButton key={era.id} era={era} onOpen={setModalEra} />
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-display text-lg text-bf-gold/95 mb-4 tracking-wide">{t('eras.regionalHeading')}</h4>
          <p className="text-bf-muted text-sm mb-6 max-w-2xl">
            {t('eras.regionalDescription')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {REGIONAL_ERAS.map((era) => (
              <EraCardButton key={era.id} era={era} onOpen={setModalEra} />
            ))}
          </div>
        </div>
      </section>

      {modalEra && (
        <EraDetailModal
          era={modalEra}
          onClose={() => setModalEra(null)}
          playHref={`/lobby?map=${encodeURIComponent(modalEra.mapId)}`}
          playLocked={
            modalEra.id === GALACTIC_AGE_ERA_ID && !canAccessGalacticAge(user)
          }
        />
      )}

      {showGetStarted && (
        <GetStartedModal
          onClose={() => setShowGetStarted(false)}
          onGuest={() => { trackPlayClick('modal_guest'); void handleGuest(); }}
          guestLoading={guestLoading}
        />
      )}

      {/* CTA */}
      <section className="py-20 text-center px-6">
        <h3 className="font-display text-4xl text-bf-gold mb-4">{t('cta.heading')}</h3>
        <p className="text-bf-muted italic mb-4">{t('cta.tagline')}</p>
        <p className="text-bf-muted mb-8">{t('cta.noDownload')}</p>
        <button
          type="button"
          className="btn-primary text-lg px-12 py-3"
          onClick={() => { trackPlayClick('bottom'); setShowGetStarted(true); }}
        >
          {t('actions.playFreeNow')}
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-bf-border pt-8 pb-safe-8 text-center text-bf-muted text-sm space-y-2">
        <p>{t('footer.copyright', { appName: APP_NAME })}</p>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Link to="/about" className="text-bf-gold/80 hover:text-bf-gold">{t('footer.about')}</Link>
          <Link to="/privacy" className="text-bf-gold/80 hover:text-bf-gold">{t('footer.privacy')}</Link>
          <Link to="/terms" className="text-bf-gold/80 hover:text-bf-gold">{t('footer.terms')}</Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold/80 hover:text-bf-gold">{t('footer.contact')}</a>
          <a
            href="https://www.reddit.com/r/borderfall"
            target="_blank"
            rel="noopener noreferrer"
            className="text-bf-gold/80 hover:text-bf-gold"
          >
            Reddit
          </a>
        </div>
        {/* Renders nothing until localization_enabled is on. */}
        <LanguageSwitcher className="justify-center pt-2" />
      </footer>
    </div>
  );
}
