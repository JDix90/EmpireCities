import { validateMapConnections } from '../../game-engine/validation/mapConnections';
import { validateMapGeometry } from '../../game-engine/validation/mapGeometry';
import type { MapDocumentLike } from '../../game-engine/validation/mapConnections';
import type { GeoMapDocument } from '../../game-engine/validation/mapGeometry';

/**
 * The publish-quality checks a community map must pass, shared by the publish
 * route (blocks on errors), the save routes (attach the same list as
 * warnings), and the admin moderation queue (shows a summary per map).
 *
 * Runs the SAME validators `pnpm run validate:maps` holds the built-in maps
 * to — connectivity (orphan territories, disconnected graph, dangling edges)
 * and geometry-code clipping — plus a region-emptiness check: a region no
 * territory references renders as a dead bonus row in every game on the map.
 * Editor maps that carry no Natural-Earth geo codes trivially pass the
 * geometry check; it exists so a copied-from-era map can't sneak a
 * double-draw through review.
 */
export interface ValidatableMapDoc {
  map_id?: string;
  name?: string;
  territories: Array<{ territory_id: string; region_id?: string }>;
  connections: Array<{ from: string; to: string; type?: string }>;
  regions: Array<{ region_id: string; name?: string }>;
}

export function validateMapDocument(doc: ValidatableMapDoc): string[] {
  const errors = [
    ...validateMapConnections(doc as unknown as MapDocumentLike),
    ...validateMapGeometry(doc as unknown as GeoMapDocument),
  ];

  const usedRegions = new Set(doc.territories.map((t) => t.region_id));
  for (const region of doc.regions) {
    if (!usedRegions.has(region.region_id)) {
      errors.push(`Region "${region.name ?? region.region_id}" has no territories`);
    }
  }

  return errors;
}
