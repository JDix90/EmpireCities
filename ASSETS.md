# Asset provenance

Where every visual in Borderfall comes from. The short version: **no image
generators are used anywhere in the pipeline, and there is no raster "art" to
generate.** Brand marks are hand-authored vector source, the game board is drawn
in-engine from real geographic data, and the only photographic textures are
well-known open-source planetary imagery. This page exists so the claim is
verifiable rather than asserted.

## Brand marks — hand-authored SVG
- `frontend/public/favicon.svg` and `frontend/public/og-image.svg` are
  hand-written SVG (shapes + `<text>`), diff-able in version control. There is
  no hidden raster source.
- `frontend/public/og-image.png` (the social/share card) is **rasterized from
  the SVG** by `frontend/scripts/generate-og.mjs` using
  [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) — a deterministic SVG
  renderer, **not** an image model. Re-running the script reproduces the PNG
  byte-for-byte from the committed SVG.

## Game board — drawn in-engine from real geographic data
- Territories are rendered as SVG polygons (2D, `GameMap.tsx` via
  `utils/map2dProjection.ts`) or fed to WebGL (3D globe, `GlobeMap.tsx` via
  `three-globe`). Nothing is a painted/raster map image.
- The source polygons are **[Natural Earth](https://www.naturalearthdata.com/)
  Admin-1 states/provinces** GeoJSON (`frontend/public/geo/*.json`) — public,
  authoritative geodata. Maps are generated from it by the `scripts/build*`
  tools (Voronoi tessellation, connection graphs).

## Planet textures — open-source NASA / library imagery
The Space- and Galaxy-age globes use photographic planet textures from
recognized open-source sources, not generated images:
- NASA **Blue Marble** + topology (ship with the `three-globe` npm package).
- `three.js` example textures (moon, night sky).
- [`ofrohn/threex.planets`](https://github.com/jeromeetienne/threex.planets)
  planetary textures (MIT).

## Icons & type
- Icons: **[lucide](https://lucide.dev/)** (`lucide-react`), an open-source icon
  library.
- Type: **Cinzel** (display) + **Inter** (body), via Google Fonts.
- A deliberate brand palette and animations live in `frontend/tailwind.config.js`
  / `frontend/src/index.css` — a real design system, not a template.

## Audio
None. The project ships no audio assets.

## Summary
No asset in this project is produced by an image, audio, or video generation
model. Visuals are either (a) hand-authored vector source, (b) rendered in-engine
from open geographic data, or (c) open-source/NASA imagery with public
provenance. The pipeline is code and data, end to end.
