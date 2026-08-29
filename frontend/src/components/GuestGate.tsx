import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface GuestGateProps {
  /** What the guest can't do yet, e.g. "Daily Challenge". */
  title: string;
  /** Why an account is needed — say what they gain, not what's blocked. */
  description: string;
  /**
   * `card` sits inline where the feature's own control would be; `page` replaces
   * a whole route body (wrap it in the caller's shell).
   */
  variant?: 'card' | 'page';
  icon?: LucideIcon;
  ctaLabel?: string;
  className?: string;
}

/**
 * The one place a guest is told an account is required.
 *
 * Guests are real `users` rows, so most guest-only limits are enforced
 * server-side by `rejectGuest` — which returns a developer-facing 403. Rendering
 * this instead of the control means a guest never fires that request and never
 * sees the raw error; they get the offer that converts them, and their progress
 * carries over on upgrade (same `user_id`).
 */
export default function GuestGate({
  title,
  description,
  variant = 'card',
  icon: Icon,
  ctaLabel = 'Create free account',
  className = '',
}: GuestGateProps) {
  if (variant === 'page') {
    return (
      <div className={`text-center py-12 space-y-4 ${className}`}>
        {Icon && <Icon className="w-8 h-8 text-bf-gold mx-auto" aria-hidden />}
        <h2 className="font-display text-lg text-bf-gold">{title}</h2>
        <p className="text-bf-muted max-w-md mx-auto">{description}</p>
        <Link to="/upgrade" className="btn-primary inline-flex items-center justify-center min-h-[44px] px-5">
          {ctaLabel}
        </Link>
      </div>
    );
  }

  return (
    <div className={`card border border-bf-border/80 bg-bf-surface/40 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && <Icon className="w-6 h-6 text-bf-gold shrink-0 mt-0.5" aria-hidden />}
          <div>
            <h3 className="font-display text-lg text-bf-gold">{title}</h3>
            <p className="text-bf-muted text-sm mt-1">{description}</p>
          </div>
        </div>
        <Link
          to="/upgrade"
          className="btn-secondary self-start sm:self-center shrink-0 min-h-[44px] inline-flex items-center justify-center px-4 touch-manipulation"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
