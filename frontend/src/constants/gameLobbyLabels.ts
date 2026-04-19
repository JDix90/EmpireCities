/** Shared labels for lobby / pre-game UI (GamePage waiting room + LobbyPage). */

export const COMMUNITY_MAP_TITLES: Record<string, string> = {
  community_14_nations: 'The 14 Nations',
  community_strait_hormuz: 'Strait of Hormuz',
};

export const ERA_LABELS: Record<string, string> = {
  ancient: 'Ancient World',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'Modern Day',
  acw: 'American Civil War',
  risorgimento: 'Italian Unification',
  space_age: 'Space Age',
  custom: 'Community map',
};

/** Map document name when era is custom; otherwise a short label from map_id. */
export function formatLobbyMapLabel(mapId: string, eraId: string): string {
  if (eraId === 'custom') {
    return COMMUNITY_MAP_TITLES[mapId] ?? mapId;
  }
  const slug = mapId.replace(/^era_/, '');
  if (slug.length <= 5 && !slug.includes('_')) {
    return slug.toUpperCase();
  }
  return slug
    .split('_')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
