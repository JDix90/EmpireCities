/**
 * Headless AI-vs-AI era-advancement balance simulator (EA-502).
 *
 * Drives the PURE game engine — no sockets, no DB — for N games and reports
 * advancement-balance stats. Combat goes through executeLandAttack, so the
 * era-gap dice and vulnerability window are modeled faithfully for the land
 * ruleset this sim uses (factions / naval / events / cards OFF; economy + tech +
 * stability + era advancement ON; domination victory with a turn cap).
 *
 * Every game is FULLY seeded off `masterSeed + game index`: combat dice, and —
 * via `InitializeGameStateOptions.rng` — the opening position (territory
 * distribution, card deck, faction draws). Two runs at the same `SIM_SEED`
 * therefore play the same games, which is what makes comparing two rulesets
 * meaningful. Before EA-503 only the dice were seeded and every run redrew the
 * starting position from a CSPRNG, so identical invocations differed by several
 * points of win rate and no cross-run comparison was sound. Vary `SIM_SEED` to
 * sample different starts.
 *
 * THE QUESTION THIS HARNESS EXISTS TO ANSWER (EA-503): does advancing pay? The
 * old headline stat — first-advancer win rate — cannot answer it, because the
 * player who reaches the gate first is the one with the best economy; it
 * measures selection, not causation. `SIM_P0_POLICY` answers it by holding the
 * economy fixed and varying only the advance decision, and `SIM_POLICY_AB=1`
 * runs both arms over the same seeds and checks the acceptance bar. Use that
 * for any era-advancement balance claim. See eraBalanceTuning.md.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simEraBalance.ts
 *   SIM_POLICY_AB=1 SIM_GAMES=500 pnpm exec tsx scripts/simEraBalance.ts
 *   SIM_GAMES=500 SIM_PLAYERS=4 SIM_DIFFICULTY=expert SIM_MAX_TURNS=70 \
 *     SIM_SEED=borderfall SIM_CSV=/tmp/era_balance.csv pnpm exec tsx scripts/simEraBalance.ts
 *
 * Knobs:
 *   SIM_GAMES SIM_PLAYERS SIM_DIFFICULTY SIM_MAX_TURNS SIM_SEED SIM_CSV
 *   SIM_P0_POLICY   ai (default) | always | never | when_behind — seat 0's
 *                   advance decision. Anything but `ai` also pins seat 0 to
 *                   expert, so the arms differ ONLY in when they advance.
 *   SIM_POLICY_AB   1 = run `always` and `never` over the same seeds and print
 *                   the gap plus a PASS/FAIL against the acceptance bar.
 *   SIM_GROWTH      0 = suppress era territory growth (default ON, matching
 *                   production). See the note on `GROWTH` below.
 *   SIM_MAX_LEAD    era_advancement_max_lead (hard lead cap; default off)
 *   SIM_CONV SIM_COST_MULT SIM_VULN SIM_GAP_DICE
 *                   override the matching era_advancement_* settings, for
 *                   sweeping a tuning lever without editing code.
 *   SIM_RULES       comma list of PROPOSED rules to model — see
 *                   scripts/eraIncentivePrototypes.ts. Sim-only, not engine
 *                   behaviour. e.g. SIM_RULES=gate,expedition,renaissance
 *   SIM_GRACE SIM_GARRISON_CAP SIM_HEG_PCT SIM_HEG_TURNS SIM_HEG_MIN_ERA
 *                   tuning for those prototypes.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { AiDifficulty, GameMap, GameSettings, GameState } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  initializeGameState,
} from '../src/game-engine/state/gameStateManager';
import { computeAiTurn, selectAiBuildingPlacement, selectAiTechResearch } from '../src/game-engine/ai/aiBot';
import { evaluateAiEraAdvancement } from '../src/game-engine/ai/aiEraAdvancement';
import { canAdvanceEra, executeAdvanceEra } from '../src/game-engine/eraAdvancement/advanceEra';
import { evaluateEraAdvancementReadiness } from '../src/game-engine/eraAdvancement/eraAdvancementReadiness';
import { unlockTerritoriesForFloor } from '../src/game-engine/eraAdvancement/territoryUnlock';
import { getEmpireWeightedStability } from '../src/game-engine/state/stabilityManager';
import { getMaxEraIndex } from '../src/game-engine/eraAdvancement/spines';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import {
  aiAttackExchangeBudget,
  runAiAttackExchanges,
  shouldPressDecidedGame,
} from '../src/game-engine/ai/aiAttackGrind';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import {
  DEFAULT_INCENTIVE_OPTIONS,
  IncentiveModel,
  parseIncentiveRules,
} from './eraIncentivePrototypes';

const GAMES = Number(process.env.SIM_GAMES ?? 200);
const PLAYERS = Number(process.env.SIM_PLAYERS ?? 4);
const DIFFICULTY = (process.env.SIM_DIFFICULTY ?? 'expert') as AiDifficulty;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 70);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-era-balance';
const CSV_PATH = process.env.SIM_CSV ?? '';

/**
 * Seat 0's advancement policy — the instrument that makes "does advancing pay?"
 * a causal question. Every seat runs the same expert economy; only seat 0's
 * advance decision is fixed, so the win-rate difference between `always` and
 * `never` is the value of advancing and nothing else.
 */
