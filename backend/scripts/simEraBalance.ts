/**
 * Headless AI-vs-AI era-advancement balance simulator (EA-502).
 *
 * Drives the PURE game engine — no sockets, no DB — for N games and reports
 * advancement-balance stats. Combat goes through executeLandAttack, so the
 * era-gap dice and vulnerability window are modeled faithfully for the land
 * ruleset this sim uses (factions / naval / events / cards OFF; economy + tech +
 * stability + era advancement ON; domination victory with a turn cap).
 *
 * Each game's combat dice are seeded (masterSeed + game index) for reproducible
 * combat; starting territory distribution uses the engine's own RNG, so each
 * game samples a fresh start — which is the point of a balance sweep.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simEraBalance.ts
 *   SIM_GAMES=500 SIM_PLAYERS=4 SIM_DIFFICULTY=expert SIM_MAX_TURNS=70 \
 *     SIM_SEED=borderfall SIM_CSV=/tmp/era_balance.csv pnpm exec tsx scripts/simEraBalance.ts
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
import { getEmpireWeightedStability } from '../src/game-engine/state/stabilityManager';
import { getMaxEraIndex } from '../src/game-engine/eraAdvancement/spines';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

const GAMES = Number(process.env.SIM_GAMES ?? 200);
const PLAYERS = Number(process.env.SIM_PLAYERS ?? 4);
const DIFFICULTY = (process.env.SIM_DIFFICULTY ?? 'expert') as AiDifficulty;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 70);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-era-balance';
const CSV_PATH = process.env.SIM_CSV ?? '';
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
    allowed_victory_conditions: ['domination'],
    victory_type: 'domination',
    max_turns: MAX_TURNS,
  } as GameSettings;
}

function seededDie(seed: number): () => number {
  const rng = createSeededRng(seed);
  return () => Math.floor(rng() * 6) + 1;
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

interface AdvanceEvent { pid: string; turn: number; }

/** Play one AI player's full turn, mirroring processAiTurn's pure-engine sequence. */
function playAiTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  advances: AdvanceEvent[],
): void {
  state.phase = 'draft';
  const plan = computeAiTurn(state, map, difficulty); // planned pre-advance, like the socket

  if (state.settings.era_advancement_enabled) {
    const decision = evaluateAiEraAdvancement(state, map, pid, difficulty);
    if (decision.shouldAdvance && executeAdvanceEra(state, pid).success) {
      advances.push({ pid, turn: state.turn_number });
    }
  }

  applyDraft(state, pid, plan);

  const build = selectAiBuildingPlacement(state, map, pid, difficulty);
  if (build) applyBuild(state, pid, build.territoryId, build.buildingType);
  const techId = selectAiTechResearch(state, pid, difficulty);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) applyResearch(state, pid, v.node);
  }

  state.phase = 'attack';
  for (const a of plan) {
    if (a.type === 'attack' && a.from && a.to && a.from !== '__influence__') {
      executeLandAttack(state, pid, a.from, a.to, { dieRoll });
    }
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
  anyReachedFinal: boolean;
  advanceCount: number;
  gateEverPassed: boolean;
  maxTechs: number;
  maxBuildings: number;
  maxStability: number;
  techMetEver: boolean;
  stabilityMetEver: boolean;
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

function runGame(map: GameMap, gameIndex: number): GameStat {
  const seed = hashStringToSeed(`${MASTER_SEED}:${gameIndex}`);
  const dieRoll = seededDie(seed);
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
  });
  const maxEra = getMaxEraIndex(state);
  const advances: AdvanceEvent[] = [];
  let eraLeaderT10: string | null = null;
  let t10Captured = false;
  let gateEverPassed = false, techMetEver = false, stabilityMetEver = false;
  let maxTechs = 0, maxBuildings = 0, maxStability = 0;

  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      playAiTurn(state, map, player.player_id, DIFFICULTY, dieRoll, advances);
    }
    advanceToNextPlayer(state, map);

    if (!t10Captured && state.turn_number >= 10) {
      t10Captured = true;
      eraLeaderT10 = leaderByEra(state);
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
    }
  }

  const winner = state.winner_id ?? null;
  const winnerPlayer = state.players.find((p) => p.player_id === winner);
  const firstAdvance = advances.length > 0 ? advances.reduce((a, b) => (b.turn < a.turn ? b : a)) : null;
  const anyReachedFinal = state.players.some((p) => (p.current_era_index ?? 0) >= maxEra);

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
    anyReachedFinal,
    advanceCount: advances.length,
    gateEverPassed,
    maxTechs,
    maxBuildings,
    maxStability,
    techMetEver,
    stabilityMetEver,
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

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function main(): void {
  const map = loadMap();
  const started = Date.now();
  const stats: GameStat[] = [];
  for (let i = 0; i < GAMES; i++) stats.push(runGame(map, i));
  const elapsedS = (Date.now() - started) / 1000;

  const withAdvancer = stats.filter((s) => s.firstAdvancer);
  const withT10Leader = stats.filter((s) => s.eraLeaderT10);
  const decisive = stats.filter((s) => s.victory !== 'turn_limit');
  const winnerEras = stats.reduce<Record<number, number>>((acc, s) => { acc[s.winnerEra] = (acc[s.winnerEra] ?? 0) + 1; return acc; }, {});

  console.log(`\nEra Advancement balance — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · maxTurns ${MAX_TURNS}`);
  console.log(`Seed "${MASTER_SEED}" · ${elapsedS.toFixed(1)}s (${(elapsedS / GAMES * 1000).toFixed(1)}ms/game)\n`);
  console.log(`Reached final era (any player):   ${pct(stats.filter((s) => s.anyReachedFinal).length, GAMES)}`);
  console.log(`Decisive (non-turn-limit) wins:   ${pct(decisive.length, GAMES)}`);
  console.log(`First-advancer win rate:          ${pct(withAdvancer.filter((s) => s.firstAdvancerWon).length, withAdvancer.length)}  (vs ${pct(1, PLAYERS)} baseline)`);
  console.log(`Era-leader@turn10 win rate:       ${pct(withT10Leader.filter((s) => s.eraLeaderT10Won).length, withT10Leader.length)}  (snowball signal)`);
  console.log(`Avg advances / game:              ${(stats.reduce((a, s) => a + s.advanceCount, 0) / GAMES).toFixed(2)}`);
  console.log(`Avg first-advance turn:           ${(withAdvancer.reduce((a, s) => a + (s.firstAdvanceTurn ?? 0), 0) / (withAdvancer.length || 1)).toFixed(1)}`);
  console.log(`Avg game length (turns):          ${(stats.reduce((a, s) => a + s.turns, 0) / GAMES).toFixed(1)}`);
  console.log(`Winner era distribution:          ${Object.entries(winnerEras).sort(([a], [b]) => Number(a) - Number(b)).map(([e, c]) => `era${e}:${c}`).join('  ')}`);
  console.log(`\n— Gate diagnostics (why advancement is/ isn't happening) —`);
  console.log(`Gate ever passable (any player):  ${pct(stats.filter((s) => s.gateEverPassed).length, GAMES)}`);
  console.log(`  tech gate met ever:             ${pct(stats.filter((s) => s.techMetEver).length, GAMES)}`);
  console.log(`  stability gate met ever:        ${pct(stats.filter((s) => s.stabilityMetEver).length, GAMES)}`);
  console.log(`Avg peak techs / peak buildings:  ${(stats.reduce((a, s) => a + s.maxTechs, 0) / GAMES).toFixed(1)} techs · ${(stats.reduce((a, s) => a + s.maxBuildings, 0) / GAMES).toFixed(1)} bldg`);
  console.log(`Avg peak empire stability:        ${(stats.reduce((a, s) => a + s.maxStability, 0) / GAMES).toFixed(0)}%`);

  if (CSV_PATH) {
    const header = 'game,seed,turns,winner,winner_era,victory,first_advancer,first_advance_turn,first_advancer_won,era_leader_t10,era_leader_t10_won,any_reached_final,advance_count';
    const rows = stats.map((s) => [
      s.game, s.seed, s.turns, s.winner ?? '', s.winnerEra, s.victory, s.firstAdvancer ?? '',
      s.firstAdvanceTurn ?? '', s.firstAdvancerWon, s.eraLeaderT10 ?? '', s.eraLeaderT10Won, s.anyReachedFinal, s.advanceCount,
    ].join(','));
    writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n');
    console.log(`\nWrote per-game CSV → ${CSV_PATH}`);
  }
}

main();
