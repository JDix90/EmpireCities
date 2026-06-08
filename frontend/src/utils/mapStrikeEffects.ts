/** Shared strike visuals for 2D map + globe territory flash. */

export type MapStrikeAbilityId =
  | 'atom_bomb'
  | 'nuclear_strike'
  | 'orbital_strike'
  | 'hypersonic_strike'
  | 'cyber_attack'
  | 'data_breach'
  | 'swarm_strike'
  | 'dyson_beam'
  | 'river_blockade'
  | 'air_strike'
  | 'longbowmen'
  | 'precision_airstrike'
  | 'chevauchee'
  | 'privateer';

export interface MapStrikeFlashProps {
  territoryId: string;
  abilityId: MapStrikeAbilityId;
  key: number;
}

export interface StrikeMapStyle {
  emoji: string;
  /** PIXI fill hex for 2D map territory pulse */
  fillHex: number;
  /** PIXI ring / border hex for 2D map pulse */
  ringHex: number;
  /** RGB components for globe polygon flash overlay */
  ringRgb: [number, number, number];
  /** Full-screen + map-local animation length (ms) */
  durationMs: number;
  /** How long the territory polygon stays highlighted on the map (ms) */
  mapFlashMs: number;
  /** When true, triggers AtomBombAnimation full-screen overlay */
  fullScreen: boolean;
}

export const STRIKE_MAP_STYLES: Record<MapStrikeAbilityId, StrikeMapStyle> = {
  atom_bomb: {
    emoji: '☢️',
    fillHex: 0xff4500,
    ringHex: 0xff2200,
    ringRgb: [255, 80, 0],
    durationMs: 5200,
    mapFlashMs: 4200,
    fullScreen: true,
  },
  nuclear_strike: {
    emoji: '☢️',
    fillHex: 0xffab40,
    ringHex: 0xff7043,
    ringRgb: [255, 171, 64],
    durationMs: 4000,
    mapFlashMs: 3200,
    fullScreen: true,
  },
  orbital_strike: {
    emoji: '🛰️',
    fillHex: 0x67e8f9,
    ringHex: 0x0891b2,
    ringRgb: [103, 232, 249],
    durationMs: 3600,
    mapFlashMs: 3000,
    fullScreen: true,
  },
  hypersonic_strike: {
    emoji: '🚀',
    fillHex: 0xfb923c,
    ringHex: 0xea580c,
    ringRgb: [251, 146, 60],
    durationMs: 3200,
    mapFlashMs: 2600,
    fullScreen: true,
  },
  cyber_attack: {
    emoji: '💻',
    fillHex: 0x22c55e,
    ringHex: 0x16a34a,
    ringRgb: [34, 197, 94],
    durationMs: 2400,
    mapFlashMs: 2000,
    fullScreen: false,
  },
  data_breach: {
    emoji: '🖥️',
    fillHex: 0x14532d,
    ringHex: 0x052e16,
    ringRgb: [20, 83, 45],
    durationMs: 2400,
    mapFlashMs: 2000,
    fullScreen: false,
  },
  swarm_strike: {
    emoji: '🐝',
    fillHex: 0xfb923c,
    ringHex: 0xea580c,
    ringRgb: [251, 146, 60],
    durationMs: 3800,
    mapFlashMs: 3000,
    fullScreen: true,
  },
  dyson_beam: {
    emoji: '☀️',
    fillHex: 0xfef08a,
    ringHex: 0xfacc15,
    ringRgb: [254, 240, 138],
    durationMs: 5500,
    mapFlashMs: 4500,
    fullScreen: true,
  },
  river_blockade: {
    emoji: '⚓',
    fillHex: 0x38bdf8,
    ringHex: 0x0284c7,
    ringRgb: [56, 189, 248],
    durationMs: 2600,
    mapFlashMs: 2200,
    fullScreen: false,
  },
  air_strike: {
    emoji: '✈️',
    fillHex: 0x94a3b8,
    ringHex: 0x64748b,
    ringRgb: [148, 163, 184],
    durationMs: 2400,
    mapFlashMs: 2000,
    fullScreen: false,
  },
  longbowmen: {
    emoji: '🏹',
    fillHex: 0xd97706,
    ringHex: 0xb45309,
    ringRgb: [217, 119, 6],
    durationMs: 2200,
    mapFlashMs: 1800,
    fullScreen: false,
  },
  precision_airstrike: {
    emoji: '✈️',
    fillHex: 0x60a5fa,
    ringHex: 0x2563eb,
    ringRgb: [96, 165, 250],
    durationMs: 2600,
    mapFlashMs: 2100,
    fullScreen: false,
  },
  chevauchee: {
    emoji: '🐎',
    fillHex: 0xf97316,
    ringHex: 0xc2410c,
    ringRgb: [249, 115, 22],
    durationMs: 2400,
    mapFlashMs: 2000,
    fullScreen: false,
  },
  privateer: {
    emoji: '🏴‍☠️',
    fillHex: 0x1d4ed8,
    ringHex: 0x1e3a8a,
    ringRgb: [29, 78, 216],
    durationMs: 2300,
    mapFlashMs: 1900,
    fullScreen: false,
  },
};

const STRIKE_ABILITY_IDS = new Set<string>(Object.keys(STRIKE_MAP_STYLES));

export function isMapStrikeAbility(abilityId: string): abilityId is MapStrikeAbilityId {
  return STRIKE_ABILITY_IDS.has(abilityId);
}

export function isFullScreenStrikeAbility(abilityId: string): boolean {
  if (!isMapStrikeAbility(abilityId)) return false;
  return STRIKE_MAP_STYLES[abilityId].fullScreen;
}

export function isMapOnlyStrikeAbility(abilityId: string): boolean {
  return isMapStrikeAbility(abilityId) && !STRIKE_MAP_STYLES[abilityId].fullScreen;
}

export function getStrikeToastStyle(abilityId: MapStrikeAbilityId): {
  background: string;
  border: string;
  color: string;
} {
  switch (abilityId) {
    case 'orbital_strike':
      return { background: '#021018', border: '1px solid #0891b2', color: '#a5f3fc' };
    case 'hypersonic_strike':
    case 'swarm_strike':
      return { background: '#1a0a04', border: '1px solid #ea580c', color: '#fdba74' };
    case 'cyber_attack':
    case 'data_breach':
      return { background: '#021408', border: '1px solid #16a34a', color: '#86efac' };
    case 'dyson_beam':
      return { background: '#1a1500', border: '1px solid #ca8a04', color: '#fef08a' };
    case 'river_blockade':
      return { background: '#021018', border: '1px solid #0284c7', color: '#7dd3fc' };
    case 'air_strike':
    case 'precision_airstrike':
      return { background: '#0f172a', border: '1px solid #64748b', color: '#cbd5e1' };
    case 'longbowmen':
    case 'chevauchee':
      return { background: '#1a1004', border: '1px solid #b45309', color: '#fdba74' };
    case 'privateer':
      return { background: '#020617', border: '1px solid #1d4ed8', color: '#93c5fd' };
    case 'nuclear_strike':
      return { background: '#1a0000', border: '1px solid #7f1d1d', color: '#fca5a5' };
    case 'atom_bomb':
    default:
      return { background: '#1a0000', border: '1px solid #7f1d1d', color: '#fca5a5' };
  }
}
