import { validateMapConnections } from '../../game-engine/validation/mapConnections';
import { validateMapGeometry } from '../../game-engine/validation/mapGeometry';
import { validateMapRegions } from '../../game-engine/validation/mapRegions';
import type { MapDocumentLike } from '../../game-engine/validation/mapConnections';
import type { GeoMapDocument } from '../../game-engine/validation/mapGeometry';

/**
 * The publish-quality checks a community map must pass, shared by the publish
 * route (blocks on errors), the save routes (attach the same list as
 * warnings), the admin moderation queue (shows a summary per map), and the
 * playability check a draft must pass before its author test-plays it.
 *
 * Saving never blocks on these — a draft of two territories is a draft — so
 * this is where the floor lives: enough territories and connections to deal a
 * game, a name, and then the SAME validators `pnpm run validate:maps` holds
 * the built-in maps to — connectivity (orphan territories, disconnected
 * graph, dangling edges), regions (one with no territories renders as a dead
 * bonus row; one with a bonus and a single territory promises a bonus the
 * game never pays), and geometry-code clipping. Editor maps that carry no
 * Natural-Earth geo codes trivially pass the geometry check; it exists so a
 * copied-from-era map can't sneak a double-draw through review.
 *
 * Messages name territories and regions by their names, not their ids: the
 * editor's ids are timestamps, and "t_1762559221 is unreachable" helps no one.
 */
export interface ValidatableMapDoc {
  map_id?: string;
  name?: string;
  territories: Array<{ territory_id: string; name?: string; region_id?: string }>;
  connections: Array<{ from: string; to: string; type?: string }>;
  regions: Array<{ region_id: string; name?: string; bonus?: number }>;
}

/** The smallest board the game deals: below this, publish and test play refuse. */
export const MIN_MAP_TERRITORIES = 6;
export const MIN_MAP_CONNECTIONS = 5;
export const MIN_MAP_NAME_LENGTH = 3;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function validateMapDocument(doc: ValidatableMapDoc): string[] {
  const errors: string[] = [];

  const territoryName = new Map(doc.territories.map((t) => [t.territory_id, t.name] as const));
  const regionName = new Map(doc.regions.map((r) => [r.region_id, r.name] as const));
  const labelTerritory = (id: string) => territoryName.get(id) ?? id;
  const labelRegion = (id: string) => regionName.get(id) ?? id;

  if (typeof doc.name === 'string' && doc.name.trim().length < MIN_MAP_NAME_LENGTH) {
    errors.push(`Give the map a name of at least ${MIN_MAP_NAME_LENGTH} characters`);
  }
  if (doc.territories.length < MIN_MAP_TERRITORIES) {
    const missing = MIN_MAP_TERRITORIES - doc.territories.length;
    errors.push(
      `Add ${plural(missing, 'more territory', 'more territories')} — a map needs at least ${MIN_MAP_TERRITORIES} (has ${doc.territories.length})`,
    );
  }
  if (doc.connections.length < MIN_MAP_CONNECTIONS) {
    const missing = MIN_MAP_CONNECTIONS - doc.connections.length;
    errors.push(
      `Add ${plural(missing, 'more connection', 'more connections')} — a map needs at least ${MIN_MAP_CONNECTIONS} (has ${doc.connections.length})`,
    );
  }

  errors.push(
    ...validateMapConnections(doc as unknown as MapDocumentLike, { label: labelTerritory }),
  );

  const usedRegions = new Set(doc.territories.map((t) => t.region_id));
  for (const region of doc.regions) {
    if (!usedRegions.has(region.region_id)) {
      errors.push(`Region "${labelRegion(region.region_id)}" has no territories`);
    }
  }
  // The bonus rule, for regions the empty check above has not already named.
  errors.push(
    ...validateMapRegions(
      { territories: doc.territories, regions: doc.regions.filter((r) => usedRegions.has(r.region_id)) },
      new Set(),
      { label: labelRegion },
    ),
  );

  errors.push(...validateMapGeometry(doc as unknown as GeoMapDocument));

  return errors;
}
