import { getMapById } from '../../modules/maps/mapService';
import { query, queryOne } from '../../db/postgres';
import { getEraTechTree } from '../eras';
import type { EraId, GameMap } from '../../types';
import type { DailyPuzzleArchetype, DailyPuzzleSpec } from './dailyPuzzleTypes';
import { getAuthoredDailySpec } from '../../content/dailyCalendar';

/** Human-readable territory label for puzzle copy (prefers map data, else softens ids). */
export function territoryDisplayName(map: GameMap | null, territoryId: string): string {
  const t = map?.territories?.find((x) => x.territory_id === territoryId);
  if (t?.name?.trim()) return t.name.trim();
  return territoryId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Rewrites goal (and related copy) using map/tech lookups so APIs never expose raw territory_id strings.
 */
export async function enrichDailyPuzzleSpecForDisplay(spec: DailyPuzzleSpec): Promise<DailyPuzzleSpec> {
  if (spec.archetype === 'military_capture' && spec.target_territory_id) {
    const map = await getMapById(spec.map_id);
    const label = territoryDisplayName(map, spec.target_territory_id);
    return {
      ...spec,
      goal: `Capture ${label} before time runs out.`,
    };
  }
  if (spec.archetype === 'tech_research' && spec.tech_id) {
    const tree = getEraTechTree(spec.era_id);
    const node = tree.find((n) => n.tech_id === spec.tech_id);
    const name = node?.name?.trim() ?? spec.tech_id.replace(/_/g, ' ');
    return {
      ...spec,
      goal: `Research “${name}”.`,
    };
  }
  return spec;
}

const ERA_MAP_IDS: Record<string, string> = {
  ancient: 'era_ancient',
  medieval: 'era_medieval',
  discovery: 'era_discovery',
  ww2: 'era_ww2',
  coldwar: 'era_coldwar',
  modern: 'era_modern',
  acw: 'era_acw',
  risorgimento: 'era_risorgimento',
};

const ROTATING_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw'];

const ARCHETYPES: DailyPuzzleArchetype[] = [
  'domination',
  'military_capture',
  'economy_build',
  'tech_research',
];

function dateHash(today: string): number {
  return today
    .replace(/-/g, '')
    .split('')
    .reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
}

/**
 * Pure numeric picks from a calendar date (deterministic across processes).
 */
export function buildDailyPuzzleBase(today: string): {
  era_id: EraId;
  map_id: string;
  seed: number;
  player_count: number;
  archetype: DailyPuzzleArchetype;
  dice_queue_seed: number;
  edge_pick: number;
  tech_pick: number;
} {
  const h = dateHash(today);
  const era_id = ROTATING_ERAS[h % ROTATING_ERAS.length];
  const map_id = ERA_MAP_IDS[era_id] ?? 'era_ancient';
  const seed = h * 31337;
  const archetype = ARCHETYPES[h % ARCHETYPES.length];
  const player_count = archetype === 'domination' ? 4 : 2;
  const dice_queue_seed = (h * 7919 + 1337) >>> 0;
  const edge_pick = h % 997;
  const tech_pick = (h >> 3) % 97;
  return {
    era_id,
    map_id,
    seed,
    player_count,
    archetype,
    dice_queue_seed,
    edge_pick,
    tech_pick,
  };
}

function pickFirstRootTech(era: EraId, pick: number): { tech_id: string; name: string } | null {
  const tree = getEraTechTree(era);
  const roots = tree.filter((n) => !n.prerequisite);
  if (roots.length === 0) return null;
  const node = roots[pick % roots.length];
  return { tech_id: node.tech_id, name: node.name };
}

/**
 * Full spec for persistence and API — async only to resolve map graph for military puzzles.
 *
 * Authored days win: a calendar entry for this date is used verbatim (validated
 * at write time by the calendar's own test suite), and the procedural generator
 * is the fallback for every date nobody has authored. That makes the calendar
 * safe to grow incrementally — an empty calendar reproduces today's behaviour
 * exactly.
 */
export async function buildCompleteDailyPuzzleSpec(today: string): Promise<DailyPuzzleSpec> {
  const authored = getAuthoredDailySpec(today);
  if (authored) return authored;

  const b = buildDailyPuzzleBase(today);
  const dice_queue_seed = b.dice_queue_seed;
  const max_turns = b.archetype === 'domination' ? 200 : 18;

  if (b.archetype === 'domination') {
    return {
      archetype: 'domination',
      title: "Commander's Daily — Domination",
      intro: 'Classic solo challenge: outlast the AI commanders and dominate the map.',
      goal: 'Eliminate rival factions and control the entire map.',
      era_id: b.era_id,
      map_id: b.map_id,
      seed: b.seed,
      player_count: b.player_count,
      max_turns,
      dice_queue_seed,
    };
  }

  if (b.archetype === 'military_capture') {
    const map = await getMapById(b.map_id);
    let target_territory_id = '';
    let anchor_territory_id = '';
    if (map && map.connections.length > 0) {
      const sorted = [...map.connections].sort((a, c) => {
        const k1 = `${a.from}\0${a.to}`;
        const k2 = `${c.from}\0${c.to}`;
        return k1.localeCompare(k2);
      });
      const edge = sorted[b.edge_pick % sorted.length];
      anchor_territory_id = edge.from;
      target_territory_id = edge.to;
    }
    if (!target_territory_id || !anchor_territory_id) {
      return dominationSpecFromBase(b);
    }
    const targetLabel = territoryDisplayName(map, target_territory_id);
    return {
      archetype: 'military_capture',
      title: 'Daily Tactical — Breakthrough',
      intro: 'You hold one front; the objective territory is heavily defended. Plan assaults carefully.',
      goal: `Capture ${targetLabel} before time runs out.`,
      era_id: b.era_id,
      map_id: b.map_id,
      seed: b.seed,
      player_count: b.player_count,
      max_turns,
      dice_queue_seed,
      target_territory_id,
      anchor_territory_id,
      hint: 'Favor favorable exchanges and consolidate before committing to the final push.',
    };
  }

  if (b.archetype === 'economy_build') {
    return {
      archetype: 'economy_build',
      title: 'Daily Economy — Foundations',
      intro: 'Industry wins wars. Accumulate production and raise a core facility.',
      goal: 'Construct a Production (tier 1) building in any territory you control.',
      era_id: b.era_id,
      map_id: b.map_id,
      seed: b.seed,
      player_count: 2,
      max_turns,
      dice_queue_seed,
      building_type: 'production_1',
    };
  }

  // tech_research
  const tech = pickFirstRootTech(b.era_id, b.tech_pick);
  if (!tech) {
    return dominationSpecFromBase(b);
  }
  return {
    archetype: 'tech_research',
    title: 'Daily Research — First Principles',
    intro: 'Your advisors await a breakthrough. Invest tech points into a foundational advance.',
    goal: `Research “${tech.name}”.`,
    era_id: b.era_id,
    map_id: b.map_id,
    seed: b.seed,
    player_count: 2,
    max_turns,
    dice_queue_seed,
    tech_id: tech.tech_id,
  };
}

function dominationSpecFromBase(b: ReturnType<typeof buildDailyPuzzleBase>): DailyPuzzleSpec {
  return {
    archetype: 'domination',
    title: "Commander's Daily — Domination",
    intro: 'Classic solo challenge: outlast the AI commanders and dominate the map.',
    goal: 'Eliminate rival factions and control the entire map.',
    era_id: b.era_id,
    map_id: b.map_id,
    seed: b.seed,
    player_count: 4,
    max_turns: 200,
    dice_queue_seed: b.dice_queue_seed,
  };
}

export interface DailyChallengeRow {
  challenge_date: string;
  era_id: string;
  map_id: string;
  seed: number;
  player_count: number;
  kind: string;
  spec: DailyPuzzleSpec;
}

const VALID_ARCHETYPES: ReadonlySet<string> = new Set([
  'domination',
  'military_capture',
  'economy_build',
  'tech_research',
]);
const VALID_AI_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'medium', 'hard', 'expert']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

