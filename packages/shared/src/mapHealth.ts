/**
 * Map health: the rules a community map must meet to be playable and
 * publishable, evaluated client-side so the map editor can show them live,
 * with every failing rule pointing at the territories or regions it is about.
 *
 * Blockers are exactly what the server refuses at publish
 * (backend/src/modules/maps/mapValidation.ts — a parity test there runs both
 * over the same fixtures, so the two cannot drift apart silently). Warnings
 * and tips are advice the server never sees: things that make a map better,
 * not things that make it invalid.
 */

export type MapHealthSeverity = 'blocker' | 'warning' | 'tip';

export type MapHealthCode =
  | 'name_short'
  | 'too_few_territories'
  | 'too_few_connections'
  | 'unknown_endpoint'
  | 'self_loop'
  | 'duplicate_connection'
  | 'disconnected'
  | 'empty_region'
  | 'thin_bonus_region'
  | 'shared_geo_code'
  | 'isolated_territory'
  | 'duplicate_territory_name'
  | 'no_description'
  | 'no_era_tag';

export interface MapHealthIssue {
  code: MapHealthCode;
  severity: MapHealthSeverity;
  message: string;
  /** The territories the issue is about, for highlighting and selection. */
  territoryIds?: string[];
  regionIds?: string[];
  connections?: Array<{ from: string; to: string }>;
}

export interface MapHealthTerritory {
  territory_id: string;
  name?: string;
  region_id?: string;
  iso_codes?: string[];
  clip_bbox?: unknown;
  geo_config?: Array<{ iso: string; clip_bbox?: unknown }>;
}

export interface MapHealthConnection {
  from: string;
  to: string;
  type?: string;
}

export interface MapHealthRegion {
  region_id: string;
  name?: string;
  bonus?: number;
}

export interface MapHealthInput {
  name?: string;
  description?: string;
  era_theme?: string | null;
  territories: MapHealthTerritory[];
  connections: MapHealthConnection[];
  regions: MapHealthRegion[];
}

export interface MapHealthReport {
  issues: MapHealthIssue[];
  blockers: MapHealthIssue[];
  warnings: MapHealthIssue[];
  tips: MapHealthIssue[];
  /** No blockers: publish would accept the map as it stands. */
  ready: boolean;
  /** Connected components of the territory graph, largest first. */
  components: string[][];
}

