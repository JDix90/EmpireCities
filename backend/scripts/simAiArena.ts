/**
 * Bot arena: seats bots at one table, each with its own difficulty and feature
 * flags, and plays whole games through planAiTurn and playAiTurn
 * (src/game-engine/ai/runAiTurn.ts), the same turn the live game runs. Card
 * trade-ins, captures' card draws, builds, research, era advances and faction
 * abilities all come with it; nothing here re-implements a rule.
 *
 * One seat is the candidate, the rest the baseline. Each side is a difficulty,
 * its feature flags, and optionally its own settings over that difficulty's
 * row in AI_PROFILES (src/game-engine/ai/aiProfiles.ts), which is how a change
 * to a level is tried before the table changes. The candidate's seat and
 * the starting player both rotate, so neither a seat nor the first move is
 * confounded with the logic under test. A fair share for the candidate is one
 * game in ARENA_SEATS.
 *
 * Every draw is seeded: the dice and every other `crypto` draw in the engine
 * (seededEngineRandomness.ts), the planner's score jitter, and the card ids.
 * Each configuration ends with a digest of every game's record, the same on
 * every run of that configuration and seed. A change meant to leave the bots
 * alone must leave the digest alone.
 *
 * Rules, from the lobby's own create payloads, baked by the server's
 * bakeCreateGameSettings:
 *   quick  Quick Match: classic rules, cards escalating, the default Conquest
 *          ending (domination, or 65% of the board; 60-round cap). Played on
 *          the six Quick Match maps.
 *   full-default  Full Game as the lobby makes it: Ancient start, era
 *          advancement, economy, tech, stability, naval and events, on
 *          era_ancient; the full-board ending, 150-round cap.
 *   full-evening  Full Game with full_game_evening_enabled: the 65% ending,
 *          80-round cap.
 *   full   Full Game's systems with the 65% ending and the 150-round cap. Not
 *          the lobby's default, whose ending is the whole board; kept so the
 *          runs and digests measured on it still compare.
 * Fog of war is off in all of them, as in those payloads, so every seat plans
 * on the full board. ARENA_SETTINGS='{"fog_of_war":true}' plays them under
 * fog, where each seat sees the board as a human in it would
 * (state/fogOfWar.ts seatView), as in a live game.
 *
 * Besides who wins and how long games run, the report measures how the
 * candidate plays, against what each commander's style promises: its attack
 * runs a turn and how many take their tile, its captures taken from the
 * weakest rival, the tiles rivals take from it, and its share of the board at
 * round 10. Compare a styled candidate with one of the same level and none.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simAiArena.ts
 *   ARENA_SEATS=2,4,6 ARENA_GAMES=100 ARENA_CANDIDATE=hard ARENA_BASELINE=medium \
 *     pnpm exec tsx scripts/simAiArena.ts
 *   ARENA_CANDIDATE_FLAGS=attackGrind=0 pnpm exec tsx scripts/simAiArena.ts
 *   ARENA_CANDIDATE_PROFILE='{"attackCap":6,"exchangeBudget":6}' pnpm exec tsx scripts/simAiArena.ts
 *
 * Settings (environment):
 *   ARENA_GAMES            games per map and seat count (default 50)
 *   ARENA_SEATS            seat counts, comma-separated (default 4)
 *   ARENA_RULES            quick | full-default | full-evening | full (default quick)
 *   ARENA_SETTINGS         JSON object of create settings laid over the rules' own,
 *                            to measure a variant (another ending or cap)
 *   ARENA_MAPS             map ids (default: the rules' maps above)
 *   ARENA_CANDIDATE        candidate difficulty (default medium)
 *   ARENA_BASELINE         baseline difficulty (default medium)
 *   ARENA_CANDIDATE_FLAGS  name=0|1 overrides of the live AI flags, comma-separated:
 *   ARENA_BASELINE_FLAGS     captureOddsScoring, attackGrind, decidedGamePress, oddsPress,
 *                            plannedDraft, endingPlay, resignation, intents.
 *                            Unset flags take the live code default.
 *   ARENA_CANDIDATE_PROFILE  JSON object of AiProfile fields that replace the
 *   ARENA_BASELINE_PROFILE     difficulty's row for that side.
 *   ARENA_CANDIDATE_STYLE    a commander's style for that side's seats
 *   ARENA_BASELINE_STYLE       (ai/aiStyles.ts): conqueror, raider, opportunist
 *                            or defender; random to draw each game's commanders
 *                            as a live game does; unset for none.
 *   ARENA_SEED             master seed (default borderfall-ai-arena)
 *   ARENA_RECORDS          a file to write every game's record to, one JSON line
 *                            each with its seat count, for measures the report
 *                            does not print (game lengths by ending, say)
 */
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AiDifficulty, AiIntent, EraId, GameMap, GameSettings, GameState } from '../src/types';
import { initializeGameState } from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import type { AiLevel } from '../src/game-engine/ai/aiProfiles';
import {
  headlessAiTurnHooks,
  planAiTurn,
  playAiTurn,
  type AiTurnFlags,
  type AiTurnHooks,
} from '../src/game-engine/ai/runAiTurn';
import { bakeCreateGameSettings, type CreateGameSettingsInput } from '../src/modules/games/createGameSettings';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { resignIfBeaten, victoryAfterResignation } from '../src/game-engine/ai/aiResign';
import { seatView } from '../src/game-engine/state/fogOfWar';
import { styledLevel, type AiStyle } from '../src/game-engine/ai/aiStyles';
import { AI_STYLES, drawAiCommanders } from '@borderfall/shared';
import { aiLevelChanges, describeAiTurnFlags, handOff, parseAiLevel, parseAiTurnFlags, resolveChoiceCard } from './aiHarness';
import { seedEngineRandomness, seededUuid } from './seededEngineRandomness';