export type P0Policy = 'ai' | 'always' | 'never' | 'when_behind';
const P0_POLICIES: readonly P0Policy[] = ['ai', 'always', 'never', 'when_behind'];
// SIM_PROXY_LEADER=1 is the old spelling of `always`; kept so existing
// invocations and the numbers in eraBalanceTuning.md still reproduce.
const PROXY_LEADER = process.env.SIM_PROXY_LEADER === '1';
const P0_POLICY = (process.env.SIM_P0_POLICY ?? (PROXY_LEADER ? 'always' : 'ai')) as P0Policy;
const POLICY_AB = process.env.SIM_POLICY_AB === '1';

/**
 * Era territory growth. Production unlocks `unlock_era_index` frontiers as
 * neutral land when the global era floor rises (gameSocket `applyEraBoardChange`
 * → `unlockTerritoriesForFloor`), and era_ancient tags 29 of its 57 territories
 * that way — so a sweep that never grows the board is not measuring the shipped
 * game. Default ON; `SIM_GROWTH=0` reproduces pre-EA-503 baselines.
 */
const GROWTH = process.env.SIM_GROWTH !== '0';

const MAX_LEAD = process.env.SIM_MAX_LEAD != null ? Number(process.env.SIM_MAX_LEAD) : null;
const CONV = process.env.SIM_CONV != null ? Number(process.env.SIM_CONV) : null;
const COST_MULT = process.env.SIM_COST_MULT != null ? Number(process.env.SIM_COST_MULT) : null;
const VULN = process.env.SIM_VULN != null ? Number(process.env.SIM_VULN) : null;
const GAP_DICE = process.env.SIM_GAP_DICE != null ? Number(process.env.SIM_GAP_DICE) : null;

const RULES = parseIncentiveRules(process.env.SIM_RULES);
const INCENTIVE_OPTIONS = {
  graceRounds: Number(process.env.SIM_GRACE ?? DEFAULT_INCENTIVE_OPTIONS.graceRounds),
  garrisonCap: Number(process.env.SIM_GARRISON_CAP ?? DEFAULT_INCENTIVE_OPTIONS.garrisonCap),
  hegemonyPct: Number(process.env.SIM_HEG_PCT ?? DEFAULT_INCENTIVE_OPTIONS.hegemonyPct),
  hegemonyTurns: Number(process.env.SIM_HEG_TURNS ?? DEFAULT_INCENTIVE_OPTIONS.hegemonyTurns),
  hegemonyMinEra: Number(process.env.SIM_HEG_MIN_ERA ?? DEFAULT_INCENTIVE_OPTIONS.hegemonyMinEra),
  expeditionUnits: Number(process.env.SIM_EXPEDITION_UNITS ?? DEFAULT_INCENTIVE_OPTIONS.expeditionUnits),
};

/**
 * Acceptance bar for any era-advancement balance change (EA-503).
 *  • Advancing must PAY: seat 0 wins at least this many points more on `always`
 *    than on `never`, in 4p.
 *  • …but must not STEAMROLL: the era laggard at turn 20 must still win often
 *    enough that trailing is a position, not a death sentence.
 */
const ACCEPTANCE_POLICY_GAP_PTS = 5;
const ACCEPTANCE_LAGGARD_FLOOR_PCT = 5;

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