/** The smallest board the game deals. */
export const MAP_MIN_TERRITORIES = 6;
export const MAP_MIN_CONNECTIONS = 5;
export const MAP_MIN_NAME_LENGTH = 3;
/** A region pays its bonus only once it holds this many territories (state/regionsOnBoard.ts). */
export const MAP_MIN_BONUS_REGION_TERRITORIES = 2;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listNames(names: string[], limit = 5): string {
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} …and ${names.length - limit} more` : shown;
}

/**
 * Connected components of the territory graph (land, sea and orbit alike),
 * largest first; within a component, territories keep their map order.
 */
export function mapComponents(territoryIds: string[], connections: MapHealthConnection[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const id of territoryIds) adjacency.set(id, new Set());
  for (const c of connections) {
    if (c.from === c.to) continue;
    const a = adjacency.get(c.from);
    const b = adjacency.get(c.to);
    if (!a || !b) continue;
    a.add(c.to);
    b.add(c.from);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const id of territoryIds) {
    if (seen.has(id)) continue;
    const component: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  const order = new Map(territoryIds.map((id, i) => [id, i] as const));
  for (const component of components) component.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  components.sort((a, b) => b.length - a.length);
  return components;
}

export function evaluateMapHealth(input: MapHealthInput): MapHealthReport {
  const issues: MapHealthIssue[] = [];
  const { territories, connections, regions } = input;

  const territoryName = new Map(territories.map((t) => [t.territory_id, t.name] as const));
  const regionName = new Map(regions.map((r) => [r.region_id, r.name] as const));
  const labelTerritory = (id: string) => territoryName.get(id) ?? id;
  const labelRegion = (id: string) => regionName.get(id) ?? id;
  const ids = territories.map((t) => t.territory_id);
  const idSet = new Set(ids);

  // ── Blockers: what publish refuses, in the order the server reports them ──

  if (typeof input.name === 'string' && input.name.trim().length < MAP_MIN_NAME_LENGTH) {
    issues.push({
      code: 'name_short',
      severity: 'blocker',
      message: `Give the map a name of at least ${MAP_MIN_NAME_LENGTH} characters`,
    });
  }

  if (territories.length < MAP_MIN_TERRITORIES) {
    const missing = MAP_MIN_TERRITORIES - territories.length;
    issues.push({
      code: 'too_few_territories',
      severity: 'blocker',
      message: `Add ${plural(missing, 'more territory', 'more territories')} — a map needs at least ${MAP_MIN_TERRITORIES} (has ${territories.length})`,
    });
  }

  if (connections.length < MAP_MIN_CONNECTIONS) {
    const missing = MAP_MIN_CONNECTIONS - connections.length;
    issues.push({
      code: 'too_few_connections',
      severity: 'blocker',
      message: `Add ${plural(missing, 'more connection', 'more connections')} — a map needs at least ${MAP_MIN_CONNECTIONS} (has ${connections.length})`,
    });
  }

  const pairSeen = new Set<string>();
  for (const c of connections) {
    const fromValid = idSet.has(c.from);
    const toValid = idSet.has(c.to);
    if (!fromValid) {
      issues.push({
        code: 'unknown_endpoint',
        severity: 'blocker',
        message: `Connection references unknown territory "from": ${labelTerritory(c.from)}`,
        connections: [{ from: c.from, to: c.to }],
      });
    }
    if (!toValid) {
      issues.push({
        code: 'unknown_endpoint',
        severity: 'blocker',
        message: `Connection references unknown territory "to": ${labelTerritory(c.to)}`,
        connections: [{ from: c.from, to: c.to }],
      });
    }
    if (c.from === c.to) {
      issues.push({
        code: 'self_loop',
        severity: 'blocker',
        message: `Self-loop connection: ${labelTerritory(c.from)}`,
        territoryIds: [c.from],
        connections: [{ from: c.from, to: c.to }],
      });
      continue;
    }
    const a = c.from < c.to ? c.from : c.to;
    const b = c.from < c.to ? c.to : c.from;
    const key = `${a}\0${b}`;
    if (pairSeen.has(key)) {
      issues.push({
        code: 'duplicate_connection',
        severity: 'blocker',
        message: `Duplicate connection between ${labelTerritory(a)} and ${labelTerritory(b)}`,
        territoryIds: [a, b],
        connections: [{ from: c.from, to: c.to }],
      });
    }
    pairSeen.add(key);
  }

  const components = mapComponents(ids, connections);
  if (territories.length > 0 && components.length > 1) {
    const start = ids[0];
    const reachable = new Set(components.find((c) => c.includes(start)) ?? []);
    const isolated = ids.filter((id) => !reachable.has(id));
    issues.push({
      code: 'disconnected',
      severity: 'blocker',
      message:
        `Disconnected territory component — ${plural(isolated.length, 'territory', 'territories')} unreachable from "${labelTerritory(start)}": ` +
        listNames(isolated.map(labelTerritory)),
      territoryIds: isolated,
    });
  }

  const usedRegions = new Set(territories.map((t) => t.region_id));
  for (const region of regions) {
    if (!usedRegions.has(region.region_id)) {
      issues.push({
        code: 'empty_region',
        severity: 'blocker',
        message: `Region "${labelRegion(region.region_id)}" has no territories`,
        regionIds: [region.region_id],
      });
    }
  }

  const membersByRegion = new Map<string, string[]>();
  for (const t of territories) {
    if (!t.region_id) continue;
    const list = membersByRegion.get(t.region_id) ?? [];
    list.push(t.territory_id);
    membersByRegion.set(t.region_id, list);
  }
  for (const region of regions) {
    const bonus = region.bonus ?? 0;
    if (bonus <= 0) continue;
    const members = membersByRegion.get(region.region_id) ?? [];
    // An empty region is reported above; this is the populated-but-thin case.
    if (members.length === 0 || members.length >= MAP_MIN_BONUS_REGION_TERRITORIES) continue;
    issues.push({
      code: 'thin_bonus_region',
      severity: 'blocker',
      message:
        `Region "${labelRegion(region.region_id)}" has a +${bonus} bonus but only ${plural(members.length, 'territory', 'territories')} — ` +
        `a bonus pays only once a region holds ${MAP_MIN_BONUS_REGION_TERRITORIES} or more. Move another territory in, or fold it into a neighbour`,
      regionIds: [region.region_id],
      territoryIds: members,
    });
  }

  // Natural-Earth codes shared by two territories must be clipped in both, or
  // the whole country draws twice. Editor-made maps keep codes unique, so this
  // only bites a hand-edited or remixed document.
  const byCode = new Map<string, Array<{ territoryId: string; clipped: boolean }>>();
  for (const t of territories) {
    for (const item of t.geo_config ?? []) {
      const uses = byCode.get(item.iso) ?? [];
      uses.push({ territoryId: t.territory_id, clipped: !!item.clip_bbox });
      byCode.set(item.iso, uses);
    }
    for (const iso of t.iso_codes ?? []) {
      const uses = byCode.get(iso) ?? [];
      uses.push({ territoryId: t.territory_id, clipped: !!t.clip_bbox });
      byCode.set(iso, uses);
    }
  }
  for (const [code, uses] of byCode) {
    if (uses.length < 2) continue;
    const unclipped = uses.filter((u) => !u.clipped).map((u) => u.territoryId);
    if (unclipped.length === 0) continue;
    issues.push({
      code: 'shared_geo_code',
      severity: 'blocker',
      message:
        `Geometry code "${code}" is used by ${uses.length} territories but drawn unclipped in: ${listNames(unclipped.map(labelTerritory))} — ` +
        'a shared code must be clipped in every territory to avoid an overlapping double-draw',
      territoryIds: unclipped,
    });
  }

  // ── Warnings: legal, but a worse map than it could be ──

  if (territories.length >= 2) {
    const degree = new Map<string, number>();
    for (const c of connections) {
      if (c.from === c.to || !idSet.has(c.from) || !idSet.has(c.to)) continue;
      degree.set(c.from, (degree.get(c.from) ?? 0) + 1);
      degree.set(c.to, (degree.get(c.to) ?? 0) + 1);
    }
    const lonely = ids.filter((id) => (degree.get(id) ?? 0) === 0);
    if (lonely.length > 0) {
      issues.push({
        code: 'isolated_territory',
        severity: 'warning',
        message: `${plural(lonely.length, 'territory has', 'territories have')} no connections at all: ${listNames(lonely.map(labelTerritory))}`,
        territoryIds: lonely,
      });
    }
  }

  const byName = new Map<string, string[]>();
  for (const t of territories) {
    const key = (t.name ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(t.territory_id);
    byName.set(key, list);
  }
  for (const [, members] of byName) {
    if (members.length < 2) continue;
    issues.push({
      code: 'duplicate_territory_name',
      severity: 'warning',
      message: `${members.length} territories share the name "${labelTerritory(members[0])}"`,
      territoryIds: members,
    });
  }

  // ── Tips: the hub card ──

  if (!(input.description ?? '').trim()) {
    issues.push({
      code: 'no_description',
      severity: 'tip',
      message: 'Add a description — it is the first thing players read on the map\'s hub card',
    });
  }
  if (!input.era_theme) {
    issues.push({
      code: 'no_era_tag',
      severity: 'tip',
      message: 'Tag an era so the map shows up under that era\'s filter in the Map Hub',
    });
  }

  const blockers = issues.filter((i) => i.severity === 'blocker');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const tips = issues.filter((i) => i.severity === 'tip');
  return { issues, blockers, warnings, tips, ready: blockers.length === 0, components };
}
