/**
 * From a day's spec (or a live game) to the model, and back to the engine's
 * vocabulary.
 *
 * The in-play set is the spec's starting board. Everything the context needs
 * is read from the same tables the engine reads: adjacency and sea lanes from
 * the map, region bonuses from the map, the era doctrine from ERA_DEFAULTS,
 * the fortify limit from the same rule getFortifyMoveLimit applies. Defense
 * buildings are 0 because economy is off in every military daily (the engine's
 * getBuildingDefenseBonus returns 0 without it).
 */
import type { GameMap, GameState } from '../../../types';
import { ERA_DEFAULTS } from '../../state/eraModifiers';
import type { DailyPuzzleSpec } from '../dailyPuzzleTypes';
import { regionTerritoryIds } from '../puzzleObjective';
import {
  AI,
  HUMAN,
  NEUTRAL,
  PENDING,
  SOLVED,
  FAILED,
  PHASE_ATTACK,
  PHASE_DRAFT,
  PHASE_FORTIFY,
  beginHumanTurn,
  evaluateObjective,
  type ObjectiveKind,
  type Owner,
  type PuzzleContext,
  type PuzzleState,
} from './model';
import type { OpponentPlan } from './opponent';

export interface BridgeOptions {
  /** Assaults per human turn the search explores. Default 3. */
  maxAssaults?: number;
}

export const PUZZLE_ARCHETYPES = new Set<DailyPuzzleSpec['archetype']>([
  'military_capture', 'hold_territory', 'control_region', 'capture_chain',
]);

function objectiveOf(spec: DailyPuzzleSpec, map: GameMap): { kind: ObjectiveKind; ids: string[] } {
  switch (spec.archetype) {
    case 'military_capture': return { kind: 'capture', ids: spec.target_territory_id ? [spec.target_territory_id] : [] };
    case 'hold_territory': return { kind: 'hold', ids: spec.target_territory_id ? [spec.target_territory_id] : [] };
    case 'capture_chain': return { kind: 'chain', ids: [...(spec.target_territory_ids ?? [])] };
    case 'control_region': return { kind: 'region', ids: spec.region_id ? regionTerritoryIds(map, spec.region_id) : [] };
    default: throw new Error(`no puzzle model for archetype ${spec.archetype}`);
  }
}

export function contextFromSpec(spec: DailyPuzzleSpec, map: GameMap, opts: BridgeOptions = {}): PuzzleContext {
  const board = spec.starting_board;
  if (!board || Object.keys(board).length === 0) throw new Error('a puzzle needs a starting_board');
  const ids = Object.keys(board).sort();
  const index = new Map(ids.map((id, i) => [id, i]));

  const adj: number[][] = ids.map(() => []);
  const seaEdges = new Set<string>();
  for (const c of map.connections) {
    const a = index.get(c.from);
    const b = index.get(c.to);
    if (a === undefined || b === undefined || a === b) continue;
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[b].includes(a)) adj[b].push(a);
    if (c.type === 'sea') seaEdges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  for (const list of adj) list.sort((x, y) => x - y);

  const territories = Array.isArray(map.territories) ? map.territories : Object.values(map.territories ?? {});
  const regions = (map.regions ?? [])
    .map((r) => {
      const members = (territories as Array<{ territory_id: string; region_id?: string }>)
        .filter((t) => t.region_id === r.region_id)
        .map((t) => t.territory_id);
      return { id: r.region_id, members, bonus: r.bonus ?? 0 };
    })
    .filter((r) => r.members.length > 0 && r.members.every((m) => index.has(m)))
    .map((r) => ({ id: r.id, members: r.members.map((m) => index.get(m)!).sort((x, y) => x - y), bonus: r.bonus }));

  const objective = objectiveOf(spec, map);
  if (objective.ids.length === 0) throw new Error(`spec has no objective territories (${spec.archetype})`);
  for (const t of objective.ids) {
    if (!index.has(t)) throw new Error(`objective territory ${t} is not on the starting board`);
  }

  const era = ERA_DEFAULTS[spec.era_id] ?? {};
  return {
    ids,
    index,
    adj,
    seaEdges,
    regions,
    doctrine: { legionReroll: !!era.legion_reroll, rifleDoctrine: !!era.rifle_doctrine },
    seaCap: era.sea_lanes ? 2 : 3,
    defenderBonus: ids.map(() => 0),
    fortifyMoves: era.wartime_logistics ? 2 : 1,
    maxAssaults: opts.maxAssaults ?? 3,
    objective: { kind: objective.kind, targets: objective.ids.map((t) => index.get(t)!) },
    maxTurns: spec.max_turns,
    playerCount: Math.max(2, spec.player_count || 2),
    startingPhase: spec.starting_phase === 'attack' ? 'attack' : 'draft',
  };
}

