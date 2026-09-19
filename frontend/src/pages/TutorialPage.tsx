import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, BookOpen, Settings2, Swords, FlaskConical, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import BrandWordmark from '../components/ui/BrandWordmark';
import LanguageSwitcher from '../components/ui/LanguageSwitcher';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { useAuthStore, waitForAuthBootstrap } from '../store/authStore';
import { REQUEST_TIMEOUT_MS } from '../config/env';
import { useAuthStoreHydrated } from '../hooks/useAuthStoreHydrated';
import { markWelcomeSeen } from '../components/ui/NewUserWelcomeModal';
import {
  TUTORIAL_MODULES,
  TUTORIAL_V2_ENABLED,
  getCompletedTutorialModules,
  getRecommendedTutorialModule,
  type TutorialLessonModule,
} from '../tutorial';
import { localizeTutorialModuleMeta } from '../tutorial/localize';

const MODULE_ICONS: Record<TutorialLessonModule, React.ElementType> = {
  core: GraduationCap,
  advanced_settings: Settings2,
  faction_ability: Swords,
  tech_tree: FlaskConical,
  era_advancement: Sparkles,
};

/**
 * /tutorial — pick a lesson or start the default core path.
 */
export default function TutorialPage() {
  const { t } = useTranslation('tutorial');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hydrated = useAuthStoreHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const startedRef = useRef(false);
  const [starting, setStarting] = useState<TutorialLessonModule | null>(null);
  /**
   * An auto-start (`?start=1`) that failed. Without this the two spinner
   * branches below key on `autoStart` alone, so a failed start left the
   * visitor on "Starting tutorial…" forever: the toast fades, the spinner
   * does not, and there is no link out of that screen. That screen is the
   * FIRST thing a landing guest sees, because `onboarding_tutorial_first`
   * routes them straight here.
   *
   * Setting it drops through to the lesson picker below, which was already a
   * complete recovery UI — retry buttons and a way back to the lobby — just
   * unreachable. `startedRef` still guards the effect, so nothing retries on
   * its own.
   */
  const [autoStartFailed, setAutoStartFailed] = useState(false);
  const [completed, setCompleted] = useState<TutorialLessonModule[]>([]);

  const moduleParam = searchParams.get('module') as TutorialLessonModule | null;
  const autoStart = searchParams.get('start') === '1';

  useEffect(() => {
    setCompleted(getCompletedTutorialModules());
  }, []);

  const startLesson = async (module: TutorialLessonModule) => {
    setStarting(module);
    try {
      // Clicking "Start Lesson" before the silent refresh lands would send the
      // API call out with no token → 401. A longer cap than the landing CTA's
      // on purpose: giving up early here COSTS something (a 401 on the next
      // request), whereas the landing CTA just falls back to the persisted
      // flags. Waiting exactly as long as the refresh request itself can take
      // means this only ever fires once that request has already given up.
      await waitForAuthBootstrap(REQUEST_TIMEOUT_MS);

      if (!useAuthStore.getState().isAuthenticated) {
        await useAuthStore.getState().loginAsGuest();
      }
      const res = await api.post<{ game_id: string }>('/games/tutorial/start', {
        lesson_module: module,
      });
      /**
       * First-visit triage is DONE the moment the tutorial starts — not only
       * when it is finished.
       *
       * The lobby shows its welcome modal ("Start Tutorial / Quick Match") to
       * any account with 0 XP that has neither completed the tutorial nor been
       * welcomed. `onboarding_tutorial_first_enabled` routes a landing guest
       * straight here (`/tutorial?start=1`), skipping the lobby, which is the
       * only other place the flag is set. So a player who started the tutorial
       * and pressed "Exit Tutorial" arrived in the lobby with 0 XP, nothing
       * marked complete and no welcome flag — and got asked whether they would
       * like to try the tutorial they had just walked out of.
       *
       * Marking it here closes that loop for every entry point: the landing
       * auto-start, and a lesson picked by hand off this page. Completion is
       * still tracked separately (`tutorialAlreadyDone` in LobbyPage); this
       * only says the player has been offered the choice once.
       */
      markWelcomeSeen();
      navigate(`/game/${res.data.game_id}`, { replace: true });
    } catch {
      toast.error(t('page.startError'));
      setStarting(null);
      setAutoStartFailed(true);
    }
  };

  useEffect(() => {
    if (!hydrated || !bootstrapped) return;
    if (!autoStart && !moduleParam) return;
    if (startedRef.current) return;
    startedRef.current = true;
    const mod = moduleParam && TUTORIAL_MODULES.some((m) => m.id === moduleParam)
      ? moduleParam
      : 'core';
    void startLesson(mod);
  }, [hydrated, bootstrapped, autoStart, moduleParam]);

  const recommended = getRecommendedTutorialModule();
  const recommendedMeta = recommended
    ? TUTORIAL_MODULES.find((m) => m.id === recommended)
    : undefined;
  const recommendedCopy = recommendedMeta ? localizeTutorialModuleMeta(recommendedMeta, t) : undefined;

  if (autoStart && !moduleParam && !autoStartFailed) {
    return (
      <div className="min-h-screen-safe bg-bf-dark flex flex-col">
        <nav className="border-b border-bf-border px-6 py-4">
          <BrandWordmark className="text-sm" />
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-bf-muted text-sm animate-pulse">{t('page.startingTutorial')}</p>
        </div>
      </div>
    );
  }

  if (moduleParam && autoStart && !autoStartFailed) {
    return (
      <div className="min-h-screen-safe bg-bf-dark flex flex-col">
        <nav className="border-b border-bf-border px-6 py-4">
          <BrandWordmark className="text-sm" />
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-bf-muted text-sm animate-pulse">{t('page.startingLesson')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen-safe bg-bf-dark flex flex-col">
      <nav className="border-b border-bf-border px-6 py-4 flex justify-between items-center">
        <BrandWordmark className="text-sm" />
        <div className="flex items-center gap-4">
          {/* Renders nothing until localization_enabled is on. */}
          <LanguageSwitcher />
          <Link
            to={isAuthenticated ? '/lobby' : '/'}
            className="text-bf-muted text-sm hover:text-bf-gold"
          >
            {isAuthenticated ? t('page.backToLobby') : t('page.home')}
          </Link>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 w-full">
        {autoStartFailed && (
          <div
            role="alert"
            data-testid="tutorial-autostart-failed"
            className="card border-red-500/30 bg-red-500/5 p-4 text-sm"
          >
            <p className="text-bf-text font-medium mb-1">{t('page.autoStartFailedTitle')}</p>
            <p className="text-bf-muted">
              {t('page.autoStartFailedBody')}{' '}
              <Link to={isAuthenticated ? '/lobby' : '/'} className="text-bf-gold hover:underline">
                {t('page.autoStartFailedSkip')}
              </Link>
              .
            </p>
          </div>
        )}
        <div className="text-center space-y-2">
          <BookOpen className="w-10 h-10 text-bf-gold mx-auto" aria-hidden />
          <h1 className="font-display text-2xl text-bf-gold tracking-wider">{t('page.title')}</h1>
          <p className="text-bf-muted text-sm">
            {t('page.intro')}
          </p>
        </div>

        {recommended && (
          <div className="card border-bf-gold/30 bg-bf-gold/5 p-4">
            <p className="text-xs uppercase tracking-widest text-bf-gold mb-1">{t('page.recommendedNext')}</p>
            <p className="text-bf-text text-sm mb-3">
              {recommendedCopy?.title}
              {' — '}
              {recommendedCopy?.description}
            </p>
            <button
              type="button"
              onClick={() => void startLesson(recommended)}
              disabled={starting !== null}
              className="btn-primary text-sm"
            >
              {starting === recommended ? t('common:starting') : t('page.startLessonRecommended')}
            </button>
          </div>
        )}

        <div className="space-y-3">
          {TUTORIAL_MODULES.filter((m) => TUTORIAL_V2_ENABLED || m.id === 'core').map((mod) => {
            const Icon = MODULE_ICONS[mod.id];
            const done = completed.includes(mod.id);
            const copy = localizeTutorialModuleMeta(mod, t);
            return (
              <div
                key={mod.id}
                data-testid={`module-card-${mod.id}`}
                className="card w-full text-left p-4 hover:border-bf-gold/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Icon className="w-5 h-5 text-bf-gold shrink-0 mt-0.5" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display text-bf-gold">{copy.title}</p>
                      <span className="text-[10px] text-bf-muted shrink-0">
                        {done ? t('page.done') : t('page.minutes', { minutes: mod.estimatedMinutes })}
                      </span>
                    </div>
                    <p className="text-bf-muted text-xs mt-1">{copy.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={starting !== null}
                  onClick={() => void startLesson(mod.id)}
                  className="mt-3 btn-secondary text-xs disabled:opacity-60 w-full"
                >
                  {starting === mod.id ? t('common:starting') : done ? t('page.replayLesson') : t('page.startLesson')}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-bf-muted">
          <Link to="/how-to-play" className="text-bf-gold hover:underline">
            {t('page.fullRules')}
          </Link>
          {' · '}
          <Link to="/codex" className="text-bf-gold hover:underline">
            {t('page.factionCodex')}
          </Link>
        </p>
      </div>
    </div>
  );
}