const DIFFICULTIES: readonly AiDifficulty[] = ['tutorial', 'easy', 'medium', 'hard', 'expert'];

function difficulty(name: string, raw: string | undefined, fallback: AiDifficulty): AiDifficulty {
  const value = (raw ?? fallback).trim();
  if (!(DIFFICULTIES as readonly string[]).includes(value)) {
    throw new Error(`${name}=${value}: expected one of ${DIFFICULTIES.join(', ')}`);
  }
  return value as AiDifficulty;
}

const GAMES = Number(process.env.ARENA_GAMES ?? 50);
const SEAT_COUNTS = (process.env.ARENA_SEATS ?? '4').split(',').map((s) => Number(s.trim()));
const RULES = (process.env.ARENA_RULES ?? 'quick').trim();
const MASTER_SEED = process.env.ARENA_SEED ?? 'borderfall-ai-arena';
interface Seat {
  difficulty: AiDifficulty;
  /** What the turn is played at: the difficulty, or a profile over its row. */
  level: AiLevel;
  flags: AiTurnFlags;
  /** A commander's style for the side's seats, `random` to draw them, or none. */
  style?: AiStyle | 'random';
}

function seat(side: 'CANDIDATE' | 'BASELINE'): Seat {
  const d = difficulty(`ARENA_${side}`, process.env[`ARENA_${side}`], 'medium');
  const style = process.env[`ARENA_${side}_STYLE`]?.trim();
  if (style && style !== 'random' && !(AI_STYLES as readonly string[]).includes(style)) {
    throw new Error(`ARENA_${side}_STYLE=${style}: expected random or one of ${AI_STYLES.join(', ')}`);
  }
  return {
    difficulty: d,
    level: parseAiLevel(`ARENA_${side}_PROFILE`, d, process.env[`ARENA_${side}_PROFILE`]),
    flags: parseAiTurnFlags(`ARENA_${side}_FLAGS`, process.env[`ARENA_${side}_FLAGS`]),
    ...(style ? { style: style as AiStyle | 'random' } : {}),
  };
}
const CANDIDATE = seat('CANDIDATE');
const BASELINE = seat('BASELINE');

/** Each Quick Match map and the era the lobby creates it under (ERA_MAP_IDS). */
const QUICK_MATCH_MAPS: Record<string, EraId> = {
  era_ancient: 'ancient',
  era_medieval: 'medieval',
  era_discovery: 'discovery',
  era_ww2: 'ww2',
  era_coldwar: 'coldwar',
  era_modern: 'modern',
};

