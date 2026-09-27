/**
 * Validates all JSON maps under database/maps (bidirectional connections, known territories).
 * Run: pnpm run validate:maps (from backend/)
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { validateMapConnections, type MapDocumentLike } from '../src/game-engine/validation/mapConnections';
import { validateMapGeometry, type GeoMapDocument } from '../src/game-engine/validation/mapGeometry';
import { validateMapGalaxy, type GalaxyMapDocument } from '../src/game-engine/validation/mapGalaxy';
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
    const errors = [
      ...validateMapConnections(map),
      ...validateMapGeometry(map),
      ...validateMapGalaxy(map, homeFactions),
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
  console.log(`\nAll ${files.length} map file(s) passed connection + geometry + galaxy validation.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