export function stateFromSpec(ctx: PuzzleContext, spec: DailyPuzzleSpec): PuzzleState {
  const board = spec.starting_board!;
  const owner: Owner[] = ctx.ids.map((id) => {
    const o = board[id]?.owner;
    return o === 'human' ? HUMAN : o === 'ai' ? AI : NEUTRAL;
  });
  const units = ctx.ids.map((id, i) => (owner[i] === NEUTRAL ? 0 : Math.max(1, Math.floor(board[id]?.unit_count ?? 1))));
  const s: PuzzleState = {
    owner,
    units,
    side: HUMAN,
    phase: PHASE_DRAFT,
    turn: 1,
    draftLeft: 0,
    fortifyLeft: ctx.fortifyMoves,
    assaults: 0,
    reachedTurn: -1,
    objectiveAttacked: false,
    aiTurns: 0,
    outcome: PENDING,
  };
  beginHumanTurn(ctx, s);
  evaluateObjective(ctx, s);
  return s;
}

/**
 * A live game as a model state. Only the human's turn is ever graded, but the
 * mapping is total so the sweep can walk engine games too.
 */
export function stateFromGame(ctx: PuzzleContext, game: GameState, humanId: string, aiId: string): PuzzleState {
  const owner: Owner[] = ctx.ids.map((id) => {
    const o = game.territories[id]?.owner_id;
    return o === humanId ? HUMAN : o === aiId ? AI : NEUTRAL;
  });
  const units = ctx.ids.map((id) => game.territories[id]?.unit_count ?? 0);
  const current = game.players[game.current_player_index]?.player_id;
  const phase = game.phase === 'attack' ? PHASE_ATTACK : game.phase === 'fortify' ? PHASE_FORTIFY : PHASE_DRAFT;
  const outcome = game.phase === 'game_over'
    ? (game.puzzle_objective_met ? SOLVED : FAILED)
    : PENDING;
  return {
    owner,
    units,
    side: current === aiId ? AI : HUMAN,
    phase,
    turn: game.turn_number,
    draftLeft: Math.max(0, game.draft_units_remaining ?? 0),
    fortifyLeft: Math.max(0, ctx.fortifyMoves - (game.fortify_moves_used ?? 0)),
    assaults: 0,
    reachedTurn: game.puzzle_objective_reached_turn ?? -1,
    objectiveAttacked: !!game.puzzle_objective_attacked,
    aiTurns: Math.max(0, game.turn_number - 1),
    outcome,
  };
}

/**
 * A plan inferred from a v1 set-piece's shape, for days that carry no authored
 * plan yet: the relief reinforces the objective while the AI holds it, and
 * counterattacks it once the human takes it; a hold day's assault stack
 * attacks every turn. Authored plans on the set-piece replace this.
 */
export function inferPlan(spec: DailyPuzzleSpec, ctx: PuzzleContext): OpponentPlan {
  const target = ctx.objective.targets[0];
  const targetId = ctx.ids[target];
  const steps: OpponentPlan['steps'] = [];
  const aiOwned = ctx.ids.filter((id) => spec.starting_board?.[id]?.owner === 'ai');

  if (ctx.objective.kind === 'hold') {
    const anchorId = spec.anchor_territory_id && ctx.index.has(spec.anchor_territory_id) ? spec.anchor_territory_id : null;
    const attackers = anchorId ? [anchorId] : aiOwned.filter((id) => ctx.adj[ctx.index.get(id)!].includes(target));
    for (const from of attackers) {
      steps.push({ kind: 'draft', to: from });
      steps.push({ kind: 'assault', from, to: targetId, keep: 1 });
    }
    return { steps };
  }

  steps.push({ kind: 'draft', to: targetId, when: 'objective_ai' });
  for (const id of aiOwned) {
    if (id === targetId) continue;
    const i = ctx.index.get(id)!;
    if (!ctx.adj[i].includes(target)) continue;
    steps.push({ kind: 'march', from: id, to: targetId, when: 'objective_ai' });
    steps.push({ kind: 'assault', from: id, to: targetId, min_odds: 0.35, keep: 1, when: 'objective_human' });
  }
  return { steps };
}