/** The create payloads LobbyPage sends: startQuickMatch and startFullGame. */
const RULESETS: Record<string, { maps: Record<string, EraId>; settings: CreateGameSettingsInput }> = {
  quick: {
    maps: QUICK_MATCH_MAPS,
    settings: {
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
      max_turns: 60,
    },
  },
  full: {
    maps: { era_ancient: 'ancient' },
    settings: {
      turn_timer_seconds: 300,
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: true,
      naval_enabled: true,
      events_enabled: true,
      era_advancement_enabled: true,
      era_advancement_preset: 'standard',
      era_advancement_max_lead: 2,
      max_turns: 150,
    },
  },
  'full-default': {
    maps: { era_ancient: 'ancient' },
    settings: {
      turn_timer_seconds: 300,
      allowed_victory_conditions: ['domination'],
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: true,
      naval_enabled: true,
      events_enabled: true,
      era_advancement_enabled: true,
      era_advancement_preset: 'standard',
      era_advancement_max_lead: 2,
      max_turns: 150,
    },
  },
  'full-evening': {
    maps: { era_ancient: 'ancient' },
    settings: {
      turn_timer_seconds: 300,
      allowed_victory_conditions: ['domination', 'threshold'],
      victory_threshold: 65,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      economy_enabled: true,
      tech_trees_enabled: true,
      stability_enabled: true,
      naval_enabled: true,
      events_enabled: true,
      era_advancement_enabled: true,
      era_advancement_preset: 'standard',
      era_advancement_max_lead: 2,
      max_turns: 80,
    },
  },
};

const ruleset = RULESETS[RULES];
if (!ruleset) throw new Error(`ARENA_RULES=${RULES}: expected ${Object.keys(RULESETS).join(' or ')}`);
/** ARENA_SETTINGS: a JSON object of create settings laid over the ruleset's, to measure a variant. */
const SETTINGS_OVERRIDE = ((): CreateGameSettingsInput => {
  const raw = process.env.ARENA_SETTINGS?.trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ARENA_SETTINGS: expected a JSON object');
  return parsed as CreateGameSettingsInput;
})();
const MAP_IDS = process.env.ARENA_MAPS
  ? process.env.ARENA_MAPS.split(',').map((s) => s.trim())
  : Object.keys(ruleset.maps);

function loadMap(id: string): GameMap {
  return JSON.parse(readFileSync(join(__dirname, `../../database/maps/${id}.json`), 'utf-8')) as GameMap;
}

function eraFor(mapId: string): EraId {
  const era = ruleset!.maps[mapId] ?? QUICK_MATCH_MAPS[mapId];
  if (!era) throw new Error(`No era known for map ${mapId}; add it to QUICK_MATCH_MAPS`);
  return era;
}

function settingsFor(mapId: string, era: EraId): GameSettings {
  return bakeCreateGameSettings({ era_id: era, map_id: mapId, hasMoon: false, settings: { ...ruleset!.settings, ...SETTINGS_OVERRIDE } });
}

interface GameRecord {
  map: string;
  game: number;
  candidateSeat: number;
  startSeat: number;
  winnerSeat: number | null;
  condition: string | null;
  rounds: number;
  /** Territories each seat held at the end, by seat. */
  territories: number[];
  /** Each seat's era index at the end (all 0 without era advancement). */
  eras: number[];
  /** The seat holding the most territories when round 10 began, or null on a tie. */
  leaderAtRound10: number | null;
  /** Dice exchanges, card sets traded, paid influences and paced steps, by seat. */
  exchanges: number[];
  cardSets: number[];
  influences: number[];
  steps: number[];
  /** Bot turns played by each seat. */
  turns: number[];
  /** The round each seat resigned in, 0 for none; only on a game where one did, so other digests stand. */
  resigned?: number[];
  /**
   * The candidate's turns holding each goal, and those whose goal it met that
   * turn (ai/aiIntent.ts); only on a game where it held one, so other digests stand.
   */
  intents?: Record<'take_region' | 'break_region' | 'hunt', { held: number; met: number }>;
  /**
   * With era advancement: the round any seat first reached each era past the
   * first, by era index (index 0 unused), 0 for an era nobody reached.
   */
  eraRounds?: number[];
  /** How the candidate played: what a commander's style promises (ai/aiStyles.ts). */
  behaviour?: Behaviour;
}

/**
 * The candidate's play, measured against what each style promises. Read off
 * the same games, so it stays out of the digest.
 */