function loadMap(): GameMap {
  const raw = readFileSync(join(__dirname, '../../database/maps/era_ancient.json'), 'utf-8');
  return JSON.parse(raw) as GameMap;
}

function simSettings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    factions_enabled: false,
    naval_enabled: false,
    events_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    era_advancement_enabled: true,
    era_advancement_preset: 'standard', // classic spine
    ...(MAX_LEAD != null ? { era_advancement_max_lead: MAX_LEAD } : {}),
    ...(CONV != null ? { era_advancement_conversion_ratio: CONV } : {}),
    ...(COST_MULT != null ? { era_advancement_cost_mult: COST_MULT } : {}),
    ...(VULN != null ? { era_advancement_vuln_defense_mult: VULN } : {}),
    ...(GAP_DICE != null ? { era_advancement_combat_gap_dice: GAP_DICE } : {}),
    allowed_victory_conditions: ['domination'],
    victory_type: 'domination',
    max_turns: MAX_TURNS,
  } as GameSettings;
}

function seededDie(seed: number): () => number {
  const rng = createSeededRng(seed);
  return () => Math.floor(rng() * 6) + 1;
}

/**
 * `randomInt(min, max)`-shaped draw over a seeded stream, for
 * `InitializeGameStateOptions.rng`. Kept on its own stream so a ruleset that
 * changes how many dice get rolled cannot shift the opening position too.
 */
function seededInitRng(seed: number): (min: number, max: number) => number {
  const rng = createSeededRng(seed);
  return (min, max) => min + Math.floor(rng() * (max - min));
}

function ownedIds(state: GameState, pid: string): string[] {
  return Object.keys(state.territories).filter((t) => state.territories[t].owner_id === pid).sort();
}

/** Place all reinforcements on the AI's chosen draft target (fallback: first owned). */
function applyDraft(state: GameState, pid: string, plan: AiAction[]): void {
  const remaining = state.draft_units_remaining ?? 0;
  if (remaining <= 0) return;
  const owned = ownedIds(state, pid);
  if (owned.length === 0) { state.draft_units_remaining = 0; return; }
  const planned = plan.find((a) => a.type === 'draft' && a.to && state.territories[a.to]?.owner_id === pid)?.to;
  const target = planned ?? owned[0];
  state.territories[target].unit_count += remaining;
  state.draft_units_remaining = 0;
}

function applyFortify(state: GameState, pid: string, from: string, to: string, units?: number): void {
  const f = state.territories[from];
  const t = state.territories[to];
  if (!f || !t || f.owner_id !== pid || t.owner_id !== pid) return;
  const move = Math.min(units ?? f.unit_count - 1, f.unit_count - 1);
  if (move <= 0) return;
  f.unit_count -= move;
  t.unit_count += move;
}

/**
 * The AI build picker stops buying once the building gate is met and the purse
 * is short of the advance fare, so a trailing bot can actually bank it
 * (aiBot.ts § "Era-advance fund"). A seat that has DECIDED never to advance has
 * no fare to bank, and leaving the reservation on would hand it an idle
 * treasury — measured at several points of win rate, all of them charged
 * against the stall arm, which is the arm that must not be flattered.
 *
 * Suppressing `era_advancement_enabled` across the pick is the narrowest way to
 * express that: within this function the flag reaches only the reservation and
 * an easy-difficulty early return, and a policy seat is always expert.
 */
function pickBuild(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  policy: P0Policy,
): ReturnType<typeof selectAiBuildingPlacement> {
  if (policy !== 'never') return selectAiBuildingPlacement(state, map, pid, difficulty);
  const saved = state.settings.era_advancement_enabled;
  state.settings.era_advancement_enabled = false;
  try {
    return selectAiBuildingPlacement(state, map, pid, difficulty);
  } finally {
    state.settings.era_advancement_enabled = saved;
  }
}

/** Resolve seat 0's fixed policy into this turn's advance decision. */
function shouldAdvanceUnderPolicy(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  policy: P0Policy,
): boolean {
  if (policy === 'ai') return evaluateAiEraAdvancement(state, map, pid, difficulty).shouldAdvance;
  if (policy === 'never') return false;
  if (!canAdvanceEra(state, pid).canAdvance) return false;
  if (policy === 'always') return true;
  // when_behind: climb only to keep pace — the "advance defensively" strategy.
  const me = state.players.find((p) => p.player_id === pid);
  const rivalMax = Math.max(
    0,
    ...state.players.filter((p) => p.player_id !== pid && !p.is_eliminated).map((p) => p.current_era_index ?? 0),
  );
  return (me?.current_era_index ?? 0) < rivalMax;
}

