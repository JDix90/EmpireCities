/**
 * What every cosmetic looks like, keyed by `cosmetic_id`. Pure data: the client
 * draws it (profile, store, matches), and a backend test checks that every item
 * in the catalog has a look of the right kind. The catalog itself (names,
 * prices, rarity) lives in SQL; this only says how an item is drawn.
 *
 * Everything is drawn in code: gradients and colours, plus a few stroked glyphs
 * on lucide's 24×24 grid (see ASSETS.md). An id with no look, or a look of the
 * wrong kind for the slot, draws as nothing equipped.
 */

/** Which slot an item goes in, and so how it is drawn. */
export type CosmeticKind = 'frame' | 'banner' | 'marker' | 'dice';

/** The catalog `type` of each kind of cosmetic that can be equipped. */
export const COSMETIC_TYPE_KIND: Readonly<Record<string, CosmeticKind>> = {
  profile_frame: 'frame',
  profile_banner: 'banner',
  map_marker: 'marker',
  dice_skin: 'dice',
};

/**
 * Glyphs for banners and markers: SVG path data on a 24×24 grid, stroked in
 * lucide's style (width 2, round caps and joins, no fill). Converted to paths
 * from lucide 0.379 (https://lucide.dev, ISC licence: "Copyright (c) for
 * portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2022.").
 */
export const COSMETIC_GLYPHS = {
  crown: [
    'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z',
    'M5 21h14',
  ],
  skull: [
    'M8 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M14 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M8 20v2h8v-2',
    'm12.5 17-.5-1-.5 1h1z',
    'M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20',
  ],
  'chevrons-up': ['m17 11-5-5-5 5', 'm17 18-5-5-5 5'],
  compass: [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
    'M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z',
  ],
  swords: [
    'M14.5 17.5 3 6 3 3 6 3 17.5 14.5',
    'M13 19 19 13',
    'M16 16 20 20',
    'M19 21 21 19',
    'M14.5 6.5 18 3 21 3 21 6 17.5 9.5',
    'M5 14 9 18',
    'M7 17 4 20',
    'M3 19 5 21',
  ],
} as const satisfies Record<string, readonly string[]>;

export type CosmeticGlyphName = keyof typeof COSMETIC_GLYPHS;

/** A ring around the player's avatar or colour dot. */
export interface FrameLook {
  kind: 'frame';
  /** Gradient stops across the ring, left to right. */
  ring: readonly string[];
  /** A soft glow around the ring. */
  glow?: string;
  /** The ring turns slowly. Still when the player prefers reduced motion. */
  motion?: 'spin';
}

/** A tag beside the player's name. */
export interface BannerLook {
  kind: 'banner';
  glyph: CosmeticGlyphName;
  /** What the tag says to a screen reader, and on hover. */
  label: string;
  /** Text shown after the glyph; without it the tag is the glyph alone. */
  title?: string;
  /** Glyph and text colour. */
  color: string;
  background: string;
  /** Border colour. */
  trim: string;
}

/** The player's mark on the map, drawn on their capital. */
export interface MarkerLook {
  kind: 'marker';
  glyph: CosmeticGlyphName;
  color: string;
}

/**
 * The player's combat dice. The renderer keeps the red (attacker) and blue
 * (defender) cue around the die, so a skin never hides whose roll it is.
 */
export interface DiceLook {
  kind: 'dice';
  /** Face gradient stops, top left to bottom right. */
  face: readonly string[];
  /** Colour of the number on the face. */
  ink: string;
  /** Border colour. */
  edge: string;
  /**
   * `wobble`: the die rocks while it rolls. `shimmer`: light sweeps across the
   * face. Both still when the player prefers reduced motion.
   */
  effect?: 'wobble' | 'shimmer';
}

export type CosmeticLook = FrameLook | BannerLook | MarkerLook | DiceLook;