interface Behaviour {
  /** Its attack runs (one per attack pressing on the odds), and those that took their tile. */
  runs: number;
  captures: number;
  /** Units it lost attacking. */
  attackLosses: number;
  /** Its captures from rivals, and those from a rival holding the fewest territories as its turn began. */
  rivalCaptures: number;
  weakestCaptures: number;
  /** Tiles rivals took from it, and the territories it held as each rival turn began. */
  tilesLost: number;
  tilesExposed: number;
  /** Its share of the board as round 10 began, or null if the game ended first. */
  shareAtRound10: number | null;
  /** Its captures and turns in rounds 1 to 10. */
  earlyCaptures: number;
  earlyTurns: number;
  /** The regions it held whole as round 10 began. */
  regionsAtRound10: number;
}

/** What the counting hooks need to see of the candidate. */
interface Watch {
  seat: number;
  playerId: string;
  /** Rivals holding the fewest territories as the candidate's turn began. */
  weakest: Set<string>;
  behaviour: Behaviour;
}

interface Timing {
  /** Wall time of each bot turn with no pacing, in ms (not digested: it varies by machine). */
  turnMs: number[];
  /** Estimated live seconds of each bot turn: its paced steps at 0.6 s, plus its compute. */
  liveSeconds: number[];
  /**
   * Per game, in record order: the other seats' live seconds while the
   * candidate, who stands in for a player, was still in the game.
   */
  othersSecondsWhileIn: number[];
}

function leaderSeat(state: GameState): number | null {
  let best = -1;
  let seat: number | null = null;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    const held = p.territory_count ?? 0;
    if (held > best) { best = held; seat = p.player_index; } else if (held === best) seat = null;
  }
  return seat;
}

/** Headless hooks that count, per seat, what the live game would have paced or announced. */
function countingHooks(state: GameState, map: GameMap, record: GameRecord, watch: Watch): AiTurnHooks {
  const base = headlessAiTurnHooks(state, map);
  const seat = (): number => state.players[state.current_player_index]!.player_index;
  return {
    ...base,
    delay: async () => {
      record.steps[seat()]! += 1;
    },
    emit: (event, payload) => {
      if (event === 'game:cards_redeemed') record.cardSets[seat()]! += 1;
      base.emit(event, payload);
    },
    recordCombat: (defenderId, result, options) => {
      // Pressing on the odds, one call carries a whole run of exchanges.
      record.exchanges[seat()]! += result.blitz_exchanges ?? 1;
      const b = watch.behaviour;
      if (seat() === watch.seat) {
        b.runs += 1;
        b.attackLosses += result.attacker_losses;
        if (result.territory_captured) {
          b.captures += 1;
          if (state.turn_number <= 10) b.earlyCaptures += 1;
          if (defenderId) {
            b.rivalCaptures += 1;
            if (watch.weakest.has(defenderId)) b.weakestCaptures += 1;
          }
        }
      } else if (defenderId === watch.playerId && result.territory_captured) {
        b.tilesLost += 1;
      }
      base.recordCombat(defenderId, result, options);
    },
  };
}

