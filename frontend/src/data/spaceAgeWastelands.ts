/**
 * Space Age (2100 AD) — Decorative Earth wasteland zones.
 *
 * The Earth map intentionally leaves a few large land/sea expanses without
 * playable territories (Greenland interior, central Sahara, Bering Strait,
 * Madagascar quarantine). Rather than letting them read as "empty", we
 * render each as a non-interactive immersive marker — a glowing blast scar
 * with a pulsing radiation ring and a flavor label. This keeps the map
 * narrative rich while preserving the actual playable territory roster.
 *
 * Coordinates use WGS84 lat/lng. Rings auto-animate via the existing
 * GlobeMap `ringsData` system; the label is an HTML overlay tied to the
 * ring center.
 */

export type WastelandKind =
  | 'meteor'
  | 'nuclear'
  | 'biological'
  | 'climate'
  | 'mass_driver';

export interface SpaceAgeWasteland {
  id: string;
  lat: number;
  lng: number;
  name: string;
  /** Short flavor blurb shown on hover. */
  description: string;
  kind: WastelandKind;
  /** Visual ring radius (degrees of great-circle arc, 0–2 typical). */
  radius: number;
  /** Pulse repeat period in ms (longer = slower, more ominous). */
  periodMs: number;
}

/**
 * Coordinates target Earth landmasses that fall outside any playable
 * territory after the Pass-2 polygon clean-up:
 *  - East-central Greenland (north of na_arctic_dominion's lng -60 stop)
 *  - The Russian Far East / Kamchatka coast (east of asia_siberia_belt)
 *  - Madagascar (east of africa_south, south of the Arabian band)
 *
 * They are non-interactive ambient atmosphere markers, not gameplay
 * territories — no income, no garrison, no claim path.
 */
export const SPACE_AGE_WASTELANDS: SpaceAgeWasteland[] = [
  {
    id: 'wastel_greenland',
    lat: 73,
    lng: -25,
    name: 'Greenland Desolation',
    description:
      'Ice-sheet collapse in the 2060s left a methane-saturated permafrost flat that no climate compact has reclaimed.',
    kind: 'climate',
    radius: 1.4,
    periodMs: 3200,
  },
  {
    id: 'wastel_kamchatka',
    lat: 62,
    lng: 168,
    name: 'Kamchatka Mass-Driver Crater',
    description:
      'Abandoned orbital mass-driver impact site — the launch authority went silent in 2089 and never re-armed.',
    kind: 'mass_driver',
    radius: 1.3,
    periodMs: 2400,
  },
  {
    id: 'wastel_madagascar',
    lat: -19,
    lng: 47,
    name: 'Madagascar Quarantine Zone',
    description:
      'Bioweapon containment perimeter held since the 2068 outbreak. Civilian transit is permanently revoked.',
    kind: 'biological',
    radius: 1.1,
    periodMs: 2800,
  },
];

const KIND_TO_COLOR_RGB: Record<WastelandKind, [number, number, number]> = {
  meteor: [255, 140, 60],
  nuclear: [255, 80, 60],
  biological: [120, 220, 110],
  climate: [180, 220, 255],
  mass_driver: [255, 200, 80],
};

const KIND_TO_GLYPH: Record<WastelandKind, string> = {
  meteor: '☄',
  nuclear: '☢',
  biological: '☣',
  climate: '❄',
  mass_driver: '✦',
};

export function wastelandColorRgb(kind: WastelandKind): [number, number, number] {
  return KIND_TO_COLOR_RGB[kind];
}

export function wastelandColorRgba(kind: WastelandKind, alpha: number): string {
  const [r, g, b] = KIND_TO_COLOR_RGB[kind];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function wastelandGlyph(kind: WastelandKind): string {
  return KIND_TO_GLYPH[kind];
}
