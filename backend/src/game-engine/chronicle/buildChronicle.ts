import type { GameMap, GameState } from '../../types';
import { chronicleDate } from './eraCalendar';
import { getSpineEraIdAtIndex } from '../eraAdvancement/spines';

/**
 * The Chronicle: a finished match read back as a history.
 *
 * Everything here is derived from the per-turn `game_states` snapshots the
 * replay already persists — nothing new is recorded during play, and nothing is
 * stored afterwards, so this works retroactively on every game already in the
 * database. It is deliberately a pure function over snapshots: the caller
 * fetches, this narrates, and the same output can render a timeline, seed a
 * globe playback, or become a share card.
 *
 * What it looks for is what a person would remember about a match a week
 * later — who broke first, who took a whole region, whose capital fell, who
 * reached the next age ahead of everyone else, and the turn the outcome
 * stopped being in doubt. Turn-by-turn combat is what the replay is for.
 */

export type ChronicleKind =
  | 'opening'
  | 'first_blood'
  | 'region_secured'
  | 'capital_fell'
  | 'era_advanced'
  | 'elimination'
  | 'decisive_turn'
  | 'conclusion';

export interface ChronicleEntry {
  turn: number;
  /** In-fiction year label, e.g. "1244" or "312 BC". */
  date: string;
  kind: ChronicleKind;
  /** One line, written as history. */
  headline: string;
  /** Optional second line with the specifics. */
  detail?: string;
  /** Whose beat this is, when it belongs to someone. */
  playerId?: string;
  playerName?: string;
  playerColor?: string;
}

export interface ChronicleResult {
  entries: ChronicleEntry[];
  /** Era the world had reached by the final entry — the map the story ends on. */
  finalEraId: string;
  turnCount: number;
}

interface Snapshot {
  turn_number: number;
  state: GameState;
}

/** Territories a player holds, per region, in one snapshot. */
function regionHoldings(state: GameState, map: GameMap): Map<string, Map<string, number>> {
  const byRegion = new Map<string, Map<string, number>>();
  const regionOf = new Map<string, string>();
  for (const t of map.territories) regionOf.set(t.territory_id, t.region_id);
  for (const [tid, t] of Object.entries(state.territories)) {
    if (!t.owner_id) continue;
    const region = regionOf.get(tid);
    if (!region) continue;
    let owners = byRegion.get(region);
    if (!owners) { owners = new Map(); byRegion.set(region, owners); }
    owners.set(t.owner_id, (owners.get(t.owner_id) ?? 0) + 1);
  }
  return byRegion;
}

function regionSizes(map: GameMap): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const t of map.territories) sizes.set(t.region_id, (sizes.get(t.region_id) ?? 0) + 1);
  return sizes;
}

/** The furthest era anyone has reached — the Chronicle's clock follows the vanguard. */
function worldEraId(state: GameState): string {
  if (!state.settings?.era_advancement_enabled) return state.era;
  const furthest = state.players.reduce((max, p) => Math.max(max, p.current_era_index ?? 0), 0);
  try {
    return getSpineEraIdAtIndex(state, furthest);
  } catch {
    return state.era;
  }
}

function ownedCount(state: GameState, playerId: string): number {
  let n = 0;
  for (const t of Object.values(state.territories)) if (t.owner_id === playerId) n++;
  return n;
}

