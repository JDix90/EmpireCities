import type { CosmeticGlyphName, CosmeticRarity } from '@borderfall/shared';

/** How an item's rarity lights its card: border, glow, the light under its preview, and a sheen for the rarest. */
export interface RarityStyle {
  label: string;
  /** Label colour, lightened from RARITY_COLORS where that is too dark to read as small text. */
  text: string;
  edge: string;
  glow: string;
  light: string;
  sheen: boolean;
}

export const RARITY_STYLES: Readonly<Record<CosmeticRarity, RarityStyle>> = {
  common: {
    label: 'Common', text: '#b8bec9', edge: 'rgba(156, 163, 175, 0.28)',
    glow: '0 0 0 0 transparent', light: 'rgba(156, 163, 175, 0.10)', sheen: false,
  },
  uncommon: {
    label: 'Uncommon', text: '#4ade80', edge: 'rgba(34, 197, 94, 0.50)',
    glow: '0 14px 34px -16px rgba(34, 197, 94, 0.55)', light: 'rgba(34, 197, 94, 0.20)', sheen: false,
  },
  rare: {
    label: 'Rare', text: '#7cb4ff', edge: 'rgba(59, 130, 246, 0.65)',
    glow: '0 16px 40px -14px rgba(59, 130, 246, 0.65)', light: 'rgba(59, 130, 246, 0.26)', sheen: false,
  },
  legendary: {
    label: 'Legendary', text: '#d0a3ff', edge: 'rgba(168, 85, 247, 0.75)',
    glow: '0 18px 46px -14px rgba(168, 85, 247, 0.7)', light: 'rgba(168, 85, 247, 0.30)', sheen: true,
  },
  mythic: {
    label: 'Mythic', text: '#ffa566', edge: 'rgba(249, 115, 22, 0.85)',
    glow: '0 20px 50px -14px rgba(249, 115, 22, 0.75)', light: 'rgba(249, 115, 22, 0.34)', sheen: true,
  },
};

export function rarityStyle(rarity: CosmeticRarity | null | undefined): RarityStyle {
  return rarity && Object.prototype.hasOwnProperty.call(RARITY_STYLES, rarity) ? RARITY_STYLES[rarity] : RARITY_STYLES.common;
}

/** The light under an item's preview, in its rarity's colour. */
export const plinthBackground = (style: RarityStyle) =>
  `radial-gradient(120% 95% at 50% 105%, ${style.light}, transparent 72%), #0d111b`;

/** How a band of the store looks: an era set's own backdrop, or the plain one. */
export interface BandStyle {
  accent: string;
  edge: string;
  backdrop: string;
  /** A set's emblem, drawn faintly behind its name. */
  emblem?: CosmeticGlyphName;
}

// Placed clear of the band's title and text, where the cards leave the backdrop showing.
const STARS = [
  'radial-gradient(1.5px 1.5px at 3% 62%, rgba(255, 255, 255, 0.8) 99%, transparent)',
  'radial-gradient(1px 1px at 12% 74%, rgba(203, 213, 225, 0.8) 99%, transparent)',
  'radial-gradient(1px 1px at 6% 90%, rgba(255, 255, 255, 0.7) 99%, transparent)',
  'radial-gradient(1.5px 1.5px at 17% 96%, rgba(224, 242, 254, 0.8) 99%, transparent)',
  'radial-gradient(1px 1px at 97% 4%, rgba(255, 255, 255, 0.7) 99%, transparent)',
  'radial-gradient(1px 1px at 58% 98%, rgba(203, 213, 225, 0.7) 99%, transparent)',
  'radial-gradient(1px 1px at 99% 94%, rgba(255, 255, 255, 0.7) 99%, transparent)',
].join(', ');

export const SET_STYLES: Readonly<Record<string, BandStyle>> = {
  // Marble and gold.
  imperium: {
    accent: '#eab308',
    edge: 'rgba(234, 179, 8, 0.30)',
    emblem: 'landmark',
    backdrop: [
      'radial-gradient(700px 260px at 0% 0%, rgba(234, 179, 8, 0.16), transparent 70%)',
      'linear-gradient(115deg, transparent 38%, rgba(255, 255, 255, 0.035) 40%, transparent 43%)',
      'linear-gradient(35deg, transparent 62%, rgba(255, 255, 255, 0.03) 63%, transparent 66%)',
      'linear-gradient(180deg, #1d1a14, #14120e)',
    ].join(', '),
  },
  // A sea chart's grid, in brass and blue.
  navigator: {
    accent: '#d6a55c',
    edge: 'rgba(96, 165, 250, 0.28)',
    emblem: 'compass',
    backdrop: [
      'radial-gradient(600px 260px at 0% 0%, rgba(59, 130, 246, 0.18), transparent 70%)',
      'repeating-linear-gradient(0deg, rgba(147, 197, 253, 0.05) 0 1px, transparent 1px 36px)',
      'repeating-linear-gradient(90deg, rgba(147, 197, 253, 0.05) 0 1px, transparent 1px 36px)',
      'linear-gradient(180deg, #0f1a2c, #0b1320)',
    ].join(', '),
  },
  // A starfield.
  orbital: {
    accent: '#38bdf8',
    edge: 'rgba(56, 189, 248, 0.28)',
    emblem: 'satellite',
    backdrop: [
      STARS,
      'radial-gradient(700px 280px at 0% 0%, rgba(56, 189, 248, 0.16), transparent 70%)',
      'linear-gradient(180deg, #080c1c, #05070f)',
    ].join(', '),
  },
};

/** Everything else for sale, and any set without a style of its own yet. */
export const PLAIN_BAND: BandStyle = {
  accent: '#c9a84c',
  edge: '#2d3448',
  backdrop: 'radial-gradient(600px 240px at 0% 0%, rgba(201, 168, 76, 0.08), transparent 70%), linear-gradient(180deg, #171c29, #121622)',
};

export const bandStyle = (setId: string | undefined): BandStyle =>
  (setId && Object.prototype.hasOwnProperty.call(SET_STYLES, setId) ? SET_STYLES[setId] : undefined) ?? PLAIN_BAND;