interface AdvanceEvent { pid: string; turn: number; }

/** Play one AI player's full turn, mirroring processAiTurn's pure-engine sequence. */
async function playAiTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  jitter: () => number,
  advances: AdvanceEvent[],
  incentives: IncentiveModel,
  policy: P0Policy = 'ai',
): Promise<void> {
  state.phase = 'draft';
  // Decidedness read pre-planning from full state — the same order the socket
  // uses (the sim has no fog, so its full state IS the socket's authoritative
  // read).
  const decidedPress = shouldPressDecidedGame(state, pid, difficulty);
  const plan = computeAiTurn(state, map, difficulty, {
    captureOddsScoring: true,
    decidedGamePress: decidedPress,
    // Seeded heuristic jitter. Live AI deliberately uses Math.random; a sweep
    // must not, or two arms diverge on coin-flips rather than on the rule
    // under test.
    rng: jitter,
  }); // planned pre-advance, like the socket

  // Economy FIRST (matches processAiTurn): build + research before the advance
  // check so a bot that just met the gate can advance the same turn.
  const build = pickBuild(state, map, pid, difficulty, policy);
  if (build) applyBuild(state, pid, build.territoryId, build.buildingType);
  const techId = selectAiTechResearch(state, pid, difficulty);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) applyResearch(state, pid, v.node);
  }

  if (state.settings.era_advancement_enabled) {
    if (shouldAdvanceUnderPolicy(state, map, pid, difficulty, policy) && executeAdvanceEra(state, pid).success) {
      advances.push({ pid, turn: state.turn_number });
      // Mirrors gameSocket `applyEraBoardChange`: raising the global era floor
      // adds the newly reachable frontiers as neutral, garrisoned land.
      if (GROWTH) incentives.noteUnlocked(state, unlockTerritoriesForFloor(state, map));
      incentives.onAdvance(state, pid);
    }
  }

  applyDraft(state, pid, plan);

  state.phase = 'attack';
  // The shipped executor, not a copy of it: attacks spend a turn-wide exchange
  // budget through the SAME runAiAttackExchanges the socket drives, sea lanes
  // never grind, and the connection is passed so sea-lane dice rules apply.
  // Before this, the sim ran the pre-#220 one-exchange-per-edge executor and
  // every era-balance sweep measured a bot that no longer ships.
  const budget = { left: aiAttackExchangeBudget(difficulty, decidedPress) };
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    const fromId = a.from;
    const toId = a.to;
    // Prototype `gate` only: the engine has no era check on frontier targets.
    if (!incentives.frontierOpenTo(state, pid, toId)) continue;
    const connection = map.connections.find(
      (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId),
    );
    await runAiAttackExchanges({
      state,
      attackerId: pid,
      fromId,
      toId,
      budget,
      canGrind: connection?.type !== 'sea',
      exchange: () => {
        const outcome = executeLandAttack(state, pid, fromId, toId, { dieRoll, connection });
        return outcome ? 'ok' : 'stop';
      },
    });
    if (budget.left <= 0) break;
  }

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type === 'fortify' && a.from && a.to) applyFortify(state, pid, a.from, a.to, a.units);
  }
}

interface GameStat {
  game: number;
  seed: number;
  turns: number;
  winner: string | null;
  winnerEra: number;
  victory: string;
  firstAdvancer: string | null;
  firstAdvanceTurn: number | null;
  firstAdvancerWon: boolean;
  eraLeaderT10: string | null;
  eraLeaderT10Won: boolean;
  /** Turn-20 reads: first advance averages ~turn 16, so turn 10 is small-n noise. */
  eraLeaderT20Won: boolean | null;
  eraLaggardT20Won: boolean | null;
  anyReachedFinal: boolean;
  advanceCount: number;
  gateEverPassed: boolean;
  maxTechs: number;
  maxBuildings: number;
  maxStability: number;
  techMetEver: boolean;
  stabilityMetEver: boolean;
  maxEraSpread: number;
  /** Seat 0 — the policy seat. */
  p0Won: boolean;
  p0Survived: boolean;
  p0Era: number;
  p0FirstAdvanceTurn: number | null;
  hegemonyWin: boolean;
}

