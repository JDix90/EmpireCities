/** Inputs needed to score how crowded a map is for click targeting. */
export interface MapDensityInput {
  territories: Array<{
    territory_id: string;
    polygon: number[][];
    center_point: [number, number];
    region_id?: string;
  }>;
  connections: Array<{ from: string; to: string }>;
  canvas_width?: number;
  canvas_height?: number;
}

export interface MapDensityMetrics {
  territoryCount: number;
  landTerritoryCount: number;
  medianPolygonArea: number;
  medianNeighborCenterDistance: number;
  connectionsPerTerritory: number;
  /** Normalized 0–1; higher means harder to click individual territories. */
  densityScore: number;
  isDense: boolean;
}

function polygonAreaCanvas(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    area += ring[i][0] * ring[j][1];
    area -= ring[j][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function dist(
  a: [number, number],
  b: [number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

/** Score map click density; used to auto-switch connection hint rendering. */
export function computeMapDensityMetrics(input: MapDensityInput): MapDensityMetrics {
  const canvasW = input.canvas_width ?? 1000;
  const canvasH = input.canvas_height ?? 700;
  const diagonal = Math.hypot(canvasW, canvasH);

  const landTerritories = input.territories.filter((t) => t.region_id !== 'sea_routes');
  const territoryCount = input.territories.length;
  const landTerritoryCount = landTerritories.length;

  const polygonAreas = landTerritories
    .map((t) => polygonAreaCanvas(t.polygon))
    .filter((a) => a > 0);
  const medianPolygonArea = median(polygonAreas);

  const centerById = new Map(
    landTerritories.map((t) => [t.territory_id, t.center_point] as const),
  );

  const neighborDistances: number[] = [];
  const degree = new Map<string, number>();
  for (const conn of input.connections) {
    degree.set(conn.from, (degree.get(conn.from) ?? 0) + 1);
    degree.set(conn.to, (degree.get(conn.to) ?? 0) + 1);
    const from = centerById.get(conn.from);
    const to = centerById.get(conn.to);
    if (from && to) neighborDistances.push(dist(from, to));
  }

  const medianNeighborCenterDistance = median(neighborDistances);
  const connectionsPerTerritory = landTerritoryCount > 0
    ? (input.connections.length * 2) / landTerritoryCount
    : 0;

  const minPolygonArea = polygonAreas.length > 0 ? Math.min(...polygonAreas) : 0;
  const smallTerritoryRatio = polygonAreas.length > 0
    ? polygonAreas.filter((a) => a < medianPolygonArea * 0.45).length / polygonAreas.length
    : 0;
  const tinyCapFactor = medianPolygonArea > 0 && minPolygonArea / medianPolygonArea < 0.22
    ? 0.25
    : medianPolygonArea > 0 && minPolygonArea / medianPolygonArea < 0.38
      ? 0.12
      : 0;

  const tightNeighborRatio = neighborDistances.length > 0
    ? neighborDistances.filter((d) => d < diagonal * 0.06).length / neighborDistances.length
    : 0;

  const countFactor = Math.min(1, Math.max(0, (landTerritoryCount - 18) / 32));
  const areaFactor = medianPolygonArea > 0
    ? Math.min(1, Math.max(0, 1 - medianPolygonArea / (canvasW * canvasH * 0.004)))
    : 0;
  const neighborFactor = Math.min(1, tightNeighborRatio * 1.15);
  const degreeFactor = Math.min(1, Math.max(0, (connectionsPerTerritory - 3.5) / 4));

  const densityScore = Math.min(
    1,
    countFactor * 0.32
      + areaFactor * 0.22
      + neighborFactor * 0.22
      + degreeFactor * 0.1
      + smallTerritoryRatio * 0.05
      + tinyCapFactor,
  );

  const isDense =
    landTerritoryCount >= 34
    || (landTerritoryCount >= 26 && tightNeighborRatio >= 0.45)
    || (landTerritoryCount >= 12 && tinyCapFactor >= 0.12 && tightNeighborRatio >= 0.35)
    || densityScore >= 0.58;

  return {
    territoryCount,
    landTerritoryCount,
    medianPolygonArea,
    medianNeighborCenterDistance,
    connectionsPerTerritory,
    densityScore,
    isDense,
  };
}
