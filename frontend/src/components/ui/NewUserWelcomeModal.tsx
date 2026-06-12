import React from 'react';
import { X, GraduationCap, Zap, BookOpen } from 'lucide-react';
import { APP_NAME } from '../../constants/brand';

const WELCOME_SEEN_KEY = 'bf-lobby-welcomed';

export function hasSeenWelcome(): boolean {
  try {
    return !!localStorage.getItem(WELCOME_SEEN_KEY);
  } catch {
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface NewUserWelcomeModalProps {
  onStartTutorial: () => void;
  onJumpIn: () => void;
  onDismiss: () => void;
}

/**
 * One-time first-visit orientation modal for users with no XP.
 * Presents two clear paths and dismisses on any selection.
 */
export default function NewUserWelcomeModal({
  onStartTutorial,
  onJumpIn,
  onDismiss,
}: NewUserWelcomeModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      onClick={onDismiss}
    >
      <div
        className="relative bg-bf-surface border border-bf-gold/25 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dismiss X */}
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-3 right-3 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-bf-muted hover:text-bf-gold hover:bg-white/5 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-bf-gold/10 border border-bf-gold/30 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-6 h-6 text-bf-gold" aria-hidden />
          </div>
          <h2 className="font-display text-2xl text-bf-gold mb-2">Welcome, Commander</h2>
          <p className="text-bf-muted text-sm leading-relaxed">
            {APP_NAME} is a turn-based strategy game of territory conquest — think Risk, but across history.
            New here? We recommend starting with the interactive tutorial.
          </p>
        </div>

        {/* Primary action — Tutorial */}
        <button
          type="button"
          onClick={onStartTutorial}
          className="w-full flex items-start gap-4 p-4 rounded-xl bg-bf-gold/10 border border-bf-gold/40 hover:bg-bf-gold/15 hover:border-bf-gold/60 transition-all text-left mb-3 group"
        >
          <div className="w-10 h-10 rounded-lg bg-bf-gold/15 border border-bf-gold/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <GraduationCap className="w-5 h-5 text-bf-gold" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="font-display text-bf-gold text-base">Start Tutorial</p>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-bf-gold/80 bg-bf-gold/15 border border-bf-gold/25 px-1.5 py-0.5 rounded">
                Recommended
              </span>
            </div>
            <p className="text-bf-muted text-xs leading-relaxed">
              ~6 minutes. Interactive match against a practice AI — learn draft, attack, fortify, and cards at your own pace.
            </p>
          </div>
        </button>

        {/* Secondary action — Jump in */}
        <button
          type="button"
          onClick={onJumpIn}
          className="w-full flex items-start gap-4 p-4 rounded-xl bg-bf-dark border border-bf-border hover:border-bf-gold/40 transition-all text-left mb-5 group"
        >
          <div className="w-10 h-10 rounded-lg bg-bf-dark border border-bf-border flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Zap className="w-5 h-5 text-bf-gold" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-display text-bf-gold text-base mb-0.5">Quick Match</p>
            <p className="text-bf-muted text-xs leading-relaxed">
              3 AI opponents on a random era map — start now, no waiting. Best if you already know Risk.
            </p>
          </div>
        </button>

        {/* Tertiary dismiss */}
        <p className="text-center text-xs text-bf-muted">
          Already know how to play?{' '}
          <button
            type="button"
            onClick={onDismiss}
            className="text-bf-gold hover:underline"
          >
            Go straight to the lobby
          </button>
        </p>
      </div>
    </div>
  );
}
