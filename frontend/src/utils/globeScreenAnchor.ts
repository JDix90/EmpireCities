/**
 * Where a point on a globe shows on screen, for drawing beside the globe what
 * it cannot draw itself: Split's lanes run between globes
 * (components/game/GalaxySplitView.tsx).
 *
 * A point the camera can see shows where the globe draws it. A point around
 * the back shows on the planet's edge, where it would come into view if the
 * globe were turned toward it, so a line drawn to it meets the planet at the
 * side the player turns it to follow the line.
 */

/** The camera, as react-globe.gl's `pointOfView()` reports it. */
export interface GeoPointOfView {
  /** The point under the camera. */
  lat: number;
  lng: number;
  /** The camera's height above the surface, in globe radii. */
  altitude: number;
}

export interface ScreenAnchor {
  x: number;
  y: number;
  /** Around the back of the globe: (x, y) is the planet's edge, where it would come into view. */
  behind?: boolean;
}

const RAD = Math.PI / 180;

/** The angle between two points on the sphere, in radians. */
export function centralAngle(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const p1 = aLat * RAD;
  const p2 = bLat * RAD;
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos((bLng - aLng) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/**
 * How far round the sphere a viewer at `altitude` (in radii) sees: from the
 * point beneath them to their horizon, in radians.
 */
export function horizonAngle(altitude: number): number {
  return Math.acos(1 / (1 + Math.max(0, altitude)));
}

/**
 * Where the point at (`lat`, `lng`), raised `altitude` radii, shows for the
 * camera at `pov`. `project` is the globe's own projection to canvas pixels
 * (react-globe.gl's `getScreenCoords`).
 *
 * A raised point stays in sight a little past the surface's horizon: the line
 * from the camera grazes the surface there and climbs, so the two horizons
 * add up.
 */
export function globeScreenAnchor(
  lat: number,
  lng: number,
  pov: GeoPointOfView,
  project: (lat: number, lng: number, altitude: number) => { x: number; y: number },
  altitude = 0,
): ScreenAnchor {
  const horizon = horizonAngle(pov.altitude);
  if (centralAngle(pov.lat, pov.lng, lat, lng) <= horizon + horizonAngle(altitude)) {
    const { x, y } = project(lat, lng, altitude);
    return { x, y };
  }
  // From the point under the camera toward this one, as far as the horizon.
  const p1 = pov.lat * RAD;
  const l1 = pov.lng * RAD;
  const p2 = lat * RAD;
  const dl = (lng - pov.lng) * RAD;
  const bearing = Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  );
  const edgeLat = Math.asin(
    Math.sin(p1) * Math.cos(horizon) + Math.cos(p1) * Math.sin(horizon) * Math.cos(bearing),
  );
  const edgeLng = l1 + Math.atan2(
    Math.sin(bearing) * Math.sin(horizon) * Math.cos(p1),
    Math.cos(horizon) - Math.sin(p1) * Math.sin(edgeLat),
  );
  const { x, y } = project(edgeLat / RAD, ((edgeLng / RAD + 540) % 360) - 180, 0);
  return { x, y, behind: true };
}
