/**
 * How a map's author is named on the hub, the map of the week, and a map's
 * own page, so the three agree. Seeded community maps carry short creator ids
 * ("jmd", "system") rather than an account, and have no username to show.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A creator id that is an account, so a profile exists to link to. */
export function isAccountId(creatorId: string): boolean {
  return UUID_RE.test(creatorId);
}

/**
 * The username when the server sent one; otherwise the seeded id made
 * presentable ("jmd" → "JMD"), the game's own name for its built-in maps,
 * and a neutral phrase for an account whose name did not come through.
 */
export function formatMapAuthor(creatorId: string, creatorName?: string | null): string {
  if (creatorName) return creatorName;
  if (creatorId === 'system') return 'Borderfall';
  if (isAccountId(creatorId)) return 'a community author';
  if (creatorId === 'jmd') return 'JMD';
  if (creatorId.length <= 3) return creatorId.toUpperCase();
  return creatorId;
}