async function runGame(mapId: string, sourceMap: GameMap, seatCount: number, gameIndex: number, timing: Timing): Promise<GameRecord> {
  const map = structuredClone(sourceMap);
  const era = eraFor(mapId);
  const tag = `${MASTER_SEED}:${mapId}:${seatCount}:${gameIndex}`;
  seedEngineRandomness(`${tag}:engine`);
  const jitter = createSeededRng(hashStringToSeed(`${tag}:jitter`));

  const candidateSeat = gameIndex % seatCount;
  const startSeat = Math.floor(gameIndex / seatCount) % seatCount;
  const seats: Seat[] = Array.from({ length: seatCount }, (_, i) => (i === candidateSeat ? CANDIDATE : BASELINE));
  // Each seat's style this game: its side's, or drawn as a live game draws them.
  const drawn = drawAiCommanders(tag, seats.map((_, i) => i));
  const levels = seats.map((s, i) => styledLevel(s.level, s.style === 'random' ? drawn[i]!.style : s.style));
  const players = seats.map((seat, i) => ({
    player_id: `bot_${i}`,
    player_index: i,
    username: `Bot ${i}`,
    color: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'][i]!,
    is_ai: true,
    ai_difficulty: seat.difficulty,
    is_eliminated: false,
    mmr: 1000,
  }));
  const state = initializeGameState(`arena_${gameIndex}`, era, map, players, settingsFor(mapId, era), {
    forceStartingPlayerIndex: startSeat,
  });
  // The engine picks a card set by sorting on card id, and uuid drew these
  // before the seeded stream could (seededEngineRandomness.ts).
  for (const card of state.card_deck ?? []) card.card_id = seededUuid();

  const zeros = (): number[] => Array.from({ length: seatCount }, () => 0);
  const record: GameRecord = {
    map: mapId,
    game: gameIndex,
    candidateSeat,
    startSeat,
    winnerSeat: null,
    condition: null,
    rounds: 0,
    territories: [],
    eras: [],
    leaderAtRound10: null,
    exchanges: zeros(),
    cardSets: zeros(),
    influences: zeros(),
    steps: zeros(),
    turns: zeros(),
  };
  const candidate = state.players.find((p) => p.player_index === candidateSeat)!;
  const behaviour: Behaviour = {
    runs: 0, captures: 0, attackLosses: 0, rivalCaptures: 0, weakestCaptures: 0, tilesLost: 0, tilesExposed: 0,
    shareAtRound10: null, earlyCaptures: 0, earlyTurns: 0, regionsAtRound10: 0,
  };
  const watch: Watch = { seat: candidateSeat, playerId: candidate.player_id, weakest: new Set(), behaviour };
  const hooks = countingHooks(state, map, record, watch);
  let sawRound10 = false;
  let othersSecondsWhileIn = 0;
  const eraRounds = state.settings.era_advancement_enabled ? [0] : undefined;
  const noteEras = (): void => {
    if (!eraRounds) return;
    for (const p of state.players) {
      for (let k = 1; k <= (p.current_era_index ?? 0); k++) {
        if (!eraRounds[k]) eraRounds[k] = state.turn_number;
      }
    }
  };

  const maxTurns = state.settings.max_turns ?? 60;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (maxTurns + 2) * seatCount + 5) {
    guard += 1;
    if (!sawRound10 && state.turn_number >= 10) {
      sawRound10 = true;
      record.leaderAtRound10 = leaderSeat(state);
      behaviour.shareAtRound10 = (candidate.territory_count ?? 0) / Object.keys(state.territories).length;
      behaviour.regionsAtRound10 = wholeRegions(state, map, candidate.player_id);
    }
    const player = state.players[state.current_player_index]!;
    const seat = seats[player.player_index]!;
    const stepsBefore = record.steps[player.player_index]!;
    const candidateWasIn = !candidate.is_eliminated;
    const cooldownBefore = state.influence_cooldown_remaining ?? 0;
    const started = performance.now();
    if (player.player_index === candidateSeat) {
      watch.weakest = weakestRivals(state, candidate.player_id);
      if (state.turn_number <= 10) behaviour.earlyTurns += 1;
    } else if (candidateWasIn) {
      behaviour.tilesExposed += candidate.territory_count ?? 0;
    }

    resolveChoiceCard(state);
    // processAiTurn's opening: a beaten bot resigns before it plans.
    const level = levels[player.player_index]!;
    if (resignIfBeaten(state, player, level, seat.flags.resignation)) {
      (record.resigned ??= zeros())[player.player_index] = state.turn_number;
      const victory = victoryAfterResignation(state, map);
      if (victory) {
        state.phase = 'game_over';
        state.winner_id = victory.winnerIds[0]!;
        state.winner_ids = victory.winnerIds;
        state.victory_condition = victory.condition;
        break;
      }
    } else {
      const plan = await planAiTurn(state, map, player, level, seat.flags, {
        planningState: () => seatView(state, map, player.player_id),
        plan: async (s, m, d, o) => computeAiTurn(s, m, d, { ...o, rng: jitter }),
        rng: jitter,
      });
      const goal = player.player_index === candidateSeat ? player.ai_intent : undefined;
      const outcome = await playAiTurn(state, map, player, level, plan, 'draft', hooks);
      record.turns[player.player_index]! += 1;
      if (goal) {
        const tally = (record.intents ??= {
          take_region: { held: 0, met: 0 }, break_region: { held: 0, met: 0 }, hunt: { held: 0, met: 0 },
        })[goal.kind];
        tally.held += 1;
        if (intentMet(state, map, player.player_id, goal)) tally.met += 1;
      }
      // A paid influence is the only thing that starts the cooldown.
      if (cooldownBefore === 0 && (state.influence_cooldown_remaining ?? 0) > 0) record.influences[player.player_index]! += 1;

      const ms = performance.now() - started;
      const live = (record.steps[player.player_index]! - stepsBefore) * 0.6 + ms / 1000;
      timing.turnMs.push(ms);
      timing.liveSeconds.push(live);
      if (candidateWasIn && player.player_index !== candidateSeat) othersSecondsWhileIn += live;
      noteEras();
      if (outcome === 'over') break;
    }

    handOff(state, map);
    if (await hooks.victoryCheck()) break;
  }

  record.winnerSeat = state.winner_id ? Number(state.winner_id.split('_')[1]) : null;
  record.condition = state.victory_condition ?? null;
  record.rounds = state.turn_number;
  record.territories = state.players.map((p) => p.territory_count ?? 0);
  record.eras = state.players.map((p) => p.current_era_index ?? 0);
  if (eraRounds) record.eraRounds = Array.from({ length: Math.max(...record.eras, 0) + 1 }, (_, k) => eraRounds[k] ?? 0);
  record.behaviour = behaviour;
  timing.othersSecondsWhileIn.push(othersSecondsWhileIn);
  return record;
}

