/**
 * Dynamic per-replay Open Graph image. We render an SVG (branded to match the
 * client share card) and rasterize it to PNG with @resvg/resvg-js, which ships
 * prebuilt musl binaries so it works on the alpine production image without any
 * native build toolchain.
 */
import { Resvg } from '@resvg/resvg-js';

const APP_NAME = 'Borderfall';
const TAGLINE = 'Forge empires. Redraw the map.';

export interface ReplayOgOptions {
  winnerName: string;
  winnerColor: string;
  eraLabel: string;
  turnCount: number;
  playerCount: number;
  /** Faction/player colors to render as a small swatch row. */
  playerColors: string[];
}

const W = 1200;
const H = 630;

/** Escape a string for inclusion in SVG/XML text. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Clamp a possibly-untrusted color to a safe hex/rgb string. */
function safeColor(c: string | undefined | null, fallback = '#c9a84c'): string {
  if (typeof c !== 'string') return fallback;
  if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  if (/^rgb(a)?\([0-9.,\s%]+\)$/.test(c)) return c;
  return fallback;
}

export function renderReplayOgSvg(opts: ReplayOgOptions): string {
  const accent = safeColor(opts.winnerColor);
  const winner = esc(opts.winnerName || 'Unknown');
  const era = esc(opts.eraLabel || 'Custom');
  const swatches = opts.playerColors
    .slice(0, 8)
    .map((c, i) => `<circle cx="${64 + i * 44}" cy="558" r="16" fill="${safeColor(c)}" stroke="rgba(255,255,255,0.25)" stroke-width="2" />`)
    .join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101724" />
      <stop offset="0.55" stop-color="#1b2335" />
      <stop offset="1" stop-color="#0a0f18" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <circle cx="${W - 160}" cy="120" r="240" fill="${accent}" opacity="0.10" />
  <circle cx="180" cy="${H - 40}" r="180" fill="${accent}" opacity="0.10" />
  <rect x="0" y="0" width="${W}" height="10" fill="${accent}" />
  <rect x="0" y="0" width="10" height="${H}" fill="${accent}" />
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="${accent}" opacity="0.6" />

  <text x="64" y="92" font-family="Georgia, serif" font-size="30" font-weight="600" fill="rgba(255,255,255,0.6)">${esc(APP_NAME)}</text>
  <text x="64" y="128" font-family="Georgia, serif" font-style="italic" font-size="20" fill="${accent}" opacity="0.8">${esc(TAGLINE)}</text>

  <text x="64" y="248" font-family="Georgia, serif" font-size="40" fill="rgba(255,255,255,0.55)">Champion</text>
  <text x="64" y="330" font-family="Georgia, serif" font-size="84" font-weight="bold" fill="#ffffff">${winner}</text>

  <g font-family="system-ui, sans-serif">
    <rect x="64" y="384" width="300" height="110" rx="12" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
    <text x="84" y="424" font-size="18" fill="rgba(255,255,255,0.52)">ERA</text>
    <text x="84" y="468" font-size="34" font-weight="bold" fill="#ffffff">${era}</text>

    <rect x="392" y="384" width="200" height="110" rx="12" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
    <text x="412" y="424" font-size="18" fill="rgba(255,255,255,0.52)">TURNS</text>
    <text x="412" y="468" font-size="34" font-weight="bold" fill="#ffffff">${opts.turnCount}</text>

    <rect x="620" y="384" width="220" height="110" rx="12" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
    <text x="640" y="424" font-size="18" fill="rgba(255,255,255,0.52)">PLAYERS</text>
    <text x="640" y="468" font-size="34" font-weight="bold" fill="#ffffff">${opts.playerCount}</text>
  </g>

  ${swatches}

  <text x="${W - 64}" y="${H - 40}" text-anchor="end" font-family="system-ui, sans-serif" font-size="22" fill="${accent}">Watch the replay →</text>
</svg>`;
}

export function renderReplayOgPng(opts: ReplayOgOptions): Buffer {
  const svg = renderReplayOgSvg(opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    background: '#0a0f18',
    // The alpine production image only ships DejaVu (see Dockerfile.backend).
    // Our SVG asks for Georgia/system-ui, which don't exist there; resvg
    // substitutes the default family so text still renders.
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'DejaVu Sans',
      serifFamily: 'DejaVu Serif',
      sansSerifFamily: 'DejaVu Sans',
    },
  });
  return resvg.render().asPng();
}
