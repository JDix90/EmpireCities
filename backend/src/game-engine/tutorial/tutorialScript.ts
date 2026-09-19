import type { GameMap } from '../../types';

/**
 * The tutorial board: **mainland Italy**, six territories drawn from real
 * Natural Earth provinces.
 *
 * This replaced "Tutorial Island" — six rectangles on a 20x20 canvas, floated
 * on empty mid-Atlantic ocean so nothing would contradict them. It taught the
 * rules and mis-sold the game: the tutorial is most players' first look at
 * Borderfall, and a board of coloured boxes says the whole game is boxes. Every
 * other board in the game has real coastlines.
 *
 * `admin1` carries Natural Earth `iso_3166_2` codes, which both renderers
 * resolve into real geometry: the globe unions the provinces directly
 * (`buildTerritoryGlobeGeometries`) and the 2D map projects the same union into
 * canvas space (`buildGeoLayout2d`). The source is
 * `frontend/public/geo/risorgimento_admin1.json`, already committed for the
 * Risorgimento era board and wired to this map id in
 * `useTerritoryGeoSources.ts` — no new asset, and the sparse 2.3MB CDN ne_50m
 * set (which has no Italian codes at all) is not fetched for this map.
 *
 * `polygon` and `geo_polygon` are simplified outlines of those same unions.
 * They are the fallback for when the admin-1 source fails to load, so the
 * board still reads as Italy rather than collapsing to rectangles.
 *
 * **The six territories split along the Apennine watershed** — Tyrrhenian west,
 * Adriatic east, each side running north, centre, south. All 93 mainland
 * provinces are claimed exactly once; Sicily and Sardinia are outside the
 * theatre. Every `connection` below is a border these territories really share
 * (verified against the source geometry), which is the point: a player who
 * knows Italy should not find the board disagreeing with them.
 *
 * NOTE: user-facing tutorial steps live in `frontend/src/tutorial/` (modular
 * lesson packs). GamePage drives progression; this file is map geometry only.
 * The opening position is `combinedTutorialScenario.ts`, which is written
 * against these territory ids.
 */
const TUT_W = 1200;
const TUT_H = 1282;