/** Per-player diagnostic snapshot of how close anyone got to the advance gate. */
function diagnose(state: GameState): { gate: boolean; techMet: boolean; stabMet: boolean; techs: number; builds: number; stab: number } {
  let gate = false, techMet = false, stabMet = false, techs = 0, builds = 0, stab = 0;
  const stabilityGate = state.settings.era_advancement_stability_gate ?? 60;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    if (canAdvanceEra(state, p.player_id).canAdvance) gate = true;
    const readiness = evaluateEraAdvancementReadiness(state, p.player_id);
    if (readiness.met) techMet = true;
    const s = state.settings.stability_enabled ? getEmpireWeightedStability(state, p.player_id) : 100;
    if (s >= stabilityGate) stabMet = true;
    techs = Math.max(techs, (p.unlocked_techs ?? []).length);
    stab = Math.max(stab, s);
    let b = 0;
    for (const t of Object.values(state.territories)) {
      if (t.owner_id === p.player_id) b += (t.buildings ?? []).filter((x) => !x.startsWith('wonder_')).length;
    }
    builds = Math.max(builds, b);
  }
  return { gate, techMet, stabMet, techs, builds, stab };
}

async function runGame(map: GameMap, gameIndex: number, policy: P0Policy): Promise<GameStat> {
  const seed = hashStringToSeed(`${MASTER_SEED}:${gameIndex}`);
  const dieRoll = seededDie(seed);
  const jitter = createSeededRng(hashStringToSeed(`${MASTER_SEED}:${gameIndex}:jitter`));
  const stabilityRng = createSeededRng(hashStringToSeed(`${MASTER_SEED}:${gameIndex}:stability`));
  const players = Array.from({ length: PLAYERS }, (_, i) => ({
    player_id: `ai_${i}`,
    player_index: i,
    username: `AI-${i}`,
    color: COLORS[i % COLORS.length],
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
  }));

  const state = initializeGameState(`sim_${gameIndex}`, 'ancient', map, players, simSettings(), {
    forceStartingPlayerIndex: 0,
    rng: seededInitRng(hashStringToSeed(`${MASTER_SEED}:${gameIndex}:init`)),
  });
  const incentives = new IncentiveModel(map, RULES, INCENTIVE_OPTIONS);
  const maxEra = getMaxEraIndex(state);
  const advances: AdvanceEvent[] = [];
  let eraLeaderT10: string | null = null;
  let t10Captured = false;
  let eraLeaderT20: string | null = null;
  let eraLaggardT20: string | null = null;
  let t20Captured = false;
  let gateEverPassed = false, techMetEver = false, stabilityMetEver = false;
  let maxTechs = 0, maxBuildings = 0, maxStability = 0;
  let maxEraSpread = 0;
  let hegemonyWin = false;

  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      // A policy seat is pinned to expert so the arms differ only in the
      // advance decision; on the default `ai` policy every seat is identical
      // to the pre-EA-503 sweep.
      const isPolicySeat = policy !== 'ai' && player.player_index === 0;
      await playAiTurn(
        state,
        map,
        player.player_id,
        isPolicySeat ? 'expert' : DIFFICULTY,
        dieRoll,
        jitter,
        advances,
        incentives,
        isPolicySeat ? policy : 'ai',
      );
    }
    // Seeded stability/rebellion rolls, so both A/B arms replay identically.
    advanceToNextPlayer(state, map, { rng: stabilityRng });

    // Era spread among living players — the steamroll signal. With the rubber-band
    // a trailing bot should stay within ~1 era of a fast-advancing leader.
    const livingEras = state.players.filter((p) => !p.is_eliminated).map((p) => p.current_era_index ?? 0);
    if (livingEras.length > 1) {
      maxEraSpread = Math.max(maxEraSpread, Math.max(...livingEras) - Math.min(...livingEras));
    }

    if (!t10Captured && state.turn_number >= 10) {
      t10Captured = true;
      eraLeaderT10 = leaderByEra(state);
    }
    if (!t20Captured && state.turn_number >= 20) {
      t20Captured = true;
      eraLeaderT20 = leaderByEra(state);
      eraLaggardT20 = laggardByEra(state);
    }

    const d = diagnose(state);
    gateEverPassed = gateEverPassed || d.gate;
    techMetEver = techMetEver || d.techMet;
    stabilityMetEver = stabilityMetEver || d.stabMet;
    maxTechs = Math.max(maxTechs, d.techs);
    maxBuildings = Math.max(maxBuildings, d.builds);
    maxStability = Math.max(maxStability, d.stab);

    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0];
      state.victory_condition = victory.condition;
    } else if (state.current_player_index === 0) {
      // Prototype `hegemony` only — evaluated once per full round.
      const hegemon = incentives.checkHegemony(state);
      if (hegemon) {
        state.phase = 'game_over';
        state.winner_id = hegemon;
        state.victory_condition = 'hegemony' as GameState['victory_condition'];
        hegemonyWin = true;
      }
    }
  }

  const winner = state.winner_id ?? null;
  const winnerPlayer = state.players.find((p) => p.player_id === winner);
  const firstAdvance = advances.length > 0 ? advances.reduce((a, b) => (b.turn < a.turn ? b : a)) : null;
  const anyReachedFinal = state.players.some((p) => (p.current_era_index ?? 0) >= maxEra);
  const p0 = state.players[0];

  return {
    game: gameIndex,
    seed,
    turns: state.turn_number,
    winner,
    winnerEra: winnerPlayer?.current_era_index ?? 0,
    victory: state.victory_condition ?? 'none',
    firstAdvancer: firstAdvance?.pid ?? null,
    firstAdvanceTurn: firstAdvance?.turn ?? null,
    firstAdvancerWon: !!firstAdvance && firstAdvance.pid === winner,
    eraLeaderT10,
    eraLeaderT10Won: !!eraLeaderT10 && eraLeaderT10 === winner,
    eraLeaderT20Won: eraLeaderT20 ? eraLeaderT20 === winner : null,
    eraLaggardT20Won: eraLaggardT20 ? eraLaggardT20 === winner : null,
    anyReachedFinal,
    advanceCount: advances.length,
    gateEverPassed,
    maxTechs,
    maxBuildings,
    maxStability,
    techMetEver,
    stabilityMetEver,
    maxEraSpread,
    p0Won: winner === p0.player_id,
    p0Survived: !p0.is_eliminated,
    p0Era: p0.current_era_index ?? 0,
    p0FirstAdvanceTurn: advances.find((a) => a.pid === p0.player_id)?.turn ?? null,
    hegemonyWin,
  };
}