/**
 * Structural validation for a spec coming back from the JSONB round-trip.
 * The row is written by this process today, but it outlives deploys: a spec
 * authored against an older shape, or hand-edited in the DB, used to sail
 * through a bare cast and blow up somewhere deep in game start instead.
 * Returns null on anything unusable; the caller regenerates and logs.
 */
export function validateDailyPuzzleSpec(raw: unknown): DailyPuzzleSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  if (!VALID_ARCHETYPES.has(s.archetype as string)) return null;
  if (!isNonEmptyString(s.title) || !isNonEmptyString(s.intro) || !isNonEmptyString(s.goal)) return null;
  if (!isNonEmptyString(s.era_id) || !isNonEmptyString(s.map_id)) return null;
  if (!isFiniteNumber(s.seed) || !isFiniteNumber(s.player_count)) return null;
  if (!isFiniteNumber(s.max_turns) || !isFiniteNumber(s.dice_queue_seed)) return null;
  if (!isOptionalString(s.target_territory_id) || !isOptionalString(s.anchor_territory_id)) return null;
  if (!isOptionalString(s.building_type) || !isOptionalString(s.tech_id) || !isOptionalString(s.hint)) return null;

  if (s.ai_difficulty !== undefined && !VALID_AI_DIFFICULTIES.has(s.ai_difficulty as string)) return null;
  if (s.starting_phase !== undefined && s.starting_phase !== 'attack') return null;
  if (s.clear_board !== undefined && typeof s.clear_board !== 'boolean') return null;
  if (s.settings_overrides !== undefined
      && (typeof s.settings_overrides !== 'object' || s.settings_overrides === null || Array.isArray(s.settings_overrides))) {
    return null;
  }
  if (s.grants !== undefined) {
    if (typeof s.grants !== 'object' || s.grants === null) return null;
    const g = s.grants as Record<string, unknown>;
    if (g.tech_points !== undefined && !isFiniteNumber(g.tech_points)) return null;
    if (g.gold !== undefined && !isFiniteNumber(g.gold)) return null;
  }
  if (s.starting_board !== undefined) {
    if (typeof s.starting_board !== 'object' || s.starting_board === null || Array.isArray(s.starting_board)) return null;
    for (const entry of Object.values(s.starting_board as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') return null;
      const t = entry as Record<string, unknown>;
      if (t.owner !== 'human' && t.owner !== 'ai' && t.owner !== null) return null;
      if (!isFiniteNumber(t.unit_count) || t.unit_count < 0) return null;
      if (t.buildings !== undefined
          && (!Array.isArray(t.buildings) || t.buildings.some((b) => typeof b !== 'string'))) {
        return null;
      }
    }
  }

  return raw as DailyPuzzleSpec;
}