/** The living rivals of `playerId` holding the fewest territories. */
function weakestRivals(state: GameState, playerId: string): Set<string> {
  const rivals = state.players.filter((p) => !p.is_eliminated && p.player_id !== playerId);
  const fewest = Math.min(...rivals.map((p) => p.territory_count ?? 0));
  return new Set(rivals.filter((p) => (p.territory_count ?? 0) === fewest).map((p) => p.player_id));
}

/** The regions whose every territory in play `playerId` holds. */
function wholeRegions(state: GameState, map: GameMap, playerId: string): number {
  const regions = new Map<string, boolean>();
  for (const t of map.territories) {
    const tile = state.territories[t.territory_id];
    if (!tile) continue;
    regions.set(t.region_id, (regions.get(t.region_id) ?? true) && tile.owner_id === playerId);
  }
  return [...regions.values()].filter(Boolean).length;
}

/** Whether `goal` was met: its region held whole, its rival's region broken, its quarry out. */
function intentMet(state: GameState, map: GameMap, playerId: string, goal: AiIntent): boolean {
  if (goal.kind === 'hunt') return !!state.players.find((p) => p.player_id === goal.target)?.is_eliminated;
  const owners = map.territories
    .filter((t) => t.region_id === goal.target && state.territories[t.territory_id])
    .map((t) => state.territories[t.territory_id]!.owner_id);
  return goal.kind === 'take_region'
    ? owners.every((o) => o === playerId)
    : new Set(owners).size > 1;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

function digest(records: GameRecord[]): string {
  // The era timeline and the candidate's behaviour are read off the same
  // games, so they stay out and every digest from before them still stands.
  return hashStringToSeed(JSON.stringify(records, (k, v) => (k === 'eraRounds' || k === 'behaviour' ? undefined : v))).toString(16).padStart(8, '0');
}

function describe(seat: Seat): string {
  const changed = [...aiLevelChanges(seat.difficulty, seat.level), ...(seat.style ? [`style=${seat.style}`] : [])];
  return `${seat.difficulty}${changed.length ? ` with ${changed.join(', ')}` : ''} [${describeAiTurnFlags(seat.flags)}]`;
}

function report(seatCount: number, records: GameRecord[], timing: Timing): void {
  const decided = records.filter((r) => r.condition !== 'turn_limit');
  const candidateWins = records.filter((r) => r.winnerSeat === r.candidateSeat).length;
  const leaderKnown = records.filter((r) => r.leaderAtRound10 !== null);
  const leaderWins = leaderKnown.filter((r) => r.winnerSeat === r.leaderAtRound10).length;
  const seatMean = (pick: (r: GameRecord) => number[], candidate: boolean): number =>
    mean(records.map((r) => {
      const values = pick(r);
      const turns = r.turns;
      const idx = values.map((_, i) => i).filter((i) => (i === r.candidateSeat) === candidate);
      const total = idx.reduce((s, i) => s + values[i]!, 0);
      const played = idx.reduce((s, i) => s + turns[i]!, 0);
      return played === 0 ? 0 : total / played;
    }));

  console.log(`\n── ${seatCount} seats, ${records.length} games ─────────────────────────`);
  console.log(`candidate wins            ${candidateWins}  (${pct(candidateWins, records.length)}; fair share ${pct(1, seatCount)})`);
  console.log(`decided before the cap    ${decided.length}  (${pct(decided.length, records.length)})`);
  console.log(`mean rounds (decided)     ${mean(decided.map((r) => r.rounds)).toFixed(1)}`);
  console.log(`mean rounds (all)         ${mean(records.map((r) => r.rounds)).toFixed(1)}`);
  console.log(`median rounds (all)       ${median(records.map((r) => r.rounds)).toFixed(1)}`);
  console.log(`round-10 leader wins      ${pct(leaderWins, leaderKnown.length)} of ${leaderKnown.length} games with one leader`);
  const resigning = records.filter((r) => r.resigned);
  if (resigning.length > 0) {
    const resignations = resigning.flatMap((r) => r.resigned!.filter((n) => n > 0));
    const endedBy = records.filter((r) => r.condition === 'resignation').length;
    console.log(`resignations              ${resignations.length} in ${resigning.length} games; ${endedBy} games (${pct(endedBy, records.length)}) ended by one; mean round ${mean(resignations).toFixed(1)}`);
  }
  const goals = records.filter((r) => r.intents);
  if (goals.length > 0) {
    const turns = records.reduce((s, r) => s + r.turns[r.candidateSeat]!, 0);
    const kinds = (['take_region', 'break_region', 'hunt'] as const).map((k) => {
      const held = goals.reduce((s, r) => s + r.intents![k].held, 0);
      const met = goals.reduce((s, r) => s + r.intents![k].met, 0);
      return `${k} ${pct(held, turns)} (met ${pct(met, held)})`;
    });
    console.log(`candidate goals           ${kinds.join(', ')} of its turns`);
  }
  console.log(`exchanges per turn        candidate ${seatMean((r) => r.exchanges, true).toFixed(2)}, baseline ${seatMean((r) => r.exchanges, false).toFixed(2)}`);
  // What each style promises (ai/aiStyles.ts), for the candidate.
  const b = records.map((r) => r.behaviour!).filter(Boolean);
  const sum = (pick: (x: Behaviour) => number): number => b.reduce((s, x) => s + pick(x), 0);
  const candidateTurnsAll = records.reduce((s, r) => s + r.turns[r.candidateSeat]!, 0);
  const shares = b.map((x) => x.shareAtRound10).filter((x): x is number => x !== null);
  console.log(`candidate attacks         ${(sum((x) => x.runs) / Math.max(1, candidateTurnsAll)).toFixed(2)} runs a turn, ${pct(sum((x) => x.captures), sum((x) => x.runs))} taken, ${(sum((x) => x.attackLosses) / Math.max(1, sum((x) => x.captures))).toFixed(2)} units lost a capture`);
  console.log(`candidate targets         ${pct(sum((x) => x.weakestCaptures), sum((x) => x.rivalCaptures))} of captures from rivals taken from the weakest`);
  console.log(`candidate holds           ${(100 * sum((x) => x.tilesLost) / Math.max(1, sum((x) => x.tilesExposed))).toFixed(2)} tiles lost per 100 held through a rival's turn`);
  console.log(`candidate early           ${(100 * mean(shares)).toFixed(1)}% of the board at round 10; ${(sum((x) => x.earlyCaptures) / Math.max(1, sum((x) => x.earlyTurns))).toFixed(2)} captures a turn in rounds 1-10; ${mean(b.filter((x) => x.shareAtRound10 !== null).map((x) => x.regionsAtRound10)).toFixed(2)} whole regions at round 10`);
  if (records.some((r) => r.influences.some((n) => n > 0))) {
    console.log(`influences per game       candidate ${mean(records.map((r) => r.influences[r.candidateSeat]!)).toFixed(2)}, baseline seat ${mean(records.flatMap((r) => r.influences.filter((_, i) => i !== r.candidateSeat))).toFixed(2)}`);
  }
  console.log(`card sets per turn        candidate ${seatMean((r) => r.cardSets, true).toFixed(3)}, baseline ${seatMean((r) => r.cardSets, false).toFixed(3)}`);
  if (records.some((r) => r.eras.some((e) => e > 0))) {
    console.log(`final era index           candidate ${mean(records.map((r) => r.eras[r.candidateSeat]!)).toFixed(2)}, baseline ${mean(records.flatMap((r) => r.eras.filter((_, i) => i !== r.candidateSeat))).toFixed(2)}`);
  }
  const endings = new Map<string, number>();
  for (const r of records) endings.set(r.condition ?? 'none', (endings.get(r.condition ?? 'none') ?? 0) + 1);
  console.log(`ended by                  ${[...endings].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${pct(n, records.length)}`).join(', ')}`);
  const timelines = records.filter((r) => r.eraRounds);
  if (timelines.length > 0) {
    const top = Math.max(...timelines.map((r) => r.eraRounds!.length - 1));
    const steps: string[] = [];
    for (let k = 1; k <= top; k++) {
      const reached = timelines.map((r) => r.eraRounds![k] ?? 0).filter((n) => n > 0);
      steps.push(`${k}: ${pct(reached.length, records.length)} by round ${median(reached).toFixed(0)}`);
    }
    console.log(`era first reached         ${steps.join('; ')} (median round, among games that reached it)`);
  }
  // Minutes for the candidate, standing in for a player, until the game ends
  // or it is out: its own turns at a fixed length, plus the other seats' paced turns.
  const candidateTurns = records.map((r) => r.turns[r.candidateSeat]!);
  const others = timing.othersSecondsWhileIn;
  const out = records.filter((r) => r.winnerSeat !== r.candidateSeat && r.territories[r.candidateSeat] === 0).length;
  console.log(`player's game             ${median(candidateTurns).toFixed(0)} own turns (median); out before the end ${pct(out, records.length)}; other seats ~${(mean(others) / Math.max(1, mean(candidateTurns))).toFixed(1)} s a round`);
  for (const turnSeconds of [45, 60, 90]) {
    const minutes = records.map((_, i) => (candidateTurns[i]! * turnSeconds + others[i]!) / 60);
    console.log(`  minutes at ${String(turnSeconds).padStart(2)} s a turn  median ${median(minutes).toFixed(0)}, 80th pct ${percentile(minutes, 80).toFixed(0)}, over 120 ${pct(minutes.filter((m) => m > 120).length, minutes.length)}`);
  }
  console.log(`bot turn, p95             ${percentile(timing.turnMs, 95).toFixed(1)} ms compute; ~${percentile(timing.liveSeconds, 95).toFixed(1)} s live with pacing (longest ~${timing.liveSeconds.reduce((a, b) => Math.max(a, b), 0).toFixed(1)} s)`);
  for (const mapId of MAP_IDS) {
    const rows = records.filter((r) => r.map === mapId);
    const wins = rows.filter((r) => r.winnerSeat === r.candidateSeat).length;
    console.log(`  ${mapId.padEnd(22)} candidate ${pct(wins, rows.length).padStart(6)}  rounds ${mean(rows.map((r) => r.rounds)).toFixed(1)}`);
  }
  console.log(`digest ${digest(records)}`);
}

