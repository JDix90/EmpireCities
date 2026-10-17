import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

const MAX_WIDTH_CLASS = {
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
} as const;

export type SubpageMaxWidth = keyof typeof MAX_WIDTH_CLASS;

export interface SubpageShellProps {
  title: string;
  icon?: LucideIcon;
  /** Replaces the default Lobby back link (e.g. BrandWordmark). */
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  maxWidth?: SubpageMaxWidth;
  /**
   * Element for the header title. Defaults to `h1`, which is right for the
   * fourteen pages whose only heading IS this banner.
   *
   * Pass `'div'` on a page that renders its own `<h1>` in the body. The banner
   * is page chrome — a short label like "ANSWERS" — while the body heading is
   * the actual subject ("Is there a free Risk-style game…"). Two `h1`s on one
   * page is a real SEO error (Bing's URL Inspection flags it), and of the two
   * the body heading is the one that should win.
   */
  titleAs?: 'h1' | 'div';
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Shared layout for lobby sub-pages (Store, Leaderboards, Daily, Campaign, …).
 *
 * On a phone (below `sm`) the header gives the title the room: the back link is
 * its chevron alone (the label stays for screen readers, and a touch screen
 * gets a 44px touch area round it without the header growing), the title's
 * icon steps aside, and a long title wraps onto a second line. At 390px
 * "LEADERBOARDS", "DAILY CHALLENGE" and "TERMS OF SERVICE" used to be cut to an
 * ellipsis, and at 320px nearly every title was.
 */
export default function SubpageShell({
  title,
  icon: Icon,
  headerLeft,
  headerRight,
  backHref = '/lobby',
  backLabel = 'Lobby',
  maxWidth = '3xl',
  titleAs: TitleTag = 'h1',
  children,
  className,
  contentClassName,
}: SubpageShellProps) {
  return (
    <div className={clsx('min-h-screen bg-bf-dark text-bf-text', className)}>
      <nav className="border-b border-bf-border px-safe-4 sm:px-safe-6 pb-4 flex items-center justify-between pt-safe-4 gap-2 sm:gap-3">
        <div className="shrink-0 min-w-[2.75rem] sm:min-w-[5.5rem]">
          {headerLeft ?? (
            <Link
              to={backHref}
              className="tap-target flex items-center gap-1.5 text-bf-muted hover:text-bf-text text-sm transition-colors"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{backLabel}</span>
            </Link>
          )}
        </div>
        <TitleTag className="font-display text-lg sm:text-xl text-bf-gold tracking-wider sm:tracking-widest flex items-center justify-center gap-2 text-center min-w-0">
          {Icon && <Icon className="hidden sm:block w-5 h-5 shrink-0" aria-hidden />}
          <span className="max-sm:leading-tight break-words sm:truncate">{title}</span>
        </TitleTag>
        <div className="sm:w-24 flex justify-end shrink-0 min-w-[2.75rem] sm:min-w-[4.5rem]">
          {headerRight}
        </div>
      </nav>
      <div
        className={clsx(
          MAX_WIDTH_CLASS[maxWidth],
          'mx-auto px-4 sm:px-6 py-6 sm:py-8',
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
