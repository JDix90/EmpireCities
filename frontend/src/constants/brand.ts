/** Borderfall — single source of truth for product name and marketing copy. */

export const APP_NAME = 'Borderfall';
export const APP_NAME_NAV = 'BORDERFALL';
export const APP_NAME_NAV_SHORT = 'BF';

export const TAGLINE_PRIMARY = 'Every border is temporary.';
export const TAGLINE_CINEMATIC = 'When borders break, ages fall.';

export const META_DESCRIPTION =
  'Borderfall — free turn-based strategy where one game spans the ancient world to a galactic age.';

export const STORE_DESCRIPTION =
  'Borderfall is a turn-based strategy game where you conquer territory across nine eras, from ancient legions to a galactic frontier. Free to play in your browser.';

/** Public support / privacy contact — override via VITE_SUPPORT_EMAIL at build time if needed. */
export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || 'support@borderfall.gg';

export const LEGAL_LAST_UPDATED = 'June 12, 2026';