/** The single highest-era non-eliminated player, or null on a tie / no advances. */
function leaderByEra(state: GameState): string | null {
  let best = -1;
  let leader: string | null = null;
  let tie = false;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    const era = p.current_era_index ?? 0;
    if (era > best) { best = era; leader = p.player_id; tie = false; }
    else if (era === best) tie = true;
  }
  return best > 0 && !tie ? leader : null;
}

/**
 * The single lowest-era non-eliminated player, or null on a tie / a level
 * field. Its win rate is the snowball tripwire: if trailing by an era is a
 * death sentence, this goes to zero.
 */
function laggardByEra(state: GameState): string | null {
  let worst = Infinity;
  let best = -1;
  let laggard: string | null = null;
  let tie = false;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    const era = p.current_era_index ?? 0;
    if (era > best) best = era;
    if (era < worst) { worst = era; laggard = p.player_id; tie = false; }
    else if (era === worst) tie = true;
  }
  return best > worst && !tie ? laggard : null;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function rate(n: number, d: number): number {
  return d === 0 ? NaN : (100 * n) / d;
}

interface Sweep {
  policy: P0Policy;
  stats: GameStat[];
  elapsedS: number;
}

async function runSweep(map: GameMap, policy: P0Policy): Promise<Sweep> {
  const started = Date.now();
  const stats: GameStat[] = [];
  for (let i = 0; i < GAMES; i++) stats.push(await runGame(map, i, policy));
  return { policy, stats, elapsedS: (Date.now() - started) / 1000 };
}

/** Seat-0 win rate — the causal read when `policy` is not `ai`. */
function p0WinRate(s: Sweep): number {
  return rate(s.stats.filter((x) => x.p0Won).length, s.stats.length);
}

function laggardT20Rate(s: Sweep): number {
  const withLaggard = s.stats.filter((x) => x.eraLaggardT20Won != null);
  return rate(withLaggard.filter((x) => x.eraLaggardT20Won).length, withLaggard.length);
}

