import { COSMETIC_GLYPHS, type MarkerLook } from '@borderfall/shared';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Room around the 24×24 glyph grid for the outline stroke. */
const VIEW_BOX = '-2 -2 28 28';
/** Drawn under the glyph so it reads on any territory colour. */
const OUTLINE = '#0b0d12';
const STROKES: ReadonlyArray<readonly [colour: 'outline' | 'glyph', width: string]> = [
  ['outline', '5'],
  ['glyph', '2.25'],
];

const strokeColour = (look: MarkerLook, which: 'outline' | 'glyph') => (which === 'outline' ? OUTLINE : look.color);

/** A marker's glyph as standalone SVG: its colour over a dark outline. */
export function markerSvgMarkup(look: MarkerLook, size: number): string {
  const paths = COSMETIC_GLYPHS[look.glyph].map((d) => `<path d="${d}"/>`).join('');
  const groups = STROKES.map(
    ([which, width]) => `<g stroke="${strokeColour(look, which)}" stroke-width="${width}">${paths}</g>`,
  ).join('');
  return `<svg xmlns="${SVG_NS}" viewBox="${VIEW_BOX}" width="${size}" height="${size}" fill="none" stroke-linecap="round" stroke-linejoin="round">${groups}</svg>`;
}

/** The same SVG as a data URL, for the 2D map's texture. */
export function markerSvgDataUrl(look: MarkerLook, size: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markerSvgMarkup(look, size))}`;
}

/** The same drawing as DOM nodes, for the globe's HTML markers (no innerHTML). */
export function markerSvgElement(look: MarkerLook, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', VIEW_BOX);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [which, width] of STROKES) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('stroke', strokeColour(look, which));
    g.setAttribute('stroke-width', width);
    for (const d of COSMETIC_GLYPHS[look.glyph]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      g.appendChild(path);
    }
    svg.appendChild(g);
  }
  return svg;
}
