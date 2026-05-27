/** Minimal map fixture for /__map-visual-lab — three adjacent territories, two players. */
export const MAP_VISUAL_LAB_FIXTURE = {
  canvas_width: 600,
  canvas_height: 400,
  map_id: 'map-visual-lab',
  map_kind: 'standard' as const,
  projection_bounds: {
    minLng: -10,
    maxLng: 20,
    minLat: 40,
    maxLat: 55,
  },
  territories: [
    {
      territory_id: 'lab_t1',
      name: 'Alpha',
      region_id: 'lab_region',
      polygon: [[50, 50], [250, 50], [250, 180], [50, 180]],
      center_point: [150, 115] as [number, number],
      geo_polygon: [[0, 50], [10, 50], [10, 52], [0, 52]] as [number, number][],
    },
    {
      territory_id: 'lab_t2',
      name: 'Beta',
      region_id: 'lab_region',
      polygon: [[260, 50], [460, 50], [460, 180], [260, 180]],
      center_point: [360, 115] as [number, number],
      geo_polygon: [[11, 50], [20, 50], [20, 52], [11, 52]] as [number, number][],
    },
    {
      territory_id: 'lab_t3',
      name: 'Gamma',
      region_id: 'lab_region',
      polygon: [[150, 200], [350, 200], [350, 350], [150, 350]],
      center_point: [250, 275] as [number, number],
      geo_polygon: [[5, 48], [15, 48], [15, 46], [5, 46]] as [number, number][],
    },
  ],
  connections: [
    { from: 'lab_t1', to: 'lab_t2', type: 'land' as const },
    { from: 'lab_t1', to: 'lab_t3', type: 'land' as const },
    { from: 'lab_t2', to: 'lab_t3', type: 'land' as const },
  ],
  regions: [{ region_id: 'lab_region', name: 'Lab Region', bonus: 2 }],
};

export const MAP_VISUAL_LAB_PLAYERS = [
  { player_id: 'lab_p1', color: '#e74c3c' },
  { player_id: 'lab_p2', color: '#3498db' },
];

/** Canned payloads matching production game:map_visual shapes. */
export function labPayload(kind: string): Record<string, unknown> {
  const base = {
    territoryId: 'lab_t1',
    playerId: 'lab_p1',
    playerColor: '#e74c3c',
    defenderColor: '#3498db',
    attackerColor: '#e74c3c',
  };

  switch (kind) {
    case 'reinforce':
      return { kind: 'reinforce', ...base, units: 3, totalAfter: 6 };
    case 'combat':
      return { kind: 'combat', ...base, defenderLosses: 2 };
    case 'capture':
      return {
        kind: 'capture',
        ...base,
        captured: true,
        newOwnerColor: '#e74c3c',
      };
    case 'fortify':
      return {
        kind: 'fortify',
        territoryId: 'lab_t1',
        fromTerritoryId: 'lab_t2',
        units: 2,
        playerColor: '#e74c3c',
      };
    case 'naval':
      return {
        kind: 'naval',
        territoryId: 'lab_t2',
        fromTerritoryId: 'lab_t1',
        attackerColor: '#e74c3c',
        defenderColor: '#3498db',
        attackerLosses: 1,
        defenderLosses: 2,
        captured: true,
      };
    case 'influence':
      return {
        kind: 'influence',
        ...base,
        newOwnerColor: '#e74c3c',
        captured: true,
        variant: 'seize',
      };
    case 'influence_blocked':
      return {
        kind: 'influence',
        ...base,
        captured: false,
        variant: 'blocked',
      };
    case 'strike':
      return {
        kind: 'strike',
        territoryId: 'lab_t1',
        fromTerritoryId: 'lab_t2',
        variant: 'air_strike',
        unitReduction: 1,
        attackerColor: '#e74c3c',
        defenderColor: '#3498db',
      };
    case 'event':
      return {
        kind: 'event',
        territoryId: 'lab_t1',
        variant: 'region_disaster',
        cardId: 'plague',
        global: true,
      };
    default:
      return { kind: 'combat', ...base, defenderLosses: 1 };
  }
}