function parseSpec(raw: unknown): DailyPuzzleSpec {
  const validated = validateDailyPuzzleSpec(raw);
  if (validated) return validated;
  console.error(
    '[daily] stored spec_json failed validation — regenerating a domination fallback for today',
    { raw_type: typeof raw },
  );
  return dominationSpecFromBase(buildDailyPuzzleBase(new Date().toISOString().slice(0, 10)));
}

/**
 * Idempotent: ensures today's row exists with a generated spec, returns the row for API/game start.
 */
export async function ensureDailyChallengeForToday(): Promise<DailyChallengeRow> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await queryOne<{
    challenge_date: string;
    era_id: string;
    map_id: string;
    seed: number;
    player_count: number;
    kind: string;
    spec_json: unknown;
  }>(
    `SELECT challenge_date, era_id, map_id, seed, player_count, kind, spec_json
     FROM daily_challenges WHERE challenge_date = $1`,
    [today],
  );
  if (existing) {
    const spec = await enrichDailyPuzzleSpecForDisplay(parseSpec(existing.spec_json));
    return {
      challenge_date: existing.challenge_date,
      era_id: existing.era_id,
      map_id: existing.map_id,
      seed: existing.seed,
      player_count: existing.player_count,
      kind: existing.kind,
      spec,
    };
  }

  const spec = await enrichDailyPuzzleSpecForDisplay(await buildCompleteDailyPuzzleSpec(today));
  await query(
    `INSERT INTO daily_challenges (challenge_date, era_id, map_id, seed, player_count, kind, spec_json)
     VALUES ($1, $2, $3, $4, $5, 'puzzle', $6::jsonb)
     ON CONFLICT (challenge_date) DO NOTHING`,
    [today, spec.era_id, spec.map_id, spec.seed, spec.player_count, JSON.stringify(spec)],
  );

  const again = await queryOne<{
    challenge_date: string;
    era_id: string;
    map_id: string;
    seed: number;
    player_count: number;
    kind: string;
    spec_json: unknown;
  }>(
    `SELECT challenge_date, era_id, map_id, seed, player_count, kind, spec_json
     FROM daily_challenges WHERE challenge_date = $1`,
    [today],
  );
  if (!again) {
    throw new Error('Failed to create daily challenge row');
  }
  const parsed = await enrichDailyPuzzleSpecForDisplay(parseSpec(again.spec_json));
  return {
    challenge_date: again.challenge_date,
    era_id: again.era_id,
    map_id: again.map_id,
    seed: again.seed,
    player_count: again.player_count,
    kind: again.kind,
    spec: parsed,
  };
}
