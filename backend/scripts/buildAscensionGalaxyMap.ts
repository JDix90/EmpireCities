/**
 * Builds `database/maps/era_ascension_galaxy.json` — the Space to Stars board.
 *
 *   pnpm -C backend exec tsx scripts/buildAscensionGalaxyMap.ts
 *
 * Re-run this after changing either source map (`era_space_age.json`,
 * `era_galaxy.json`). The build itself lives in
 * src/modules/maps/ascensionGalaxyMap.ts, where it is typechecked and where
 * `ascensionGalaxyMap.test.ts` rebuilds the board and fails if the committed
 * file has drifted from its sources. This file owns only the paths and the I/O.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameMap } from '../src/types';
import {
  ascensionWorldOf,
  buildAscensionGalaxyMap,
  renderAscensionGalaxyMap,
} from '../src/modules/maps/ascensionGalaxyMap';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ASCENSION_MAPS_DIR = resolve(HERE, '..', '..', 'database', 'maps');
export const ASCENSION_OUTPUT_PATH = resolve(ASCENSION_MAPS_DIR, 'era_ascension_galaxy.json');

export function readSourceMap(name: string): GameMap {
  return JSON.parse(readFileSync(resolve(ASCENSION_MAPS_DIR, name), 'utf-8')) as GameMap;
}

function main(): void {
  const out = buildAscensionGalaxyMap(readSourceMap('era_space_age.json'), readSourceMap('era_galaxy.json'));
  writeFileSync(ASCENSION_OUTPUT_PATH, renderAscensionGalaxyMap(out));
  const { territories, connections } = out;
  const byWorld: Record<string, number> = {};
  for (const t of territories) byWorld[ascensionWorldOf(t)] = (byWorld[ascensionWorldOf(t)] ?? 0) + 1;
  console.log(`Wrote ${ASCENSION_OUTPUT_PATH}`);
  console.log(`  ${territories.length} territories: ${JSON.stringify(byWorld)}`);
  console.log(`  ${connections.length} connections (${connections.filter((c) => c.type === 'orbit').length} orbit)`);
  console.log(`  unlocked at start: ${territories.filter((t) => !(t as { unlock_era_index?: number }).unlock_era_index).length}`);
}

// Only write when invoked directly — the drift test imports the paths from
// here, and an import must not rewrite the file it is about to check.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
