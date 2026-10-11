/**
 * Validates all JSON maps under database/maps (bidirectional connections, known territories,
 * and no bonus region of a single territory unless it is a faction's home).
 * Run: pnpm run validate:maps (from backend/)
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { validateMapConnections, type MapDocumentLike } from '../src/game-engine/validation/mapConnections';
import { validateMapGeometry, type GeoMapDocument } from '../src/game-engine/validation/mapGeometry';
import { validateMapGalaxy, type GalaxyMapDocument } from '../src/game-engine/validation/mapGalaxy';
import { validateMapRegions } from '../src/game-engine/validation/mapRegions';
import { getEraFactions } from '../src/game-engine/eras';
import type { EraId } from '../src/types';

async function main(): Promise<void> {
  const mapsDir = join(__dirname, '../../database/maps');
  const files = (await readdir(mapsDir)).filter((f) => f.endsWith('.json'));
  let failed = false;

  for (const file of files.sort()) {
    const raw = await readFile(join(mapsDir, file), 'utf-8');
    const map = JSON.parse(raw) as MapDocumentLike & GeoMapDocument & GalaxyMapDocument & { era_theme?: EraId };
    // Faction homeworlds are checked only where the era's factions are dealt
    // one world each (the Galactic Age); other eras' home regions are on Earth.
    const homeFactions = map.era_theme === 'galaxy_age' ? getEraFactions('galaxy_age') : [];
    // A faction's home may be a one-territory region with a bonus (validation/mapRegions.ts).
    const regionHomes = new Set(
      (map.era_theme ? getEraFactions(map.era_theme) : []).flatMap((f) => f.home_region_ids ?? []),
    );
    const errors = [
      ...validateMapConnections(map),
      ...validateMapGeometry(map),
      ...validateMapGalaxy(map, homeFactions),
      ...validateMapRegions(map, regionHomes),
    ];
    if (errors.length > 0) {
      failed = true;
      console.error(`\n✗ ${file} (${map.map_id ?? '?'})`);
      for (const e of errors) console.error(`   - ${e}`);
    } else {
      console.log(`✓ ${file}`);
    }
  }

  if (failed) {
    console.error('\nMap validation failed.');
    process.exit(1);
  }
  console.log(`\nAll ${files.length} map file(s) passed connection + geometry + galaxy + region validation.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
