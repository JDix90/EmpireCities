/**
 * Rasterize public/og-image.svg → public/og-image.png at 1200×630.
 *
 * Most social platforms (Twitter/X, Facebook, Discord, iMessage, LinkedIn)
 * don't reliably render SVG link previews, so the PNG is the primary OG image
 * referenced from index.html. The SVG is kept in the repo as the editable source.
 *
 * This is a one-off generator: run `pnpm run generate:og` after editing the SVG
 * and commit the resulting PNG. It is intentionally NOT part of `pnpm run build`
 * so the Docker build needs no native rasterizer — the committed PNG ships as a
 * static asset that Vite copies into dist/.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');
const SVG = resolve(PUBLIC, 'og-image.svg');
const PNG = resolve(PUBLIC, 'og-image.png');

const WIDTH = 1200;
const HEIGHT = 630;

const svg = await readFile(SVG, 'utf8');

const resvg = new Resvg(svg, {
  // Render at the SVG's native 1200-wide viewBox so the output is exactly 1200×630.
  fitTo: { mode: 'width', value: WIDTH },
  background: '#101724',
  font: { loadSystemFonts: true },
});

const rendered = resvg.render();
await writeFile(PNG, rendered.asPng());

console.log(`[generate:og] wrote public/og-image.png (${rendered.width}×${rendered.height}, target ${WIDTH}×${HEIGHT})`);