export function getTutorialMap(): GameMap {
  return {
    map_id: 'tutorial',
    name: 'The Italian Peninsula',
    era: 'ancient',
    canvas_width: TUT_W,
    canvas_height: TUT_H,
    /**
     * Mainland Italy spans lng 6.60..18.52, lat 37.92..47.09; these bounds add
     * a little sea on every side so no coast sits flush against the edge.
     *
     * The canvas aspect is not free. A degree of longitude at 42.5N covers
     * cos(42.5) ~= 0.737 of a degree of latitude, so the physical aspect of
     * this window is (12.7 x 0.737) / 10.0 = 0.936 — and the 2D map reads
     * canvas coordinates as square pixels. 1200 x 1282 matches that ratio, so
     * the peninsula is the same shape in both views. A square canvas here
     * would draw Italy a third too wide in 2D while the globe drew it right.
     */
    projection_bounds: {
      minLng: 6.2,
      maxLng: 18.9,
      minLat: 37.5,
      maxLat: 47.5,
    },
    globe_view: {
      lock_rotation: true,
      center_lat: 42.5,
      center_lng: 12.55,
      /**
       * Altitude is in globe radii; the visible vertical window runs roughly
       * `altitude x 54` degrees at three-globe's 50 degree FOV. 0.36 frames
       * ~19 degrees, so Italy's 9.6 degrees of latitude fills about half the
       * height. Do NOT chase a tighter frame with a smaller altitude: below
       * ~0.1 the camera is close enough that the polygon caps stop drawing and
       * only their side walls show.
       */
      altitude: 0.36,
    },
    territories: [
      {
        territory_id: 'tut_a1',
        name: 'Tuscany & Latium',
        region_id: 'tut_west',
        admin1: [
          'IT-MS', 'IT-LU', 'IT-PT', 'IT-PO', 'IT-FI', 'IT-PI', 'IT-LI', 'IT-AR',
          'IT-SI', 'IT-GR', 'IT-VT', 'IT-RI', 'IT-RM', 'IT-LT', 'IT-FR',
        ],
        polygon: [
          [410.0, 583.4], [408.9, 545.2], [389.0, 513.7], [378.9, 459.0],
          [329.5, 402.0], [343.6, 387.7], [445.9, 440.0], [493.1, 419.0],
          [524.0, 432.0], [515.1, 449.9], [530.0, 471.0], [581.9, 484.2],
          [551.6, 522.9], [568.3, 539.1], [540.8, 559.2], [541.4, 614.2],
          [570.3, 622.0], [598.4, 657.9], [669.2, 610.2], [677.4, 630.0],
          [660.1, 629.8], [654.7, 649.2], [677.2, 681.4], [651.4, 682.9],
          [644.8, 700.2], [676.6, 727.0], [726.8, 740.5], [737.9, 766.0],
          [718.6, 800.7], [646.8, 804.1], [531.7, 700.7], [515.7, 669.3],
          [463.7, 655.0], [468.5, 632.8], [428.1, 602.0], [431.2, 587.4],
          [410.0, 583.4],
        ],
        center_point: [484.7, 597.0],
        geo_polygon: [
          [10.539, 42.949], [10.528, 43.247], [10.317, 43.493], [10.21, 43.92],
          [9.687, 44.364], [9.836, 44.476], [10.919, 44.068], [11.419, 44.232],
          [11.746, 44.13], [11.651, 43.991], [11.809, 43.826], [12.358, 43.723],
          [12.038, 43.421], [12.215, 43.295], [11.923, 43.138], [11.93, 42.709],
          [12.236, 42.648], [12.533, 42.368], [13.282, 42.74], [13.369, 42.586],
          [13.186, 42.587], [13.129, 42.436], [13.367, 42.185], [13.094, 42.173],
          [13.024, 42.038], [13.361, 41.829], [13.892, 41.724], [14.009, 41.525],
          [13.805, 41.254], [13.045, 41.228], [11.827, 42.034], [11.658, 42.279],
          [11.107, 42.391], [11.158, 42.564], [10.731, 42.804], [10.764, 42.918],
          [10.539, 42.949],
        ],
      },
      {
        territory_id: 'tut_a2',
        name: 'Campania & Calabria',
        region_id: 'tut_west',
        admin1: [
          'IT-CE', 'IT-BN', 'IT-NA', 'IT-AV', 'IT-SA', 'IT-PZ', 'IT-MT', 'IT-CS',
          'IT-CZ', 'IT-KR', 'IT-VV', 'IT-RC',
        ],
        polygon: [
          [890.5, 951.5], [856.2, 957.8], [823.1, 930.5], [831.3, 910.5],
          [813.5, 877.8], [769.4, 888.3], [780.6, 866.1], [741.5, 860.2],
          [712.8, 802.8], [724.0, 778.7], [746.8, 783.3], [758.1, 769.8],
          [792.6, 785.9], [831.0, 771.5], [857.5, 819.7], [912.6, 815.7],
          [964.7, 871.0], [993.6, 869.8], [995.1, 900.2], [1007.5, 911.4],
          [972.3, 990.3], [1035.5, 1037.7], [1039.9, 1086.0], [1030.3, 1102.6],
          [981.4, 1115.6], [979.0, 1164.6], [926.1, 1228.3], [894.4, 1222.1],
          [891.3, 1189.7], [917.0, 1157.1], [911.2, 1133.3], [940.4, 1124.2],
          [946.8, 1102.6], [890.5, 951.5],
        ],
        center_point: [941.5, 999.3],
        geo_polygon: [
          [15.624, 40.078], [15.261, 40.029], [14.911, 40.242], [14.998, 40.398],
          [14.81, 40.653], [14.343, 40.571], [14.461, 40.744], [14.048, 40.79],
          [13.744, 41.238], [13.862, 41.426], [14.104, 41.39], [14.223, 41.495],
          [14.588, 41.37], [14.995, 41.482], [15.275, 41.106], [15.858, 41.137],
          [16.41, 40.706], [16.716, 40.715], [16.731, 40.478], [16.863, 40.391],
          [16.49, 39.775], [17.159, 39.406], [17.206, 39.029], [17.104, 38.899],
          [16.586, 38.798], [16.561, 38.416], [16.001, 37.919], [15.666, 37.967],
          [15.633, 38.22], [15.905, 38.474], [15.844, 38.66], [16.153, 38.731],
          [16.22, 38.899], [15.624, 40.078],
        ],
      },
      {
        territory_id: 'tut_a3',
        name: 'Lombardy & Piedmont',
        region_id: 'tut_west',
        admin1: [
          'IT-AO', 'IT-TO', 'IT-CN', 'IT-AT', 'IT-AL', 'IT-BI', 'IT-VC', 'IT-NO',
          'IT-VB', 'IT-IM', 'IT-SV', 'IT-GE', 'IT-SP', 'IT-MI', 'IT-MB', 'IT-VA',
          'IT-CO', 'IT-LC', 'IT-SO', 'IT-BG', 'IT-BS', 'IT-PV', 'IT-LO', 'IT-CR',
          'IT-MN',
        ],
        polygon: [
          [125.8, 476.4], [137.6, 426.1], [106.9, 432.7], [62.9, 401.0],
          [76.3, 343.3], [38.1, 307.3], [80.8, 293.1], [90.8, 267.8],
          [55.1, 218.6], [155.3, 202.7], [202.5, 135.4], [264.8, 215.2],
          [291.2, 128.6], [366.2, 164.1], [367.4, 114.9], [401.8, 122.2],
          [419.4, 139.6], [408.5, 212.7], [438.9, 213.6], [419.9, 242.3],
          [424.9, 279.5], [493.1, 324.7], [304.7, 307.6], [283.7, 370.0],
          [361.7, 442.4], [242.1, 393.3], [176.5, 461.9], [125.8, 476.4],
        ],
        center_point: [260.5, 294.2],
        geo_polygon: [
          [7.531, 43.784], [7.656, 44.176], [7.331, 44.125], [6.866, 44.372],
          [7.007, 44.822], [6.603, 45.103], [7.055, 45.214], [7.161, 45.411],
          [6.783, 45.795], [7.844, 45.919], [8.343, 46.444], [9.002, 45.821],
          [9.282, 46.497], [10.076, 46.22], [10.088, 46.604], [10.452, 46.547],
          [10.639, 46.411], [10.523, 45.841], [10.845, 45.834], [10.644, 45.61],
          [10.697, 45.32], [11.419, 44.967], [9.425, 45.101], [9.203, 44.614],
          [10.028, 44.049], [8.762, 44.432], [8.068, 43.897], [7.531, 43.784],
        ],
      },
      {
        territory_id: 'tut_b1',
        name: 'Umbria & Abruzzo',
        region_id: 'tut_east',
        admin1: [
          'IT-PG', 'IT-TR', 'IT-PU', 'IT-AN', 'IT-MC', 'IT-FM', 'IT-AP', 'IT-AQ',
          'IT-TE', 'IT-PE', 'IT-CH', 'IT-CB', 'IT-IS',
        ],
        polygon: [
          [667.8, 609.6], [598.4, 657.9], [570.3, 622.0], [541.2, 613.7],
          [540.8, 559.2], [568.3, 539.1], [551.6, 522.9], [593.7, 457.8],
          [611.1, 468.8], [624.0, 452.9], [700.7, 505.1], [744.1, 628.3],
          [807.0, 694.2], [845.1, 713.9], [846.5, 742.8], [825.4, 753.3],
          [824.6, 775.4], [792.6, 785.9], [748.4, 769.7], [740.3, 782.5],
          [726.8, 740.5], [676.6, 727.0], [644.8, 700.2], [651.4, 682.9],
          [677.2, 681.4], [654.7, 648.1], [679.0, 622.5], [667.8, 609.6],
        ],
        center_point: [611.1, 618.9],
        geo_polygon: [
          [13.268, 42.745], [12.533, 42.368], [12.236, 42.648], [11.928, 42.713],
          [11.923, 43.138], [12.215, 43.295], [12.038, 43.421], [12.483, 43.929],
          [12.668, 43.843], [12.804, 43.967], [13.616, 43.56], [14.075, 42.599],
          [14.741, 42.085], [15.144, 41.931], [15.159, 41.706], [14.936, 41.624],
          [14.927, 41.452], [14.588, 41.37], [14.121, 41.496], [14.035, 41.396],
          [13.892, 41.724], [13.361, 41.829], [13.024, 42.038], [13.094, 42.173],
          [13.367, 42.185], [13.129, 42.445], [13.386, 42.644], [13.268, 42.745],
        ],
      },
      {
        territory_id: 'tut_b2',
        name: 'Apulia',
        region_id: 'tut_east',
        admin1: [
          'IT-FG', 'IT-BT', 'IT-BA', 'IT-TA', 'IT-BR', 'IT-LE',
        ],
        polygon: [
          [1115.6, 878.0], [1163.7, 943.7], [1149.7, 987.5], [1121.8, 972.8],
          [1102.0, 924.8], [1068.9, 922.5], [1039.4, 907.7], [1051.0, 897.7],
          [1025.2, 895.0], [1007.5, 911.4], [995.1, 900.2], [991.7, 867.4],
          [964.7, 871.0], [944.6, 844.7], [924.5, 839.3], [928.9, 831.1],
          [912.6, 815.7], [884.3, 826.2], [857.5, 819.7], [850.4, 812.9],
          [856.3, 801.5], [838.6, 791.0], [840.7, 778.7], [825.4, 765.9],
          [825.3, 753.8], [846.3, 743.3], [841.2, 735.4], [845.1, 713.9],
          [939.2, 715.4], [943.4, 733.3], [916.5, 754.5], [922.3, 774.5],
          [1039.7, 830.6], [1065.4, 855.1], [1115.6, 878.0],
        ],
        center_point: [1003.9, 850.0],
        geo_polygon: [
          [18.007, 40.651], [18.516, 40.139], [18.368, 39.797], [18.072, 39.912],
          [17.863, 40.286], [17.512, 40.304], [17.2, 40.42], [17.323, 40.498],
          [17.05, 40.519], [16.863, 40.391], [16.731, 40.478], [16.695, 40.734],
          [16.41, 40.706], [16.197, 40.911], [15.984, 40.953], [16.031, 41.017],
          [15.858, 41.137], [15.559, 41.055], [15.275, 41.106], [15.2, 41.159],
          [15.262, 41.248], [15.075, 41.33], [15.097, 41.426], [14.935, 41.526],
          [14.934, 41.62], [15.157, 41.702], [15.103, 41.764], [15.144, 41.931],
          [16.14, 41.92], [16.184, 41.78], [15.9, 41.615], [15.961, 41.459],
          [17.203, 41.021], [17.476, 40.83], [18.007, 40.651],
        ],
      },
      {
        territory_id: 'tut_b3',
        name: 'Veneto & Emilia',
        region_id: 'tut_east',
        admin1: [
          'IT-BZ', 'IT-TN', 'IT-BL', 'IT-TV', 'IT-VE', 'IT-PD', 'IT-VI', 'IT-VR',
          'IT-RO', 'IT-UD', 'IT-PN', 'IT-GO', 'IT-TS', 'IT-PC', 'IT-PR', 'IT-RE',
          'IT-MO', 'IT-BO', 'IT-FE', 'IT-RA', 'IT-FC', 'IT-RN',
        ],
        polygon: [
          [574.5, 380.5], [619.3, 452.3], [612.3, 468.6], [593.6, 450.9],
          [575.1, 478.3], [545.1, 477.8], [520.5, 463.4], [523.6, 431.8],
          [412.9, 432.5], [353.0, 388.4], [306.1, 395.9], [311.0, 377.5],
          [283.6, 361.3], [316.8, 303.2], [408.3, 331.3], [493.4, 326.9],
          [424.9, 279.5], [419.9, 242.3], [438.9, 213.6], [408.5, 212.7],
          [419.4, 139.6], [393.9, 106.1], [402.0, 81.5], [453.3, 93.7],
          [470.0, 68.7], [565.1, 53.2], [560.0, 75.8], [586.3, 103.8],
          [708.8, 125.6], [677.0, 155.1], [702.7, 169.2], [686.2, 191.5],
          [727.1, 239.5], [653.8, 221.5], [577.3, 257.8], [562.1, 283.1],
          [598.5, 324.3], [573.2, 342.7], [574.5, 380.5],
        ],
        center_point: [498.4, 267.3],
        geo_polygon: [
          [12.28, 44.532], [12.754, 43.972], [12.68, 43.845], [12.482, 43.983],
          [12.286, 43.769], [11.969, 43.773], [11.709, 43.885], [11.741, 44.132],
          [10.57, 44.126], [9.936, 44.47], [9.44, 44.412], [9.491, 44.555],
          [9.201, 44.682], [9.553, 45.135], [10.521, 44.916], [11.422, 44.95],
          [10.697, 45.32], [10.644, 45.61], [10.845, 45.834], [10.523, 45.841],
          [10.639, 46.411], [10.369, 46.672], [10.454, 46.864], [10.997, 46.769],
          [11.174, 46.964], [12.181, 47.085], [12.127, 46.909], [12.405, 46.69],
          [13.701, 46.52], [13.365, 46.29], [13.637, 46.18], [13.462, 46.006],
          [13.895, 45.632], [13.119, 45.772], [12.31, 45.489], [12.149, 45.292],
          [12.534, 44.97], [12.266, 44.827], [12.28, 44.532],
        ],
      },
    ],
    /**
     * Every edge is a border the two territories really share, checked against
     * the province unions rather than asserted. The teaching shape the authored
     * opening needs survives the move off the invented island:
     *
     *  - each realm is internally connected, so fortifying within it works;
     *  - `tut_b1` (Umbria & Abruzzo) is the eastern hub — it alone touches both
     *    other Adriatic lands, so taking it puts the player next to everything;
     *  - every human territory has a front, so no seat is a spectator.
     *
     * The last two pairs are the ones real geography adds and the old grid
     * could not have: Tuscany reaches Emilia over the Apennine crest, and
     * Campania meets Molise. They give `tut_a1` and `tut_a2` a second front
     * each, which widens the opening rather than complicating it — more than
     * one live line is what makes the first attack a decision. The authored
     * scenario prices both extras as secondary (see
     * `combinedTutorialScenario.ts`).
     */
    connections: [
      { from: 'tut_a1', to: 'tut_a2', type: 'land' },
      { from: 'tut_a1', to: 'tut_a3', type: 'land' },
      { from: 'tut_a1', to: 'tut_b1', type: 'land' },
      { from: 'tut_a2', to: 'tut_b2', type: 'land' },
      { from: 'tut_a3', to: 'tut_b3', type: 'land' },
      { from: 'tut_b1', to: 'tut_b2', type: 'land' },
      { from: 'tut_b1', to: 'tut_b3', type: 'land' },
      { from: 'tut_a1', to: 'tut_b3', type: 'land' },
      { from: 'tut_a2', to: 'tut_b1', type: 'land' },
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
      { region_id: 'tut_west', name: 'Tyrrhenian Coast', bonus: 3 },
      { region_id: 'tut_east', name: 'Adriatic Coast', bonus: 3 },
    ],
  };
}
