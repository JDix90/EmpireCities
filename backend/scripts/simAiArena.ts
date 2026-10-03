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
 *   full   Full Game: Ancient start, era advancement, economy, tech, stability,
 *          naval and events, 150-round cap, on era_ancient.
 * Fog of war is off in both, as in those payloads, so every seat plans on the
 * full board.
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
 *   ARENA_RULES            quick | full (default quick)
 *   ARENA_MAPS             map ids (default: the rules' maps above)
 *   ARENA_CANDIDATE        candidate difficulty (default medium)
 *   ARENA_BASELINE         baseline difficulty (default medium)
 *   ARENA_CANDIDATE_FLAGS  name=0|1 overrides of the live AI flags, comma-separated:
 *   ARENA_BASELINE_FLAGS     captureOddsScoring, attackGrind, decidedGamePress.
 *                            Unset flags take the live code default.
 *   ARENA_CANDIDATE_PROFILE  JSON object of AiProfile fields that replace the
 *   ARENA_BASELINE_PROFILE     difficulty's row for that side.
 *   ARENA_SEED             master seed (default borderfall-ai-arena)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiDifficulty, EraId, GameMap, GameSettings, GameState } from '../src/types';
import { advanceToNextPlayer, initializeGameState } from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import { AI_PROFILES, type AiLevel, type AiProfile } from '../src/game-engine/ai/aiProfiles';
import {
  headlessAiTurnHooks,
  planAiTurn,
  playAiTurn,
  type AiTurnFlags,
  type AiTurnHooks,
} from '../src/game-engine/ai/runAiTurn';
import { resolveEventChoice } from '../src/game-engine/events/eventCardManager';
import { syncLaneWeatherLanes } from '../src/game-engine/state/laneWeather';
import { syncSurgeProjectorLanes } from '../src/game-engine/state/surgeProjector';
import { bakeCreateGameSettings, type CreateGameSettingsInput } from '../src/modules/games/createGameSettings';
import { featureFlags } from '../src/config/featureFlags';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { seedEngineRandomness, seededUuid } from './seededEngineRandomness';

const DIFFICULTIES: readonly AiDifficulty[] = ['tutorial', 'easy', 'medium', 'hard', 'expert'];

function difficulty(name: string, raw: string | undefined, fallback: AiDifficulty): AiDifficulty {
  const value = (raw ?? fallback).trim();
  if (!(DIFFICULTIES as readonly string[]).includes(value)) {
    throw new Error(`${name}=${value}: expected one of ${DIFFICULTIES.join(', ')}`);
  }
  return value as AiDifficulty;
}

/** The flags a live bot turn reads today, from the process's flag defaults. */
function liveFlags(): AiTurnFlags {
  return {
    captureOddsScoring: featureFlags.aiCaptureOddsEnabled,
    attackGrind: featureFlags.aiAttackGrindEnabled,
    decidedGamePress: featureFlags.aiDecidedGamePressEnabled,
  };
}

function flags(name: string, raw: string | undefined): AiTurnFlags {
  const out = liveFlags();
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [key, value] = part.split('=').map((s) => s.trim());
    if (!key || !(key in out) || (value !== '0' && value !== '1')) {
      throw new Error(`${name}: "${part}" is not name=0|1 for one of ${Object.keys(out).join(', ')}`);
    }
    out[key as keyof AiTurnFlags] = value === '1';
  }
  return out;
}

/**
 * A side's level: its difficulty, or with overrides a profile over that
 * difficulty's row. A field the table lacks, or a value of the wrong type, is
 * refused rather than ignored.
 */
function level(name: string, d: AiDifficulty, raw: string | undefined): AiLevel {
  if (!raw?.trim()) return d;
  const overrides = JSON.parse(raw) as Record<string, unknown>;
  const base = AI_PROFILES[d];
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in base) || key === 'difficulty') throw new Error(`${name}: ${key} is not an AiProfile setting`);
    if (typeof value !== typeof base[key as keyof AiProfile]) {
      throw new Error(`${name}: ${key} should be a ${typeof base[key as keyof AiProfile]}`);
    }
  }
  return { ...base, ...overrides } as AiProfile;
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
}

function seat(side: 'CANDIDATE' | 'BASELINE'): Seat {
  const d = difficulty(`ARENA_${side}`, process.env[`ARENA_${side}`], 'medium');
  return {
    difficulty: d,
    level: level(`ARENA_${side}_PROFILE`, d, process.env[`ARENA_${side}_PROFILE`]),
    flags: flags(`ARENA_${side}_FLAGS`, process.env[`ARENA_${side}_FLAGS`]),
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
};

const ruleset = RULESETS[RULES];
if (!ruleset) throw new Error(`ARENA_RULES=${RULES}: expected ${Object.keys(RULESETS).join(' or ')}`);
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
  return bakeCreateGameSettings({ era_id: era, map_id: mapId, hasMoon: false, settings: { ...ruleset!.settings } });
}

/**
 * processAiTurn opens by answering a choice card the turn drew, taking the
 * first choice (resolveChoiceCardForAi).
 */
function resolveChoiceCard(state: GameState): void {
  const card = state.active_event;
  const choice = card?.choices?.[0];
  if (card && choice) resolveEventChoice(state, card.card_id, choice.choice_id);
}

