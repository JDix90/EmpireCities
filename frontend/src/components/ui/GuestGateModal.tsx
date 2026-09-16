import { useEffect, useRef } from 'react';
import { Lock, Check } from 'lucide-react';
import type { GuestGateCopy } from '../../utils/guestGate';

interface GuestGateModalProps {
  /** Title / body / bullets — see utils/guestGate.ts. */
  copy: GuestGateCopy;
  /** Opt to create a full account (routes to /upgrade — upgrades in place). */
  onCreateAccount: () => void;
  /** Dismiss and stay where they were. */
  onDismiss: () => void;
}

/**
 * The account gate a guest meets at the point of action, rather than a disabled
 * control with a tooltip. A disabled control is unreachable three ways at once:
 * `title` tooltips never fire on touch, `disabled` drops the element out of tab
 * order so keyboard and screen-reader users cannot reach the explanation, and a
 * greyed-out button offers no route to fixing it. A real control that opens this
 * is identical on mouse, touch and keyboard, and lands on /upgrade.
 *
 * Structure and a11y mirror GuestSignupNudgeModal (focus to the primary CTA,
 * Escape to dismiss, scroll lock while open).
 */
export default function GuestGateModal({ copy, onCreateAccount, onDismiss }: GuestGateModalProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-gate-title"
    >
      <div className="bg-bf-surface border border-bf-gold/30 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-14 h-14 rounded-full bg-bf-gold/15 border-2 border-bf-gold/40 flex items-center justify-center mb-3">
            <Lock className="w-7 h-7 text-bf-gold" />
          </div>
          <p id="guest-gate-title" className="font-display text-2xl text-bf-gold mb-1">
            {copy.title}
          </p>
          <p className="text-bf-muted text-sm leading-relaxed">{copy.body}</p>
        </div>

        {copy.bullets.length > 0 && (
          <ul className="text-sm text-bf-muted space-y-2 mb-6 px-1">
            {copy.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2">
                <Check className="w-4 h-4 text-bf-gold/80 mt-0.5 shrink-0" aria-hidden />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3">
          {/* /upgrade converts the guest row IN PLACE, so progression earned as a
              guest survives. A "Sign In" option is deliberately absent: logging
              into another account would abandon exactly what this offers to keep. */}
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
            onClick={onDismiss}
            className="text-bf-muted hover:text-bf-text text-sm py-2 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
