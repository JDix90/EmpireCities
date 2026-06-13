import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap, BookOpen, Settings2, Swords, FlaskConical, Sparkles } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { useAuthStoreHydrated } from '../hooks/useAuthStoreHydrated';
import {
  TUTORIAL_MODULES,
  TUTORIAL_V2_ENABLED,
  getCompletedTutorialModules,
  getRecommendedTutorialModule,
  type TutorialLessonModule,
} from '../tutorial';

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hydrated = useAuthStoreHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const startedRef = useRef(false);
  const [starting, setStarting] = useState<TutorialLessonModule | null>(null);
  const [completed, setCompleted] = useState<TutorialLessonModule[]>([]);

  const moduleParam = searchParams.get('module') as TutorialLessonModule | null;
  const autoStart = searchParams.get('start') === '1';

  useEffect(() => {
    setCompleted(getCompletedTutorialModules());
  }, []);

  const startLesson = async (module: TutorialLessonModule) => {
    setStarting(module);
    try {
      // On page reload, `isAuthenticated` is restored from localStorage but
      // `accessToken` is memory-only (cleared on reload for security). App.tsx
      // runs a silent refresh to recover the token, but that takes ~200–500 ms.
      // If the user clicks "Start Lesson" before `bootstrapped` flips to true,
      // the API call goes out with no token → 401. Wait here so the auth state
      // is fully resolved before we make any authenticated requests.
      if (!useAuthStore.getState().bootstrapped) {
        await new Promise<void>((resolve) => {
          const unsub = useAuthStore.subscribe((state) => {
            if (state.bootstrapped) {
              unsub();
              resolve();
            }
          });
          // Re-check synchronously in case it flipped between getState() and subscribe()
          if (useAuthStore.getState().bootstrapped) {
            unsub();
            resolve();
          }
        });
      }

      if (!useAuthStore.getState().isAuthenticated) {
        await useAuthStore.getState().loginAsGuest();
      }
      const res = await api.post<{ game_id: string }>('/games/tutorial/start', {
        lesson_module: module,
      });
      navigate(`/game/${res.data.game_id}`, { replace: true });
    } catch {
      toast.error('Could not start the tutorial. Try again.');
      setStarting(null);
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

  if (autoStart && !moduleParam) {
    return (
      <div className="min-h-screen-safe bg-bf-dark flex flex-col">
        <nav className="border-b border-bf-border px-6 py-4">
          <BrandWordmark className="text-sm" />
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-bf-muted text-sm animate-pulse">Starting tutorial…</p>
        </div>
      </div>
    );
  }

  if (moduleParam && autoStart) {
    return (
      <div className="min-h-screen-safe bg-bf-dark flex flex-col">
        <nav className="border-b border-bf-border px-6 py-4">
          <BrandWordmark className="text-sm" />
        </nav>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-bf-muted text-sm animate-pulse">Starting lesson…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen-safe bg-bf-dark flex flex-col">
      <nav className="border-b border-bf-border px-6 py-4 flex justify-between items-center">
        <BrandWordmark className="text-sm" />
        <Link
          to={isAuthenticated ? '/lobby' : '/'}
          className="text-bf-muted text-sm hover:text-bf-gold"
        >
          {isAuthenticated ? 'Back to lobby' : 'Home'}
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 w-full">
        <div className="text-center space-y-2">
          <BookOpen className="w-10 h-10 text-bf-gold mx-auto" aria-hidden />
          <h1 className="font-display text-2xl text-bf-gold tracking-wider">Training Academy</h1>
          <p className="text-bf-muted text-sm">
            Start with the core tutorial, then try short deep dives on advanced settings, factions, and tech.
          </p>
        </div>

        {recommended && (
          <div className="card border-bf-gold/30 bg-bf-gold/5 p-4">
            <p className="text-xs uppercase tracking-widest text-bf-gold mb-1">Recommended next</p>
            <p className="text-bf-text text-sm mb-3">
              {TUTORIAL_MODULES.find((m) => m.id === recommended)?.title}
              {' — '}
              {TUTORIAL_MODULES.find((m) => m.id === recommended)?.description}
            </p>
            <button
              type="button"
              onClick={() => void startLesson(recommended)}
              disabled={starting !== null}
              className="btn-primary text-sm"
            >
              {starting === recommended ? 'Starting…' : 'Start lesson'}
            </button>
          </div>
        )}

        <div className="space-y-3">
          {TUTORIAL_MODULES.filter((m) => TUTORIAL_V2_ENABLED || m.id === 'core').map((mod) => {
            const Icon = MODULE_ICONS[mod.id];
            const done = completed.includes(mod.id);
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
                      <p className="font-display text-bf-gold">{mod.title}</p>
                      <span className="text-[10px] text-bf-muted shrink-0">
                        {done ? 'Done ✓' : `~${mod.estimatedMinutes} min`}
                      </span>
                    </div>
                    <p className="text-bf-muted text-xs mt-1">{mod.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={starting !== null}
                  onClick={() => void startLesson(mod.id)}
                  className="mt-3 btn-secondary text-xs disabled:opacity-60 w-full"
                >
                  {starting === mod.id ? 'Starting…' : done ? 'Replay Lesson' : 'Start Lesson'}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-bf-muted">
          <Link to="/how-to-play" className="text-bf-gold hover:underline">
            Full rules reference
          </Link>
          {' · '}
          <Link to="/codex" className="text-bf-gold hover:underline">
            Faction codex
          </Link>
        </p>
      </div>
    </div>
  );
}
