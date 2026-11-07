/**
 * Regional maps (single continent / theater) should keep the globe fixed and framed
 * so players are not distracted by idle rotation when the whole theater is in view.
 */

export interface GlobeViewConfig {
  lock_rotation?: boolean;
  center_lat?: number;
  center_lng?: number;
  /** Camera distance — lower = more zoomed in (react-globe.gl altitude) */
  altitude?: number;
}

export interface DerivedRegionalGlobe {
  lockRotation: boolean;
  centerLat: number;
  centerLng: number;
  altitude: number;
}

/** Max spans (degrees) for auto “regional” lock when globe_view is absent */
const AUTO_LOCK_MAX_LAT_SPAN = 40;
const AUTO_LOCK_MAX_LNG_SPAN = 65;

export function deriveRegionalGlobeView(
  globeView: GlobeViewConfig | undefined,
  centers: Map<string, { lat: number; lng: number }>,
): DerivedRegionalGlobe {
  const explicitCenter =
    globeView &&
    globeView.center_lat != null &&
    globeView.center_lng != null;

  if (explicitCenter) {
    return {
      lockRotation: globeView!.lock_rotation !== false,
      centerLat: globeView!.center_lat!,
      centerLng: globeView!.center_lng!,
      altitude: globeView!.altitude ?? 1.55,
    };
  }

  if (centers.size === 0) {
    return {
      lockRotation: false,
      centerLat: 15,
      centerLng: 0,
      altitude: 2.4,
    };
  }

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const c of centers.values()) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLng = Math.min(minLng, c.lng);
    maxLng = Math.max(maxLng, c.lng);
  }

  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const fitsRegionalViewport =
    latSpan <= AUTO_LOCK_MAX_LAT_SPAN && lngSpan <= AUTO_LOCK_MAX_LNG_SPAN;

  const lockRotation =
    globeView?.lock_rotation === true ||
    (globeView?.lock_rotation !== false && fitsRegionalViewport);

  const span = Math.max(latSpan, lngSpan * 0.52);
  const autoAltitude = Math.min(2.75, Math.max(1.2, 1.05 + span * 0.038));

  return {
    lockRotation,
    centerLat,
    centerLng,
    altitude: globeView?.altitude ?? autoAltitude,
  };
}

/**
 * The camera config for the world on screen. On a galaxy map the focused
 * world's authored `globe_view` wins, so each world opens on its own landmark;
 * every other map (and a galaxy world without one) keeps the map-level view.
 */
export function resolveActiveGlobeView(
  mapData: {
    map_kind?: string;
    globe_view?: GlobeViewConfig;
    worlds?: Array<{ world_id: string; globe_view?: GlobeViewConfig }>;
  },
  activeWorldId: string,
): GlobeViewConfig | undefined {
  if (mapData.map_kind !== 'galaxy') return mapData.globe_view;
  return mapData.worlds?.find((w) => w.world_id === activeWorldId)?.globe_view ?? mapData.globe_view;
}

/** A board's authored lat/lng box (`projection_bounds`). */
export interface BoardBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** globe.gl's camera: three.js's default perspective camera, 50° vertical. */
const CAMERA_VERTICAL_FOV_DEG = 50;
/** The closest the opening view comes, well clear of the camera's near plane. */
const MIN_FITTED_ALTITUDE = 0.12;

/**
 * The camera altitude at which a board's bounds fill `fill` of a canvas this
 * size, looking straight down on the middle of the box. Each half-span is an
 * arc on the sphere seen from a camera `1 + altitude` globe radii from its
 * centre: an arc of θ subtends `atan(sin θ / (d − cos θ))`, so it fits a half
 * field of view φ once `d ≥ cos θ + sin θ / tan φ`. The horizontal field of
 * view is the vertical one times the canvas's width over its height.
 */
export function altitudeToFitBounds(bounds: BoardBounds, width: number, height: number, fill = 0.85): number {
  const halfVertical = Math.tan((CAMERA_VERTICAL_FOV_DEG / 2) * (Math.PI / 180));
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latArc = ((bounds.maxLat - bounds.minLat) / 2) * (Math.PI / 180);
  const lngArc = ((bounds.maxLng - bounds.minLng) / 2) * (Math.PI / 180) * Math.cos(centerLat * (Math.PI / 180));
  const need = (arc: number, halfTan: number) => Math.cos(arc) + Math.sin(arc) / (fill * halfTan) - 1;
  return Math.max(need(latArc, halfVertical), need(lngArc, halfVertical * (width / height)));
}

/**
 * The opening view of a fixed regional board on a canvas this size
 * (`fit_board_camera_enabled`): centred on the board and zoomed in until it
 * fills the view, so its territories are big enough to tap. Only ever closer
 * than the authored view: a board wider than a portrait phone keeps its
 * authored framing rather than shrinking every territory to fit.
 */
export function fitRegionalView(
  view: DerivedRegionalGlobe,
  bounds: BoardBounds,
  width: number,
  height: number,
): DerivedRegionalGlobe {
  if (width <= 0 || height <= 0 || bounds.maxLng <= bounds.minLng || bounds.maxLat <= bounds.minLat) return view;
  const fitted = Math.max(MIN_FITTED_ALTITUDE, altitudeToFitBounds(bounds, width, height));
  if (fitted >= view.altitude) return view;
  return {
    ...view,
    centerLat: (bounds.minLat + bounds.maxLat) / 2,
    centerLng: (bounds.minLng + bounds.maxLng) / 2,
    altitude: fitted,
  };
}