/**
 * processAiTurn's end of turn, less what only tells the room: the hand-off,
 * the lanes weather and an expired Surge Projector change, the transit
 * arrivals marker, and an instant event card the hand-off already applied
 * (broadcastEventCard clears it).
 */
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
  /** Dice exchanges, card sets traded and paced steps, by seat. */
  exchanges: number[];
  cardSets: number[];
  steps: number[];
  /** Bot turns played by each seat. */
  turns: number[];
}

interface Timing {
  /** Wall time of each bot turn with no pacing, in ms (not digested: it varies by machine). */
  turnMs: number[];
  /** Estimated live seconds of each bot turn: its paced steps at 0.6 s, plus its compute. */
  liveSeconds: number[];
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
function countingHooks(state: GameState, map: GameMap, record: GameRecord): AiTurnHooks {
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
      record.exchanges[seat()]! += 1;
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
    steps: zeros(),
    turns: zeros(),
  };
  const hooks = countingHooks(state, map, record);
  let sawRound10 = false;

  const maxTurns = state.settings.max_turns ?? 60;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (maxTurns + 2) * seatCount + 5) {
    guard += 1;
    if (!sawRound10 && state.turn_number >= 10) {
      sawRound10 = true;
      record.leaderAtRound10 = leaderSeat(state);
    }
    const player = state.players[state.current_player_index]!;
    const seat = seats[player.player_index]!;
    const stepsBefore = record.steps[player.player_index]!;
    const started = performance.now();

    resolveChoiceCard(state);
    const plan = await planAiTurn(state, map, player, seat.level, seat.flags, {
      planningState: () => state,
      plan: async (s, m, d, o) => computeAiTurn(s, m, d, { ...o, rng: jitter }),
    });
    const outcome = await playAiTurn(state, map, player, seat.level, plan, 'draft', hooks);
    record.turns[player.player_index]! += 1;

    const ms = performance.now() - started;
    timing.turnMs.push(ms);
    timing.liveSeconds.push((record.steps[player.player_index]! - stepsBefore) * 0.6 + ms / 1000);
    if (outcome === 'over') break;

    handOff(state, map);
    if (await hooks.victoryCheck()) break;
  }

  record.winnerSeat = state.winner_id ? Number(state.winner_id.split('_')[1]) : null;
  record.condition = state.victory_condition ?? null;
  record.rounds = state.turn_number;
  record.territories = state.players.map((p) => p.territory_count ?? 0);
  record.eras = state.players.map((p) => p.current_era_index ?? 0);
  return record;
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
  return hashStringToSeed(JSON.stringify(records)).toString(16).padStart(8, '0');
}

function describe(seat: Seat): string {
  const on = Object.entries(seat.flags).filter(([, v]) => v).map(([k]) => k);
  const base = AI_PROFILES[seat.difficulty];
  const changed = typeof seat.level === 'object'
    ? Object.entries(seat.level).filter(([k, v]) => base[k as keyof AiProfile] !== v).map(([k, v]) => `${k}=${String(v)}`)
    : [];
  return `${seat.difficulty}${changed.length ? ` with ${changed.join(', ')}` : ''} [${on.length ? on.join(', ') : 'no AI flags'}]`;
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
  console.log(`round-10 leader wins      ${pct(leaderWins, leaderKnown.length)} of ${leaderKnown.length} games with one leader`);
  console.log(`exchanges per turn        candidate ${seatMean((r) => r.exchanges, true).toFixed(2)}, baseline ${seatMean((r) => r.exchanges, false).toFixed(2)}`);
  console.log(`card sets per turn        candidate ${seatMean((r) => r.cardSets, true).toFixed(3)}, baseline ${seatMean((r) => r.cardSets, false).toFixed(3)}`);
  if (records.some((r) => r.eras.some((e) => e > 0))) {
    console.log(`final era index           candidate ${mean(records.map((r) => r.eras[r.candidateSeat]!)).toFixed(2)}, baseline ${mean(records.flatMap((r) => r.eras.filter((_, i) => i !== r.candidateSeat))).toFixed(2)}`);
  }
  console.log(`bot turn, p95             ${percentile(timing.turnMs, 95).toFixed(1)} ms compute; ~${percentile(timing.liveSeconds, 95).toFixed(1)} s live with pacing`);
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
  for (const seatCount of SEAT_COUNTS) {
    if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 6) throw new Error(`ARENA_SEATS: ${seatCount} is not 2 to 6`);
    const records: GameRecord[] = [];
    const timing: Timing = { turnMs: [], liveSeconds: [] };
    for (const mapId of MAP_IDS) {
      for (let i = 0; i < GAMES; i += 1) {
        records.push(await runGame(mapId, maps.get(mapId)!, seatCount, i, timing));
        if (process.stdout.isTTY) process.stdout.write(`  ${seatCount} seats: ${records.length}/${GAMES * MAP_IDS.length}\r`);
      }
    }
    report(seatCount, records, timing);
    all.push(...records);
  }
  if (SEAT_COUNTS.length > 1) console.log(`\nrun digest ${digest(all)}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
