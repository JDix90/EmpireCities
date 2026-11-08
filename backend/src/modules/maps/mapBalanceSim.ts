/**
 * A balance report for a map, by playing it: bots against bots, the same turn
 * the live game runs (planAiTurn / playAiTurn), a handful of short games with
 * the starting seat rotating. What comes back is what the graph alone cannot
 * say — whether a seat wins more than its share, how long games run and how
 * they end, which regions ever pay their bonus and how often, and which
 * territories never change hands.
 *
 * Modelled on scripts/simAiArena.ts, less the behaviour instrumentation. The
 * planner's jitter is seeded so two runs on one seed play the same choices;
 * the engine's own randomness (dice, cards, events) stays the process's
 * CSPRNG — a live server must keep it, so this never swaps it — which makes
 * the report an estimate over its games, not a reproducible digest.
 *
 * Runs in a worker thread (mapBalanceThread.ts) so the server keeps serving
 * while it plays.
 */

import { performance } from 'perf_hooks';
import type { EraId, GameMap, GameState, PlayerState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from '../../game-engine/state/gameStateManager';
import { computeAiTurn } from '../../game-engine/ai/aiBot';
import type { AiLevel } from '../../game-engine/ai/aiProfiles';
import { headlessAiTurnHooks, planAiTurn, playAiTurn, type AiTurnFlags } from '../../game-engine/ai/runAiTurn';
import { resignIfBeaten, victoryAfterResignation } from '../../game-engine/ai/aiResign';
import { resolveEventChoice } from '../../game-engine/events/eventCardManager';
import { syncLaneWeatherLanes } from '../../game-engine/state/laneWeather';
import { syncSurgeProjectorLanes } from '../../game-engine/state/surgeProjector';
import { bakeCreateGameSettings } from '../games/createGameSettings';
import { createSeededRng, hashStringToSeed } from '../../game-engine/victory/missions';
import { featureFlags } from '../../config/featureFlags';
import { MIN_REGION_TERRITORIES } from '../../game-engine/state/regionsOnBoard';

export type BalanceDifficulty = 'easy' | 'medium' | 'hard';

export interface BalanceSimOptions {
  /** Games to play; the report says how many finished before the deadline. */
  games: number;
  seats: number;
  /** Round cap per game: the Conquest ending is domination or 65% of the board, so this is the backstop. */
  maxRounds: number;
  difficulty: BalanceDifficulty;
  /** Rules era; any Earth era works for a community map. */
  era: EraId;
  seed: string;
  /** Stop starting new games once this much wall time has passed. */
  deadlineMs?: number;
}

export interface BalanceRegionResult {
  region_id: string;
  name: string;
  /** Share of turn hand-offs at which one player held the whole region. */
  heldShare: number;
  /** Games in which someone held it at least once. */
  gamesHeld: number;
}

export interface BalanceSimReport {
  gamesPlayed: number;
  gamesRequested: number;
  seats: number;
  maxRounds: number;
  difficulty: BalanceDifficulty;
  era: EraId;
  /** Wins by seat index (the starting player rotates, so a skew here is the deal, not the first move). */
  seatWins: number[];
  /** Games won by whoever moved first. */
  firstMoverWins: number;
  /** Games that hit the round cap with no winner. */
  unfinished: number;
  rounds: { mean: number; min: number; max: number };
  endings: Record<string, number>;
  regions: BalanceRegionResult[];
  /** Territories that never changed hands after the deal, in any game. */
  neverCaptured: Array<{ territory_id: string; name: string }>;
  /** Mean round at which the first player was eliminated; null when nobody ever was. */
  firstEliminationRound: number | null;
  durationMs: number;
}

export const BALANCE_DEFAULTS = {
  /**
   * About this many games by default. A game costs around a tenth of a
   * second on a 50-territory map (measured: 8 games, 4 seats, medium bots
   * in 0.5-0.9 s on 44-111 territories), so twenty is a few seconds and a
   * far better sample for wins by seat than the eight the first cut played.
   */
  games: 20,
  /** Never fewer first moves per seat than this: the seat bars need the deal to repeat. */
  rotations: 5,
  /** Most games in one report: a multiple of 2, 3, 4 and 6, so the first move still rotates evenly. */
  maxGames: 36,
  seats: 4,
  maxRounds: 40,
  difficulty: 'medium' as BalanceDifficulty,
  era: 'modern' as EraId,
  deadlineMs: 20_000,
};

const SEAT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

/** The flags a live bot turn reads today. */
function liveAiTurnFlags(): AiTurnFlags {
  return {
    captureOddsScoring: featureFlags.aiCaptureOddsEnabled,
    attackGrind: featureFlags.aiAttackGrindEnabled,
    decidedGamePress: featureFlags.aiDecidedGamePressEnabled,
    oddsPress: featureFlags.aiOddsPressEnabled,
    plannedDraft: featureFlags.aiPlannedReinforcementsEnabled,
    endingPlay: featureFlags.aiEndingPlayEnabled,
    resignation: featureFlags.aiResignationEnabled,
    intents: featureFlags.aiIntentsEnabled,
    defense: featureFlags.aiDefenseEnabled,
  };
}

/** The first choice of an open event card, as the arena takes it. */
function resolveChoiceCard(state: GameState): void {
  const card = state.active_event;
  const choice = card?.choices?.[0];
  if (card && choice) resolveEventChoice(state, card.card_id, choice.choice_id);
}

/** processAiTurn's end of turn, less what only tells the room. */
function handOff(state: GameState, map: GameMap): void {
  advanceToNextPlayer(state, map);
  syncLaneWeatherLanes(map, state);
  syncSurgeProjectorLanes(map, state);
  state.last_transit_arrivals = undefined;
  if (state.active_event) {
    state.active_event_result = undefined;
    if (!state.active_event.choices?.length) state.active_event = undefined;
  }
}

/** Regions with enough territories on the board to pay, with their members. */
function payingRegions(map: GameMap): Map<string, string[]> {
  const byRegion = new Map<string, string[]>();
  for (const t of map.territories) {
    const list = byRegion.get(t.region_id) ?? [];
    list.push(t.territory_id);
    byRegion.set(t.region_id, list);
  }
  for (const [id, list] of byRegion) if (list.length < MIN_REGION_TERRITORIES) byRegion.delete(id);
  return byRegion;
}

interface GameOutcome {
  winnerSeat: number | null;
  startSeat: number;
  rounds: number;
  ending: string;
  /** Hand-offs at which each region was held whole, and hand-offs counted. */
  regionHolds: Map<string, number>;
  handOffs: number;
  changedHands: Set<string>;
  firstEliminationRound: number | null;
}

async function playGame(
  sourceMap: GameMap,
  options: BalanceSimOptions,
  gameIndex: number,
  regions: Map<string, string[]>,
): Promise<GameOutcome> {
  const map = structuredClone(sourceMap);
  const seats = options.seats;
  const startSeat = gameIndex % seats;
  const jitter = createSeededRng(hashStringToSeed(`${options.seed}:${gameIndex}`));
  const level: AiLevel = options.difficulty;
  const flags = liveAiTurnFlags();

  const players: Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>[] =
    Array.from({ length: seats }, (_, i) => ({
      player_id: `bot_${i}`,
      player_index: i,
      username: `Bot ${i + 1}`,
      color: SEAT_COLORS[i % SEAT_COLORS.length]!,
      is_ai: true,
      ai_difficulty: options.difficulty,
      is_eliminated: false,
      mmr: 1000,
    }));

  const settings = bakeCreateGameSettings({
    era_id: options.era,
    map_id: map.map_id,
    hasMoon: false,
    settings: {
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
      max_turns: options.maxRounds,
    },
  });

  const state = initializeGameState(`balance_${gameIndex}`, options.era, map, players, settings, {
    forceStartingPlayerIndex: startSeat,
  });
  const hooks = headlessAiTurnHooks(state, map);

  const ownerAtDeal = new Map(Object.entries(state.territories).map(([id, t]) => [id, t.owner_id] as const));
  const changedHands = new Set<string>();
  const regionHolds = new Map<string, number>();
  let handOffs = 0;
  let firstEliminationRound: number | null = null;

  const note = (): void => {
    handOffs += 1;
    for (const [id, t] of Object.entries(state.territories)) {
      if (t.owner_id !== ownerAtDeal.get(id)) changedHands.add(id);
    }
    for (const [regionId, members] of regions) {
      const owner = state.territories[members[0]!]?.owner_id;
      if (!owner) continue;
      if (members.every((m) => state.territories[m]?.owner_id === owner)) {
        regionHolds.set(regionId, (regionHolds.get(regionId) ?? 0) + 1);
      }
    }
    if (firstEliminationRound === null && state.players.some((p) => p.is_eliminated)) {
      firstEliminationRound = state.turn_number;
    }
  };

  const maxTurns = state.settings.max_turns ?? options.maxRounds;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (maxTurns + 2) * seats + 5) {
    guard += 1;
    const player = state.players[state.current_player_index]!;
    resolveChoiceCard(state);
    if (resignIfBeaten(state, player, level, flags.resignation)) {
      const victory = victoryAfterResignation(state, map);
      if (victory) {
        state.phase = 'game_over';
        state.winner_id = victory.winnerIds[0]!;
        state.winner_ids = victory.winnerIds;
        state.victory_condition = victory.condition;
        break;
      }
    } else {
      const plan = await planAiTurn(state, map, player, level, flags, {
        planningState: () => state,
        plan: async (s, m, d, o) => computeAiTurn(s, m, d, { ...o, rng: jitter }),
        rng: jitter,
      });
      const outcome = await playAiTurn(state, map, player, level, plan, 'draft', hooks);
      if (outcome === 'over') break;
    }
    handOff(state, map);
    note();
    if (await hooks.victoryCheck()) break;
  }

  const winnerSeat = state.winner_id ? Number(state.winner_id.split('_')[1]) : null;
  return {
    winnerSeat: Number.isFinite(winnerSeat) ? winnerSeat : null,
    startSeat,
    rounds: state.turn_number,
    ending: state.victory_condition ?? (state.phase === 'game_over' ? 'other' : 'round_cap'),
    regionHolds,
    handOffs,
    changedHands,
    firstEliminationRound,
  };
}

