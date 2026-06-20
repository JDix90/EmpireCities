/**
 * Era board theme — single source of truth for how the live board re-skins to
 * reflect era (Layer 1: programmatic theming). Fuses the existing ERA_META
 * (accent) + ERA_METADATA (atmosphere background) and exposes art-ready hooks
 * (`globeTextureUrl` / `terrainTextureUrl`) that stay null until real, human-made
 * assets exist (Layer 2). Nothing here is AI-generated art.
 *
 * Per-player eras: the board geometry is shared and fixed, but each player can be
 * in a different era. So the two layers read from different sources:
 *  - ATMOSPHERE (background/tint) → the VIEWING player's era ("my world").
 *  - UNIT styling (badge tint, later sprites) → each territory's OWNER era, so
 *    era gaps are visible on the board (your modern troops vs their ancient ones).
 */
import { ERA_META } from './eraMeta';
import { ERA_METADATA } from '../services/mapService';

export interface EraBoardTheme {
  eraId: string;
  /** Accent (CSS hex) — unit-badge tint, region accents. From ERA_META. */
  accent: string;
  /** Atmosphere background (CSS hex) — the board backdrop. From ERA_METADATA. */
  background: string;
  /** Short label, e.g. "Modern". */
  label: string;
  /** Single-glyph era tag (matches the lobby era cards). */
  glyph: string;
  // ── Layer 2 art hooks — null until real (non-AI) assets ship; drop-in later ──
  /** react-globe.gl earth texture URL for this era. */
  globeTextureUrl: string | null;
  /** 2D terrain texture URL for this era. */
  terrainTextureUrl: string | null;
}

/** Era → single landmark glyph, matching the lobby era cards' set. */
const ERA_GLYPH: Record<string, string> = {
  ancient: '🏛️',
  medieval: '🏰',
  discovery: '⛵',
  ww2: '✈️',
  coldwar: '☢️',
  modern: '🌐',
  acw: '🎖️',
  risorgimento: '🇮🇹',
  space_age: '🚀',
  galaxy_age: '🌌',
};

const FALLBACK: EraBoardTheme = {
  eraId: '',
  accent: '#c9a84c',
  background: '#0a0e1a',
  label: 'New Era',
  glyph: '🗺️',
  globeTextureUrl: null,
  terrainTextureUrl: null,
};

/**
 * The board theme for an era id. Safe for any input (unknown ids fall back to a
 * neutral dark theme), so callers can pass a viewing/owner era id directly.
 */
export function eraBoardTheme(eraId?: string | null): EraBoardTheme {
  if (!eraId) return FALLBACK;
  const meta = ERA_META[eraId];
  const md = ERA_METADATA[eraId];
  if (!meta && !md) return { ...FALLBACK, eraId };
  return {
    eraId,
    accent: meta?.color ?? md?.color ?? FALLBACK.accent,
    background: md?.bgColor ?? FALLBACK.background,
    label: meta?.short ?? md?.label ?? FALLBACK.label,
    glyph: ERA_GLYPH[eraId] ?? FALLBACK.glyph,
    globeTextureUrl: null,
    terrainTextureUrl: null,
  };
}
