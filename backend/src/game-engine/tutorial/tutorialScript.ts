import type { GameMap } from '../../types';

/**
 * Tutorial map: all territory `polygon` coords live in a fixed 20×20 canvas.
 * `projection_bounds` maps that canvas to WGS84 so the 2D view and globe share one layout.
 * (Previously coords were ad-hoc negatives with no bounds; the globe used a full-world
 * fallback and produced broken / spiky caps — see `canvasToGeoJSONWorld` vs regional in
 * `globeTerritoryGeometry.ts`.)
 *
 * NOTE: user-facing tutorial steps live in `frontend/src/tutorial/` (modular
 * lesson packs). GamePage drives progression; this file is map geometry only.
 */
const TUT_W = 20;
const TUT_H = 20;

export function getTutorialMap(): GameMap {
  return {
    map_id: 'tutorial',
    name: 'Tutorial Island',
    era: 'ancient',
    canvas_width: TUT_W,
    canvas_height: TUT_H,
    /**
     * Mid-Atlantic (west of Azores): open ocean, clean globe backdrop, no country seams.
     *
     * Two things the original 2.4° × 4.0° bounds got wrong, both only visible
     * once the map was actually rendered:
     *
     *  - Aspect: a degree of longitude at 37.5°N covers cos(37.5°) ≈ 0.793 of a
     *    degree of latitude, so a square 20×20 canvas needs Δlat = Δlng × 0.793.
     *    The old span squashed the island to about half its width on the globe
     *    while the 2D view — which reads canvas coordinates directly — drew it
     *    square, so the two views disagreed about the shape of the map.
     *  - Scale: a ~4° theater is a thumbnail on a globe. Nothing anchors this
     *    fictional island to a size, so it is drawn continent-scale (14° × 11°)
     *    and framed at a normal altitude, rather than shrunk and chased with a
     *    camera close enough to break polygon-cap rendering.
     */
    projection_bounds: {
      minLng: -34.4,
      maxLng: -20.4,
      minLat: 32.0,
      maxLat: 43.0,
    },
    globe_view: {
      lock_rotation: true,
      center_lat: 37.5,
      center_lng: -27.4,
      /**
       * Altitude is in globe radii; the visible vertical window runs roughly
       * `altitude × 54°` at three-globe's 50° FOV. 0.42 frames ~23°, so the
       * island's 11° fills about half the height. Do NOT chase a smaller theater
       * with a smaller altitude: below ~0.1 the camera is close enough that the
       * polygon caps stop drawing and only their side walls show.
       */
      altitude: 0.42,
    },
    territories: [
      {
        territory_id: 'tut_a1',
        name: 'Western Plains',
        polygon: [
          [0, 10],
          [10, 15],
          [10, 5],
          [0, 5],
        ],
        center_point: [5, 10],
        region_id: 'tut_west',
      },
      {
        territory_id: 'tut_a2',
        name: 'Southern Coast',
        polygon: [
          [0, 15],
          [10, 20],
          [10, 15],
          [0, 10],
        ],
        center_point: [5, 15],
        region_id: 'tut_west',
      },
      {
        territory_id: 'tut_a3',
        name: 'Northern Hills',
        polygon: [
          [0, 5],
          [10, 5],
          [10, 0],
          [0, 0],
        ],
        center_point: [5, 2.5],
        region_id: 'tut_west',
      },
      {
        territory_id: 'tut_b1',
        name: 'Eastern Forest',
        polygon: [
          [10, 10],
          [20, 15],
          [20, 5],
          [10, 5],
        ],
        center_point: [15, 10],
        region_id: 'tut_east',
      },
      {
        territory_id: 'tut_b2',
        name: 'Mountain Pass',
        polygon: [
          [10, 15],
          [20, 20],
          [20, 15],
          [10, 10],
        ],
        center_point: [15, 15],
        region_id: 'tut_east',
      },
      {
        territory_id: 'tut_b3',
        name: 'Desert Outpost',
        polygon: [
          [10, 5],
          [20, 5],
          [20, 0],
          [10, 0],
        ],
        center_point: [15, 2.5],
        region_id: 'tut_east',
      },
    ],
    connections: [
      { from: 'tut_a1', to: 'tut_a2', type: 'land' },
      { from: 'tut_a1', to: 'tut_a3', type: 'land' },
      { from: 'tut_a1', to: 'tut_b1', type: 'land' },
      { from: 'tut_a2', to: 'tut_b2', type: 'land' },
      { from: 'tut_a3', to: 'tut_b3', type: 'land' },
      { from: 'tut_b1', to: 'tut_b2', type: 'land' },
      { from: 'tut_b1', to: 'tut_b3', type: 'land' },
    ],
    /**
     * Bonus 3, not 2: continent bonuses scale by player count
     * (`floor(bonus × clamp(players,2,12) / 6)`, see `calculateReinforcements`),
     * and this map is only ever played 1v1 — at 2 players a bonus of 2 rounds
     * to **+0**, so the realm labels read "+0" and holding a whole realm paid
     * nothing. 3 is the smallest value that survives the scaling, giving the
     * +1 the tutorial's draft step points at.
     */
    regions: [
      { region_id: 'tut_west', name: 'Western Realm', bonus: 3 },
      { region_id: 'tut_east', name: 'Eastern Realm', bonus: 3 },
    ],
  };
}
