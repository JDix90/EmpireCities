/** Borderfall — single source of truth for product name and marketing copy. */

export const APP_NAME = 'Borderfall';
export const APP_NAME_NAV = 'BORDERFALL';
export const APP_NAME_NAV_SHORT = 'BF';

export const TAGLINE_PRIMARY = 'Every border is temporary.';
export const TAGLINE_CINEMATIC = 'When borders break, ages fall.';

export const STORE_DESCRIPTION =
  'Borderfall is a turn-based strategy game where you conquer territory across nine eras, from ancient legions to a galactic frontier. Free to play in your browser.';

/** Public support / privacy contact — override via VITE_SUPPORT_EMAIL at build time if needed. */
export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || 'support@borderfall.gg';

/**
 * The Terms of Service's date. The Privacy Policy keeps its own, so changing
 * one does not re-date the other. Last change: no tolerance for objectionable
 * content or abusive players, and how reports are handled.
 */
export const LEGAL_LAST_UPDATED = 'November 15, 2026';

/**
 * The Privacy Policy's date: chat reports and blocks, push tokens in the iOS
 * app, crash reports, and where a guest deletes their account.
 */
export const PRIVACY_LAST_UPDATED = 'November 15, 2026';
