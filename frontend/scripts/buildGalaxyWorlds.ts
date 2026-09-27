#!/usr/bin/env tsx
/**
 * Galactic Age world generator — writes the four worlds of `era_galaxy` from
 * the specs in `scripts/galaxy/worldSpecs.ts`.
 *
 *   pnpm -C frontend exec tsx scripts/buildGalaxyWorlds.ts           # write
 *   pnpm -C frontend exec tsx scripts/buildGalaxyWorlds.ts --check   # verify only
 *
 * Writes:
 *   - database/maps/era_galaxy.json + frontend/public/maps/regional/era_galaxy.json
 *   - frontend/src/data/galaxyExoVoronoiGlobe.ts
 *   - frontend/src/data/galaxySolGlobeGeo.ts
 *
 * The map header (name, description, projection, `worlds[]` with their rules
 * and modifiers) is read from the committed era_galaxy.json and kept; the
 * specs own territories, regions and connections.
 *
 * After writing, rebuild the Space to Stars board and the map catalog, which
 * both read this map:
 *   pnpm -C backend exec tsx scripts/buildAscensionGalaxyMap.ts
 *   pnpm -C backend exec tsx scripts/generateMapCatalog.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateGalaxyWorlds, type GalaxyMapScaffold } from './galaxy/generateGalaxyWorlds';
import { GALAXY_SPECS } from './galaxy/worldSpecs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

export const GALAXY_OUTPUT_PATHS = {
  map: path.join(ROOT, 'database', 'maps', 'era_galaxy.json'),
  publicMap: path.join(ROOT, 'frontend', 'public', 'maps', 'regional', 'era_galaxy.json'),
  exoGlobe: path.join(ROOT, 'frontend', 'src', 'data', 'galaxyExoVoronoiGlobe.ts'),
  solGeo: path.join(ROOT, 'frontend', 'src', 'data', 'galaxySolGlobeGeo.ts'),
};

function main(): void {
  const check = process.argv.includes('--check');
  const scaffold = JSON.parse(fs.readFileSync(GALAXY_OUTPUT_PATHS.map, 'utf-8')) as GalaxyMapScaffold;
  const out = generateGalaxyWorlds(scaffold, GALAXY_SPECS);
  const files: Array<[string, string]> = [
    [GALAXY_OUTPUT_PATHS.map, out.mapJson],
    [GALAXY_OUTPUT_PATHS.publicMap, out.mapJson],
    [GALAXY_OUTPUT_PATHS.exoGlobe, out.exoGlobeModule],
    [GALAXY_OUTPUT_PATHS.solGeo, out.solGeoModule],
  ];

  if (check) {
    const stale = files.filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf-8') !== content);
    for (const [file] of stale) console.error(`stale: ${path.relative(ROOT, file)}`);
    if (stale.length) {
      console.error('Galaxy world files differ from the specs — run: pnpm -C frontend exec tsx scripts/buildGalaxyWorlds.ts');
      process.exit(1);
    }
    console.log('Galaxy world files match the specs.');
    return;
  }

  for (const [file, content] of files) fs.writeFileSync(file, content);
  const { territories, connections } = out.map;
  const perWorld = [...new Set(territories.map((t) => t.world_id))]
    .map((w) => `${w}:${territories.filter((t) => t.world_id === w).length}`).join(' ');
  const byType = connections.reduce((m, c) => ((m[c.type] = (m[c.type] || 0) + 1), m), {} as Record<string, number>);
  console.log(`era_galaxy.json (x2): ${territories.length} territories (${perWorld}), ${connections.length} connections (${JSON.stringify(byType)}).`);
  console.log('Next: pnpm -C backend exec tsx scripts/buildAscensionGalaxyMap.ts && pnpm -C backend exec tsx scripts/generateMapCatalog.ts');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