export async function simulateMapBalance(map: GameMap, options: BalanceSimOptions): Promise<BalanceSimReport> {
  const started = performance.now();
  const deadline = options.deadlineMs !== undefined ? started + options.deadlineMs : Infinity;
  const regions = payingRegions(map);
  const regionName = new Map(map.regions.map((r) => [r.region_id, r.name] as const));
  const territoryName = new Map(map.territories.map((t) => [t.territory_id, t.name] as const));

  const outcomes: GameOutcome[] = [];
  for (let i = 0; i < options.games; i++) {
    if (outcomes.length > 0 && performance.now() > deadline) break;
    outcomes.push(await playGame(map, options, i, regions));
  }

  const seatWins = Array.from({ length: options.seats }, () => 0);
  let firstMoverWins = 0;
  let unfinished = 0;
  const endings: Record<string, number> = {};
  const rounds: number[] = [];
  const eliminationRounds: number[] = [];
  const holdTotals = new Map<string, number>();
  const gamesHeld = new Map<string, number>();
  let handOffs = 0;
  const everChanged = new Set<string>();

  for (const o of outcomes) {
    if (o.winnerSeat === null) unfinished += 1;
    else {
      seatWins[o.winnerSeat] = (seatWins[o.winnerSeat] ?? 0) + 1;
      if (o.winnerSeat === o.startSeat) firstMoverWins += 1;
    }
    endings[o.ending] = (endings[o.ending] ?? 0) + 1;
    rounds.push(o.rounds);
    if (o.firstEliminationRound !== null) eliminationRounds.push(o.firstEliminationRound);
    handOffs += o.handOffs;
    for (const [regionId, count] of o.regionHolds) {
      holdTotals.set(regionId, (holdTotals.get(regionId) ?? 0) + count);
      if (count > 0) gamesHeld.set(regionId, (gamesHeld.get(regionId) ?? 0) + 1);
    }
    for (const id of o.changedHands) everChanged.add(id);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  return {
    gamesPlayed: outcomes.length,
    gamesRequested: options.games,
    seats: options.seats,
    maxRounds: options.maxRounds,
    difficulty: options.difficulty,
    era: options.era,
    seatWins,
    firstMoverWins,
    unfinished,
    rounds: { mean: mean(rounds), min: rounds.length ? Math.min(...rounds) : 0, max: rounds.length ? Math.max(...rounds) : 0 },
    endings,
    regions: [...regions.keys()].map((regionId) => ({
      region_id: regionId,
      name: regionName.get(regionId) ?? regionId,
      heldShare: handOffs > 0 ? (holdTotals.get(regionId) ?? 0) / handOffs : 0,
      gamesHeld: gamesHeld.get(regionId) ?? 0,
    })),
    neverCaptured: map.territories
      .filter((t) => !everChanged.has(t.territory_id))
      .map((t) => ({ territory_id: t.territory_id, name: territoryName.get(t.territory_id) ?? t.territory_id })),
    firstEliminationRound: eliminationRounds.length ? mean(eliminationRounds) : null,
    durationMs: Math.round(performance.now() - started),
  };
}