export const COSMETIC_LOOKS: Readonly<Record<string, CosmeticLook>> = {
  // ── Frames: achievements. The first four keep the gradients the profile
  // page has always drawn for them.
  frame_bronze: { kind: 'frame', ring: ['#b45309', '#f59e0b', '#b45309'] },
  frame_silver: { kind: 'frame', ring: ['#9ca3af', '#ffffff', '#9ca3af'] },
  frame_gold: { kind: 'frame', ring: ['#eab308', '#fde047', '#eab308'] },
  frame_champion: { kind: 'frame', ring: ['#a855f7', '#f472b6', '#a855f7'] },
  frame_recruit: { kind: 'frame', ring: ['#3f6212', '#bef264', '#3f6212'] },
  frame_immortal: {
    kind: 'frame', ring: ['#991b1b', '#f97316', '#fde047', '#f97316', '#991b1b'], glow: '#f97316', motion: 'spin',
  },
  // ── Frames: daily streaks.
  frame_week_master: { kind: 'frame', ring: ['#0f766e', '#5eead4', '#0f766e'] },
  frame_month_master: {
    kind: 'frame', ring: ['#6d28d9', '#c4b5fd', '#f0abfc', '#c4b5fd', '#6d28d9'], glow: '#a78bfa', motion: 'spin',
  },
  // ── Frames: levels.
  frame_level_10: { kind: 'frame', ring: ['#0369a1', '#7dd3fc', '#0369a1'] },
  frame_level_20: { kind: 'frame', ring: ['#047857', '#6ee7b7', '#047857'] },
  frame_level_30: { kind: 'frame', ring: ['#be123c', '#fda4af', '#be123c'] },
  frame_level_40: { kind: 'frame', ring: ['#3730a3', '#fcd34d', '#3730a3'], glow: '#818cf8' },
  frame_level_50: {
    kind: 'frame', ring: ['#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'], glow: '#f0abfc', motion: 'spin',
  },
  // ── Frames: season 1 tiers, in the ranked tier colours.
  frame_s1_bronze: { kind: 'frame', ring: ['#7c4a1e', '#cd7f32', '#f0b27a', '#cd7f32', '#7c4a1e'] },
  frame_s1_silver: { kind: 'frame', ring: ['#6b7280', '#c0c0c0', '#f8fafc', '#c0c0c0', '#6b7280'] },
  frame_s1_gold: { kind: 'frame', ring: ['#a16207', '#ffd700', '#fff7ae', '#ffd700', '#a16207'] },
  frame_s1_platinum: {
    kind: 'frame', ring: ['#94a3b8', '#e5e4e2', '#ffffff', '#e5e4e2', '#94a3b8'], glow: '#e2e8f0',
  },
  frame_s1_diamond: {
    kind: 'frame', ring: ['#0e7490', '#b9f2ff', '#ffffff', '#b9f2ff', '#0e7490'], glow: '#67e8f9', motion: 'spin',
  },

  // ── Banners.
  general_banner: {
    kind: 'banner', glyph: 'chevrons-up', label: 'General', color: '#e5c870', background: '#2a2412', trim: '#c9a84c',
  },
  emperor_title: {
    kind: 'banner', glyph: 'crown', label: 'Emperor', title: 'Emperor',
    color: '#fde68a', background: '#3b0764', trim: '#f59e0b',
  },
  badge_pioneer: {
    kind: 'banner', glyph: 'compass', label: 'Pioneer', color: '#6ee7b7', background: '#052e25', trim: '#10b981',
  },

  // ── Markers.
  marker_crown: { kind: 'marker', glyph: 'crown', color: '#fbbf24' },
  marker_skull: { kind: 'marker', glyph: 'skull', color: '#f5f5f4' },

  // ── Dice.
  bone_dice: { kind: 'dice', face: ['#f8f1de', '#e4d4ad'], ink: '#4a3520', edge: '#a8906a', effect: 'wobble' },
  holo_dice: { kind: 'dice', face: ['#a5f3fc', '#c4b5fd', '#f9a8d4'], ink: '#312e81', edge: '#e0e7ff', effect: 'shimmer' },

  // ── Kept for anyone who still owns one. Nothing grants these any more, and
  // migration 044 removed them from the catalog except where someone owned one.
  frame_warlord: { kind: 'frame', ring: ['#1c1917', '#b91c1c', '#1c1917'], glow: '#b91c1c' },
  frame_prestige_1: { kind: 'frame', ring: ['#78350f', '#fcd34d', '#78350f'] },
  frame_prestige_2: { kind: 'frame', ring: ['#581c87', '#fcd34d', '#e9d5ff', '#fcd34d', '#581c87'], glow: '#c084fc' },
  badge_rival: {
    kind: 'banner', glyph: 'swords', label: 'Rival', color: '#cbd5e1', background: '#1e293b', trim: '#64748b',
  },
  badge_nemesis: {
    kind: 'banner', glyph: 'skull', label: 'Nemesis', color: '#fca5a5', background: '#450a0a', trim: '#dc2626',
  },
  marker_emperor: { kind: 'marker', glyph: 'crown', color: '#c084fc' },
};

/** The look for `id`, or null when it has none. */
export function cosmeticLook(id: string | null | undefined): CosmeticLook | null {
  if (!id || !Object.prototype.hasOwnProperty.call(COSMETIC_LOOKS, id)) return null;
  return COSMETIC_LOOKS[id] ?? null;
}

function lookOfKind<K extends CosmeticKind>(id: string | null | undefined, kind: K): Extract<CosmeticLook, { kind: K }> | null {
  const look = cosmeticLook(id);
  return look?.kind === kind ? (look as Extract<CosmeticLook, { kind: K }>) : null;
}

/** The frame look for `id`; null for anything else, a banner included. */
export const frameLook = (id: string | null | undefined): FrameLook | null => lookOfKind(id, 'frame');
export const bannerLook = (id: string | null | undefined): BannerLook | null => lookOfKind(id, 'banner');
export const markerLook = (id: string | null | undefined): MarkerLook | null => lookOfKind(id, 'marker');
export const diceLook = (id: string | null | undefined): DiceLook | null => lookOfKind(id, 'dice');
