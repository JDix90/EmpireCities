import { useEffect, useRef } from 'react';
import { Crown, Trophy, Save } from 'lucide-react';
import { signupNudgeCopy } from '../../utils/signupNudge';

interface GuestSignupNudgeModalProps {
  /** Whether the guest just won — drives outcome-aware copy + icon. */
  isWinner: boolean;
  /** Opt to create a full account (routes to /upgrade — upgrades in place). */
  onCreateAccount: () => void;
  /** Dismiss without creating an account (continues to the lobby). */
  onSkip: () => void;
}

/**
 * One-time, flag-gated guest → create-account nudge shown right after a guest
 * finishes a non-tutorial game (the highest-intent moment — they've just earned
 * progression). Mirrors TutorialAccountPromptModal's structure/styling; gating +
 * once-per-session live in GamePage (see utils/signupNudge).
 */
export default function GuestSignupNudgeModal({
  isWinner,
  onCreateAccount,
  onSkip,
}: GuestSignupNudgeModalProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Move focus into the dialog (onto the primary CTA) for keyboard/SR users.
    primaryRef.current?.focus();
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

  const copy = signupNudgeCopy(isWinner);
  const Icon = isWinner ? Crown : Save;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-signup-nudge-title"
    >
      <div className="bg-bf-surface border border-bf-gold/30 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-14 h-14 rounded-full bg-bf-gold/15 border-2 border-bf-gold/40 flex items-center justify-center mb-3">
            <Icon className="w-7 h-7 text-bf-gold" />
          </div>
          <p id="guest-signup-nudge-title" className="font-display text-2xl text-bf-gold mb-1">
            {copy.title}
          </p>
          <p className="text-bf-muted text-sm leading-relaxed">{copy.body}</p>
        </div>

        <ul className="text-sm text-bf-muted space-y-2 mb-6 px-1">
          <li className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" />
            <span>Keep your XP, gold, ratings, and unlocks across sessions.</span>
          </li>
          <li className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" />
            <span>Climb the leaderboards and chase daily challenges.</span>
          </li>
          <li className="flex items-start gap-2">
            <Trophy className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" />
            <span>Get streak and turn reminders so you never lose progress. Free, no download.</span>
          </li>
        </ul>

        <div className="flex flex-col gap-3">
          {/* Single primary action: /upgrade converts the guest row IN PLACE so
              the just-earned progression carries over. We deliberately omit a
              "Sign In" option here — logging into a different account would
              abandon the very progress this nudge promises to save. */}
          <button
            ref={primaryRef}
            type="button"
            onClick={onCreateAccount}
            className="btn-primary py-3 text-base"
          >
            Create Free Account
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