function report(sweep: Sweep): void {
  const { stats, elapsedS, policy } = sweep;
  const withAdvancer = stats.filter((s) => s.firstAdvancer);
  const withT10Leader = stats.filter((s) => s.eraLeaderT10);
  const withT20Leader = stats.filter((s) => s.eraLeaderT20Won != null);
  const withT20Laggard = stats.filter((s) => s.eraLaggardT20Won != null);
  const decisive = stats.filter((s) => s.victory !== 'turn_limit');
  const winnerEras = stats.reduce<Record<number, number>>((acc, s) => { acc[s.winnerEra] = (acc[s.winnerEra] ?? 0) + 1; return acc; }, {});
  const rulesLabel = RULES.size > 0 ? [...RULES].join(',') : 'none';

  console.log(`\nEra Advancement balance — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · maxTurns ${MAX_TURNS}`);
  console.log(`Seed "${MASTER_SEED}" · ${elapsedS.toFixed(1)}s (${(elapsedS / GAMES * 1000).toFixed(1)}ms/game)`);
  console.log(`Seat-0 policy ${policy} · growth ${GROWTH ? 'on' : 'off'} · proposed rules: ${rulesLabel}\n`);
  console.log(`Reached final era (any player):   ${pct(stats.filter((s) => s.anyReachedFinal).length, GAMES)}`);
  console.log(`Decisive (non-turn-limit) wins:   ${pct(decisive.length, GAMES)}`);
  console.log(`First-advancer win rate:          ${pct(withAdvancer.filter((s) => s.firstAdvancerWon).length, withAdvancer.length)}  (vs ${pct(1, PLAYERS)} baseline — SELECTION, not causation)`);
  console.log(`Era-leader@turn10 win rate:       ${pct(withT10Leader.filter((s) => s.eraLeaderT10Won).length, withT10Leader.length)}  (small-n; prefer turn 20)`);
  console.log(`Era-leader@turn20 win rate:       ${pct(withT20Leader.filter((s) => s.eraLeaderT20Won).length, withT20Leader.length)}  (n=${withT20Leader.length})`);
  console.log(`Era-laggard@turn20 win rate:      ${pct(withT20Laggard.filter((s) => s.eraLaggardT20Won).length, withT20Laggard.length)}  (n=${withT20Laggard.length} — snowball tripwire)`);
  console.log(`Avg advances / game:              ${(stats.reduce((a, s) => a + s.advanceCount, 0) / GAMES).toFixed(2)}`);
  console.log(`Avg first-advance turn:           ${(withAdvancer.reduce((a, s) => a + (s.firstAdvanceTurn ?? 0), 0) / (withAdvancer.length || 1)).toFixed(1)}`);
  console.log(`Avg game length (turns):          ${(stats.reduce((a, s) => a + s.turns, 0) / GAMES).toFixed(1)}`);
  console.log(`Winner era distribution:          ${Object.entries(winnerEras).sort(([a], [b]) => Number(a) - Number(b)).map(([e, c]) => `era${e}:${c}`).join('  ')}`);
  if (RULES.has('hegemony')) {
    console.log(`Hegemony victories:               ${pct(stats.filter((s) => s.hegemonyWin).length, GAMES)}`);
  }
  console.log(`\n— Seat 0 (policy = ${policy}) —`);
  console.log(`Win rate:                         ${pct(stats.filter((s) => s.p0Won).length, GAMES)}  (vs ${pct(1, PLAYERS)} fair share)`);
  console.log(`Survived to the end:              ${pct(stats.filter((s) => s.p0Survived).length, GAMES)}`);
  console.log(`Avg final era:                    ${(stats.reduce((a, s) => a + s.p0Era, 0) / GAMES).toFixed(2)}`);
  console.log(`\n— Gate diagnostics (why advancement is/ isn't happening) —`);
  console.log(`Gate ever passable (any player):  ${pct(stats.filter((s) => s.gateEverPassed).length, GAMES)}`);
  console.log(`  tech gate met ever:             ${pct(stats.filter((s) => s.techMetEver).length, GAMES)}`);
  console.log(`  stability gate met ever:        ${pct(stats.filter((s) => s.stabilityMetEver).length, GAMES)}`);
  console.log(`Avg peak techs / peak buildings:  ${(stats.reduce((a, s) => a + s.maxTechs, 0) / GAMES).toFixed(1)} techs · ${(stats.reduce((a, s) => a + s.maxBuildings, 0) / GAMES).toFixed(1)} bldg`);
  console.log(`Avg peak empire stability:        ${(stats.reduce((a, s) => a + s.maxStability, 0) / GAMES).toFixed(0)}%`);
  const avgSpread = stats.reduce((a, s) => a + s.maxEraSpread, 0) / GAMES;
  const withinOne = stats.filter((s) => s.maxEraSpread <= 1).length;
  console.log(`\n— Steamroll / rubber-band —`);
  console.log(`Avg peak era spread (leader−laggard): ${avgSpread.toFixed(2)} eras`);
  console.log(`Games where pack stayed within 1 era: ${pct(withinOne, GAMES)}`);
}