(async () => {
  console.log(
    `AI arena: rules=${RULES}, ${GAMES} games per map and table, seats=${SEAT_COUNTS.join('/')}, seed="${MASTER_SEED}"\n` +
    `candidate: ${describe(CANDIDATE)}\nbaseline:  ${describe(BASELINE)}\nmaps: ${MAP_IDS.join(', ')}`,
  );
  const maps = new Map(MAP_IDS.map((id) => [id, loadMap(id)]));
  const all: GameRecord[] = [];
  const recordsFile = process.env.ARENA_RECORDS?.trim();
  if (recordsFile) writeFileSync(recordsFile, '');
  for (const seatCount of SEAT_COUNTS) {
    if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 6) throw new Error(`ARENA_SEATS: ${seatCount} is not 2 to 6`);
    const records: GameRecord[] = [];
    const timing: Timing = { turnMs: [], liveSeconds: [], othersSecondsWhileIn: [] };
    for (const mapId of MAP_IDS) {
      for (let i = 0; i < GAMES; i += 1) {
        records.push(await runGame(mapId, maps.get(mapId)!, seatCount, i, timing));
        if (process.stdout.isTTY) process.stdout.write(`  ${seatCount} seats: ${records.length}/${GAMES * MAP_IDS.length}\r`);
      }
    }
    report(seatCount, records, timing);
    if (recordsFile) appendFileSync(recordsFile, records.map((r) => `${JSON.stringify({ seats: seatCount, ...r })}\n`).join(''));
    all.push(...records);
  }
  if (SEAT_COUNTS.length > 1) console.log(`\nrun digest ${digest(all)}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
