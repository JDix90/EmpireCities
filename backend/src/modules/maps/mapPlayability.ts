import { getMapRowById } from '../../db/postgres/mapsRepository';
import { validateMapDocument } from './mapValidation';

export type MapPlayability = { ok: true } | { ok: false; reason: string };

/**
 * Whether `userId` may start a game on `mapId`, or vote a waiting room onto it.
 *
 * Built-in boards — the tutorial, the era maps, the curated static set, any
 * system-authored row — are everyone's. A community map in the database is
 * everyone's once a moderator has approved it. Before that it is its author's
 * alone, as a test play, and only once it passes the publish checks: the
 * engine deals seats from the territory list and walks the connection graph,
 * so a two-territory draft or a split map is not a game, however private.
 *
 * resolveMap itself stays unaware of users: it also loads the map of a game
 * that already exists, where this question was settled at creation.
 */
export async function checkMapPlayable(mapId: string, userId: string): Promise<MapPlayability> {
  const row = await getMapRowById(mapId);
  // Not a database map: the tutorial and the static JSON boards resolve elsewhere.
  if (!row) return { ok: true };
  if (row.creator_id === 'system') return { ok: true };
  if (row.is_public && row.moderation_status === 'approved') return { ok: true };

  if (row.creator_id !== userId) {
    return { ok: false, reason: 'This map has not been published yet. Only its author can play it.' };
  }

  const errors = validateMapDocument({
    map_id: row.map_id,
    name: row.name,
    territories: row.territories,
    connections: row.connections,
    regions: row.regions,
  });
  if (errors.length > 0) {
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more — see the editor)` : '';
    return { ok: false, reason: `This draft is not playable yet: ${errors[0]}${more}` };
  }
  return { ok: true };
}
