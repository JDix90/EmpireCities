/**
 * Write the public map catalog to the frontend as plain ESM data.
 *
 *   pnpm -C backend exec tsx scripts/generateMapCatalog.ts
 *
 * The frontend image never sees database/ (docker/Dockerfile.frontend copies
 * frontend/ and the two shared packages, nothing else), so the map data has to
 * cross into the frontend as a committed artifact. Same arrangement as
 * generateFactionCodex.ts next door.
 *
 * The projection and the rendering live in src/modules/maps/mapCatalog.ts where
 * they are typechecked; this file owns only the paths and the I/O. The paths
 * live here rather than in src because the backend compiles to CommonJS, where
 * `import.meta` is a compile error — scripts are ESM and run under tsx.
 */
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEraMaps, buildMapCatalog, renderMapCatalogModule } from '../src/modules/maps/mapCatalog';

const HERE = dirname(fileURLToPath(import.meta.url));

export const MAPS_SOURCE_DIR = resolve(HERE, '..', '..', 'database', 'maps');

export const MAP_CATALOG_OUTPUT_PATH = resolve(
  HERE, '..', '..', 'frontend', 'src', 'marketing', 'mapCatalog.generated.mjs',
);

export async function run(): Promise<void> {
  const catalog = buildMapCatalog(MAPS_SOURCE_DIR);
  const eraMaps = buildEraMaps(MAPS_SOURCE_DIR);
  await writeFile(MAP_CATALOG_OUTPUT_PATH, renderMapCatalogModule(catalog, eraMaps), 'utf8');
  const territories = catalog.reduce((n, m) => n + m.territory_count, 0);
  console.log(`[map-catalog] wrote ${MAP_CATALOG_OUTPUT_PATH}`);
  console.log(`[map-catalog] ${catalog.length} maps, ${territories} territories`);
  console.log(`[map-catalog] ${Object.keys(eraMaps).length} era boards`);
}

// Only write when invoked directly — the drift test imports the paths from
// here, and an import must not have the side effect of rewriting the file it is
// about to check.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((err) => {
    console.error('[map-catalog] failed:', err);
    process.exit(1);
  });
}
