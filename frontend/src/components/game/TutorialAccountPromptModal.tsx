import React, { useEffect } from 'react';
import { GraduationCap, Trophy } from 'lucide-react';

interface TutorialAccountPromptModalProps {
  /** Called when the user dismisses without creating an account. */
  onSkip: () => void;
  /** Called when the user opts to create a full account. */
  onCreateAccount: () => void;
  /** Called when the user opts to sign in to an existing account. */
  onSignIn: () => void;
  /** Optional descriptive line above the buttons. */
  outcomeLabel?: string;
}

/**
 * Shown to guest users at the end of the tutorial (wrap-up step, skip,
 * return-to-lobby, or game over). Encourages account creation without
 * blocking the user from continuing as a guest.
 */
export default function TutorialAccountPromptModal({
  onSkip,
  onCreateAccount,
  onSignIn,
  outcomeLabel,
}: TutorialAccountPromptModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onSkip]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-account-prompt-title"
    >
      <div className="bg-bf-surface border border-bf-gold/30 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-14 h-14 rounded-full bg-bf-gold/15 border-2 border-bf-gold/40 flex items-center justify-center mb-3">
            <GraduationCap className="w-7 h-7 text-bf-gold" />
          </div>
          <p
            id="tutorial-account-prompt-title"
            className="font-display text-2xl text-bf-gold mb-1"
          >
            Tutorial Complete!
          </p>
          <p className="text-bf-muted text-sm leading-relaxed">
            {outcomeLabel
              ?? 'You know the basics. Save your progress and unlock the full game by creating a free account.'}
          </p>
        </div>

        <ul className="text-sm text-bf-muted space-y-2 mb-6 px-1">
          <li className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" />
            <span>Save XP, gold, ratings, and unlocks across sessions.</span>
          </li>
          <li className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" />
            <span>Climb the leaderboards and chase daily challenges.</span>
          </li>
          <li className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" />
            <span>Add friends and play multiplayer matches.</span>
          </li>
        </ul>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onCreateAccount}
            className="btn-primary py-3 text-base"
          >
            Create Free Account
          </button>
          <button
            type="button"
            onClick={onSignIn}
            className="btn-secondary py-3 text-base"
          >
            Sign In Instead
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-bf-muted hover:text-bf-text text-sm py-2 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