/**
 * The acceptance bar. Both arms run the same seeds, so the difference is the
 * value of advancing and nothing else.
 */
function reportPolicyAb(always: Sweep, never: Sweep): void {
  const alwaysWin = p0WinRate(always);
  const neverWin = p0WinRate(never);
  const gap = alwaysWin - neverWin;
  const laggard = laggardT20Rate(always);
  const paysOff = gap >= ACCEPTANCE_POLICY_GAP_PTS;
  const notSteamroll = !(laggard < ACCEPTANCE_LAGGARD_FLOOR_PCT);

  console.log(`\n════ Policy A/B — does advancing pay? ════`);
  console.log(`${GAMES} games per arm · ${PLAYERS}p · ${DIFFICULTY} · same seeds · rules: ${RULES.size ? [...RULES].join(',') : 'none'}`);
  console.log(`Seat-0 win rate   always ${alwaysWin.toFixed(1)}%   never ${neverWin.toFixed(1)}%   gap ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts`);
  console.log(`  ${paysOff ? 'PASS' : 'FAIL'}  advancing must pay: gap >= +${ACCEPTANCE_POLICY_GAP_PTS.toFixed(1)} pts`);
  console.log(`Era-laggard@turn20 win rate (always arm): ${Number.isNaN(laggard) ? 'n/a' : `${laggard.toFixed(1)}%`}`);
  console.log(`  ${notSteamroll ? 'PASS' : 'FAIL'}  must not steamroll: laggard >= ${ACCEPTANCE_LAGGARD_FLOOR_PCT.toFixed(1)}%`);
  console.log(`VERDICT: ${paysOff && notSteamroll ? 'PASS' : 'FAIL'}`);
  console.log(`Both arms play the same seeded games; vary SIM_SEED to sample different opening positions.`);
}

function writeCsv(sweep: Sweep, path: string): void {
  const header = 'game,seed,turns,winner,winner_era,victory,first_advancer,first_advance_turn,first_advancer_won,era_leader_t10,era_leader_t10_won,any_reached_final,advance_count,p0_policy,p0_won,p0_survived,p0_era,p0_first_advance_turn';
  const rows = sweep.stats.map((s) => [
    s.game, s.seed, s.turns, s.winner ?? '', s.winnerEra, s.victory, s.firstAdvancer ?? '',
    s.firstAdvanceTurn ?? '', s.firstAdvancerWon, s.eraLeaderT10 ?? '', s.eraLeaderT10Won, s.anyReachedFinal, s.advanceCount,
    sweep.policy, s.p0Won, s.p0Survived, s.p0Era, s.p0FirstAdvanceTurn ?? '',
  ].join(','));
  writeFileSync(path, [header, ...rows].join('\n') + '\n');
  console.log(`\nWrote per-game CSV → ${path}`);
}

async function main(): Promise<void> {
  if (!P0_POLICIES.includes(P0_POLICY)) {
    throw new Error(`Unknown SIM_P0_POLICY "${P0_POLICY}" — expected one of ${P0_POLICIES.join(', ')}`);
  }
  const map = loadMap();

  if (POLICY_AB) {
    const always = await runSweep(map, 'always');
    const never = await runSweep(map, 'never');
    report(always);
    report(never);
    reportPolicyAb(always, never);
    if (CSV_PATH) writeCsv(always, CSV_PATH);
    return;
  }

  const sweep = await runSweep(map, P0_POLICY);
  report(sweep);
  if (CSV_PATH) writeCsv(sweep, CSV_PATH);
}

main().catch((e) => { console.error(e); process.exit(1); });
