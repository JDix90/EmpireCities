/**
 * Per-era presentation metadata shared by the era timeline strip and the
 * advancement ceremony. Colors are tuned for contrast on the dark game UI
 * (brightened from the marketing palette where needed); `flavor` is the
 * one-line tagline shown when a civilization ascends into that era.
 */
export interface EraMeta {
  id: string;
  /** Compact label for the timeline node (fits a narrow column). */
  short: string;
  /** Theme color (CSS hex) for the node, marker ring, and ceremony tint. */
  color: string;
  /** One-line ceremony tagline for arriving in this era. */
  flavor: string;
}

export const ERA_META: Record<string, EraMeta> = {
  ancient:      { id: 'ancient',      short: 'Ancient',    color: '#c9a84c', flavor: 'Bronze gives way to iron and empire.' },
  medieval:     { id: 'medieval',     short: 'Medieval',   color: '#b8860b', flavor: 'Castles rise and knights take the field.' },
  discovery:    { id: 'discovery',    short: 'Discovery',  color: '#2e9ec0', flavor: 'The map grows edges no one has charted.' },
  ww2:          { id: 'ww2',          short: 'WWII',       color: '#8a8a8a', flavor: 'Industry and armor reshape the world.' },
  coldwar:      { id: 'coldwar',      short: 'Cold War',   color: '#3a6ea5', flavor: 'Nobody fires first. Everybody arms for it.' },
  modern:       { id: 'modern',       short: 'Modern',     color: '#2ecc71', flavor: 'The war is fought on screens before the field.' },
  acw:          { id: 'acw',          short: 'Civil War',  color: '#a3825a', flavor: 'A nation divided against itself.' },
  risorgimento: { id: 'risorgimento', short: 'Unification',color: '#1fa055', flavor: 'Many states forged into one.' },
  space_age:    { id: 'space_age',    short: 'Space Age',  color: '#8e9af2', flavor: 'Earth was never going to be enough.' },
  galaxy_age:   { id: 'galaxy_age',   short: 'Galaxy Age', color: '#9fa8da', flavor: 'Borders are measured in light-years now.' },
};

const FALLBACK_META: EraMeta = { id: '', short: 'New Era', color: '#c9a84c', flavor: 'The map is redrawn again.' };

export function eraMeta(id?: string): EraMeta {
  return ERA_META[id ?? ''] ?? FALLBACK_META;
}