export function buildChronicle(snapshots: Snapshot[], map: GameMap): ChronicleResult {
  const ordered = [...snapshots].sort((a, b) => a.turn_number - b.turn_number);
  if (ordered.length === 0) return { entries: [], finalEraId: 'custom', turnCount: 0 };

  const first = ordered[0].state;
  const last = ordered[ordered.length - 1].state;
  const finalEraId = worldEraId(last);

  const nameOf = new Map<string, string>();
  const colorOf = new Map<string, string>();
  for (const p of last.players) {
    nameOf.set(p.player_id, p.username);
    colorOf.set(p.player_id, p.color);
  }
  const who = (playerId: string) => nameOf.get(playerId) ?? 'A commander';

  const regionNames = new Map(map.regions.map((r) => [r.region_id, r.name]));
  const sizes = regionSizes(map);

  const entries: ChronicleEntry[] = [];
  const add = (
    turn: number,
    kind: ChronicleKind,
    headline: string,
    opts: { detail?: string; playerId?: string; eraId?: string } = {},
  ) => {
    const eraId = opts.eraId ?? finalEraId;
    entries.push({
      turn,
      date: chronicleDate(eraId, turn),
      kind,
      headline,
      detail: opts.detail,
      playerId: opts.playerId,
      playerName: opts.playerId ? who(opts.playerId) : undefined,
      playerColor: opts.playerId ? colorOf.get(opts.playerId) : undefined,
    });
  };

  // ── Opening ────────────────────────────────────────────────────────────────
  const openingEra = worldEraId(first);
  const humanCount = first.players.filter((p) => !p.is_ai).length;
  add(first.turn_number, 'opening', `${first.players.length} powers divide the map`, {
    eraId: openingEra,
    detail:
      humanCount > 0
        ? `${first.players.map((p) => p.username).join(', ')} take the field across ${Object.keys(first.territories).length} territories.`
        : undefined,
  });

  // ── Walk the match ─────────────────────────────────────────────────────────
  const seenRegion = new Set<string>();       // `${playerId}:${regionId}` already narrated
  const eliminated = new Set<string>();
  const eraReached = new Map<string, number>(); // playerId → highest era index narrated
  const capitalOwner = new Map<string, string>(); // capital territoryId → last known owner
  let firstBloodDone = false;

  for (const p of first.players) {
    eraReached.set(p.player_id, p.current_era_index ?? 0);
    if (p.capital_territory_id) {
      capitalOwner.set(p.capital_territory_id, p.player_id);
    }
  }
  let prevRegions = regionHoldings(first, map);
  let prevOwned = new Map(first.players.map((p) => [p.player_id, ownedCount(first, p.player_id)]));

  for (let i = 1; i < ordered.length; i++) {
    const { turn_number: turn, state } = ordered[i];
    const eraId = worldEraId(state);
    const owned = new Map(state.players.map((p) => [p.player_id, ownedCount(state, p.player_id)]));

    // First blood — the first territory to change hands at all.
    if (!firstBloodDone) {
      for (const p of state.players) {
        const before = prevOwned.get(p.player_id) ?? 0;
        if ((owned.get(p.player_id) ?? 0) > before) {
          add(turn, 'first_blood', `${who(p.player_id)} draws first blood`, {
            eraId,
            playerId: p.player_id,
            detail: 'The first border moves. From here the map is contested.',
          });
          firstBloodDone = true;
          break;
        }
      }
    }

    // A whole region taken — the beat that reads most like history.
    const regions = regionHoldings(state, map);
    for (const [regionId, owners] of regions) {
      const size = sizes.get(regionId) ?? 0;
      if (size === 0) continue;
      for (const [playerId, held] of owners) {
        if (held < size) continue;
        const key = `${playerId}:${regionId}`;
        if (seenRegion.has(key)) continue;
        // Only narrate a region someone did not already hold outright.
        const before = prevRegions.get(regionId)?.get(playerId) ?? 0;
        if (before >= size) { seenRegion.add(key); continue; }
        seenRegion.add(key);
        const regionName = regionNames.get(regionId) ?? regionId;
        add(turn, 'region_secured', `${who(playerId)} secures ${regionName}`, {
          eraId,
          playerId,
          detail: `All ${size} territories of ${regionName} now answer to one commander.`,
        });
      }
    }

    // A capital changing hands.
    for (const [territoryId, heldBy] of capitalOwner) {
      const nowOwner = state.territories[territoryId]?.owner_id ?? null;
      if (!nowOwner || nowOwner === heldBy) continue;
      const seat = map.territories.find((t) => t.territory_id === territoryId)?.name ?? territoryId;
      add(turn, 'capital_fell', `${who(heldBy)}'s capital falls at ${seat}`, {
        eraId,
        playerId: nowOwner,
        detail: `${who(nowOwner)} takes the seat of ${who(heldBy)}.`,
      });
      capitalOwner.set(territoryId, nowOwner);
    }

    // Reaching a new age — the wedge, when era advancement is on.
    for (const p of state.players) {
      const idx = p.current_era_index ?? 0;
      const known = eraReached.get(p.player_id) ?? 0;
      if (idx <= known) continue;
      eraReached.set(p.player_id, idx);
      const arrivedEra = worldEraIdForIndex(state, idx);
      const firstThere = state.players.every(
        (o) => o.player_id === p.player_id || (o.current_era_index ?? 0) < idx,
      );
      add(turn, 'era_advanced', `${who(p.player_id)} reaches the ${eraTitle(arrivedEra)}${firstThere ? ' first' : ''}`, {
        eraId: arrivedEra,
        playerId: p.player_id,
        detail: firstThere
          ? 'The rest of the world is still fighting the last age.'
          : 'Another power crosses into the new age.',
      });
    }

    // Eliminations.
    for (const p of state.players) {
      if (!p.is_eliminated || eliminated.has(p.player_id)) continue;
      eliminated.add(p.player_id);
      add(turn, 'elimination', `${who(p.player_id)} is driven from the map`, {
        eraId,
        playerId: p.player_id,
      });
    }

    prevRegions = regions;
    prevOwned = owned;
  }

  // ── The turn it stopped being in doubt ─────────────────────────────────────
  const decisive = findDecisiveTurn(ordered);
  if (decisive) {
    const eraId = worldEraId(decisive.state);
    add(decisive.turn, 'decisive_turn', `The war turns for ${who(decisive.playerId)}`, {
      eraId,
      playerId: decisive.playerId,
      detail: `Their odds swing ${Math.round(decisive.delta * 100)} points in a single turn — the largest shift of the match.`,
    });
  }

  // ── Conclusion ─────────────────────────────────────────────────────────────
  const winnerIds = last.winner_ids ?? (last.winner_id ? [last.winner_id] : []);
  if (winnerIds.length > 0) {
    const names = winnerIds.map(who).join(' and ');
    add(last.turn_number, 'conclusion', `${names} ${winnerIds.length > 1 ? 'stand' : 'stands'} alone`, {
      eraId: finalEraId,
      playerId: winnerIds[0],
      detail: conclusionDetail(last),
    });
  }

  entries.sort((a, b) => a.turn - b.turn || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return { entries, finalEraId, turnCount: last.turn_number };
}

/** Within one turn, beats read best cause-before-effect. */
const KIND_ORDER: ChronicleKind[] = [
  'opening',
  'first_blood',
  'era_advanced',
  'region_secured',
  'capital_fell',
  'decisive_turn',
  'elimination',
  'conclusion',
];

function worldEraIdForIndex(state: GameState, index: number): string {
  try {
    return getSpineEraIdAtIndex(state, index);
  } catch {
    return state.era;
  }
}

const ERA_TITLES: Record<string, string> = {
  ancient: 'Ancient World',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'Second World War',
  coldwar: 'Cold War',
  modern: 'Modern Day',
  acw: 'American Civil War',
  risorgimento: 'Italian Unification',
  space_age: 'Space Age',
  galaxy_age: 'Galactic Age',
};

function eraTitle(eraId: string): string {
  return ERA_TITLES[eraId] ?? eraId;
}

function conclusionDetail(last: GameState): string | undefined {
  switch (last.victory_condition) {
    case 'domination': return 'Every territory on the map, under one banner.';
    case 'threshold': return 'Enough of the world held to end the argument.';
    case 'capital': return 'The capitals fell, and with them the war.';
    case 'secret_mission': return 'A hidden objective, completed while the others fought.';
    case 'lane_sovereignty': return 'The hyperspace network held, corridor by corridor, until it was theirs.';
    case 'alliance_victory': return 'Two powers finish it together.';
    case 'last_standing': return 'The last commander left on the field.';
    case 'humans_eliminated': return 'No human commander remained to contest it.';
    case 'turn_limit': return 'Time ran out with them holding the strongest position.';
    case 'resignation': return 'The last opponent conceded the field.';
    default: return undefined;
  }
}

/**
 * The single largest one-turn swing in win probability, and who it favoured.
 * Falls back to the biggest territory swing when a game predates the
 * probability history (it is attached per snapshot, so older saves lack it).
 */
function findDecisiveTurn(
  ordered: Snapshot[],
): { turn: number; playerId: string; delta: number; state: GameState } | null {
  let best: { turn: number; playerId: string; delta: number; state: GameState } | null = null;
  const history = ordered[ordered.length - 1].state.win_probability_history ?? [];
  if (history.length >= 2) {
    for (let i = 1; i < history.length; i++) {
      const before = history[i - 1].probabilities;
      const after = history[i].probabilities;
      for (const [playerId, p] of Object.entries(after)) {
        const delta = p - (before[playerId] ?? 0);
        if (delta <= 0) continue;
        if (!best || delta > best.delta) {
          const snap = ordered.find((s) => s.turn_number === history[i].turn) ?? ordered[ordered.length - 1];
          best = { turn: history[i].turn, playerId, delta, state: snap.state };
        }
      }
    }
  }
  // A swing that small is noise, not a turning point.
  if (best && best.delta < 0.15) return null;
  return best;
}
