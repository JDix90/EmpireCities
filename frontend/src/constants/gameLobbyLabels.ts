/** Shared labels for lobby / pre-game UI (GamePage waiting room + LobbyPage). */

export const COMMUNITY_MAP_TITLES: Record<string, string> = {
  community_14_nations: 'The 14 Nations',
  community_strait_hormuz: 'Strait of Hormuz',
  community_flooded_north_america: 'Flooded North America',
  community_charlemagne_814: 'Europe — Death of Charlemagne, 814 A.D.',
  community_britain_925: 'Great Britain 925 A.D.',
  community_horn_africa: 'Horn of Africa & Yemen',
  community_australia_1337: 'Karkiyapani & Aotearoa 1337',
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
  galaxy_age: 'Galactic Age',
  custom: 'Community map',
};

/** Turn a machine scoring key (e.g. "score_desc_efficiency_desc_duration_asc")
 * into a player-readable tie-break order. */
export function formatWeeklyScoring(scoring: string): string {
  const LABELS: Record<string, string> = {
    score: 'highest score',
    efficiency: 'fewest losses',
    duration: 'fastest time',
  };
  const parts = scoring
    .split('_')
    .filter((token) => token in LABELS)
    .map((token) => LABELS[token]);
  if (parts.length === 0) return 'highest score';
  return parts.join(', then ');
}

/** Rules era + theater map labels for lobby / pre-game displays. */
export function formatLobbyPairingLabel(eraId: string, mapId: string): string {
  const rules = ERA_LABELS[eraId] ?? eraId;
  const theater = formatLobbyMapLabel(mapId, eraId);
  const bundled = mapId === `era_${eraId}` || mapId.replace(/^era_/, '') === eraId;
  if (bundled && COMMUNITY_MAP_TITLES[mapId] === undefined) {
    return rules;
  }
  return `${theater} · ${rules} rules`;
}

/** Map document name when era is custom; otherwise a short label from map_id. */
export function formatLobbyMapLabel(mapId: string, eraId: string): string {
  if (COMMUNITY_MAP_TITLES[mapId]) {
    return COMMUNITY_MAP_TITLES[mapId];
  }
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
