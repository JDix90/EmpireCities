#!/usr/bin/env node
/**
 * Guard for native (Capacitor) builds. Two modes:
 *
 *   node scripts/check-native-env.mjs          before the build: the server addresses are set and usable
 *   node scripts/check-native-env.mjs --dist   after it: dist/index.html is the bare app shell
 *
 * `pnpm run build:native` runs both around `tsc && vite build`. The rules and
 * the reasons are in scripts/nativeBuildEnv.mjs.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNativeBuildEnv, checkNativeDist } from './nativeBuildEnv.mjs';

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv.includes('--dist')) {
  let html;
  try {
    html = await readFile(resolve(here, '..', 'dist', 'index.html'), 'utf8');
  } catch {
    console.error('[native-build] dist/index.html not found: the build did not run.');
    process.exit(1);
  }
  const problems = checkNativeDist(html);
  for (const p of problems) console.error(`[native-build] ${p}`);
  if (problems.length) process.exit(1);
  console.log('[native-build] dist/index.html is a clean app shell.');
} else {
  const { errors, warnings } = checkNativeBuildEnv(process.env);
  for (const w of warnings) console.warn(`[native-build] note: ${w}`);
  for (const e of errors) console.error(`[native-build] ${e}`);
  if (errors.length) {
    console.error('[native-build] Not building. See docs/MOBILE_CAPACITOR.md.');
    process.exit(1);
  }
  console.log(`[native-build] server: ${process.env.VITE_API_URL.trim()} (sockets: ${process.env.VITE_SOCKET_URL.trim()})`);
}
