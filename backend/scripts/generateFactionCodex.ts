/**
 * Write the public faction codex to the frontend as plain ESM data.
 *
 *   pnpm -C backend exec tsx scripts/generateFactionCodex.ts
 *
 * The frontend's prerender script is dependency-free Node and cannot import
 * backend TypeScript, and fetching the live API at build time would make the
 * build depend on production being reachable. So the data is committed as a
 * generated artifact instead.
 *
 * The projection and the rendering live in src/game-engine/eras/factionCodex.ts
 * where they are typechecked; this file owns only the path and the I/O. The
 * path lives here rather than in src because the backend compiles to CommonJS,
 * where `import.meta` is a compile error — scripts are ESM and run under tsx.
 */
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFactionCodex,
  renderCodexModule,
} from '../src/game-engine/eras/factionCodex';

export const CODEX_OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'frontend', 'src', 'marketing', 'factionCodex.generated.mjs',
);

export async function run(): Promise<void> {
  const codex = buildFactionCodex();
  await writeFile(CODEX_OUTPUT_PATH, renderCodexModule(codex), 'utf8');
  const total = codex.reduce((n, e) => n + e.factions.length, 0);
  console.log(`[faction-codex] wrote ${CODEX_OUTPUT_PATH}`);
  console.log(`[faction-codex] ${codex.length} eras, ${total} factions`);
}

// Only write when invoked directly — the drift test imports CODEX_OUTPUT_PATH
// from here, and an import must not have the side effect of rewriting the file
// it is about to check.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((err) => {
    console.error('[faction-codex] failed:', err);
    process.exit(1);
  });
}
