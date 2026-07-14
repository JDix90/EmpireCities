/**
 * Headless AI-vs-AI Galactic Age balance simulator.
 *
 * Drives the PURE game engine (no sockets, no DB) for N four-player galaxy_age
 * games on era_galaxy.json and reports the balance signals that matter for the
 * multi-world map after the 6->16 territory densification:
 *   - per-FACTION win rate (4p baseline = 25%); flags any faction > ~35%,
 *   - game length (pacing) + decisive vs turn-limit,
 *   - snowball: win rate of the territory leader at turn 10,
 *   - peak territory spread (leader - laggard).
 *
 * Galaxy starts REQUIRE exactly 4 players, each on a distinct galaxy faction, so
 * tryDistributeGalaxyAgeFactionHomeworlds gives each its whole home world. Era
 * advancement is OFF (galaxy is the terminal era); factions ON; naval OFF (the
 * worlds are linked by orbit lanes, not sea). Combat dice are seeded per game.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_GAMES=500 SIM_DIFFICULTY=expert SIM_MAX_TURNS=90 \
 *     SIM_CSV=/tmp/galaxy_balance.csv pnpm exec tsx scripts/simGalaxyBalance.ts
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
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

const GAMES = Number(process.env.SIM_GAMES ?? 200);
const DIFFICULTY = (process.env.SIM_DIFFICULTY ?? 'expert') as AiDifficulty;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 90);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-galaxy-balance';
const CSV_PATH = process.env.SIM_CSV ?? '';
/** When set (1–99), adds threshold victory at that % — mirrors the live galaxy create default. */
const THRESHOLD = process.env.SIM_THRESHOLD ? Number(process.env.SIM_THRESHOLD) : null;

const PLAYERS = 4;
// One faction per player, in player order. Each faction's home region is a whole
// world, so player i starts on a distinct world.
const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const FACTION_WORLD: Record<string, string> = {
  stellar_mandate: 'Sol',
  forge_syndicate: 'Rust',
  helion_navigators: 'Verdan',
  void_custodians: 'Nexus',
};
const COLORS = ['#5dade2', '#e67e22', '#2ecc71', '#9b59b6'];

function loadMap(): GameMap {
  const raw = readFileSync(join(__dirname, '../../database/maps/era_galaxy.json'), 'utf-8');
  return JSON.parse(raw) as GameMap;
}

function simSettings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    factions_enabled: true,
    naval_enabled: false,
    events_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    era_advancement_enabled: false, // galaxy is the terminal era
    allowed_victory_conditions: THRESHOLD != null ? ['domination', 'threshold'] : ['domination'],
    victory_type: 'domination',
    victory_threshold: THRESHOLD ?? undefined,
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

/** One AI player's full turn (no era advancement — galaxy is terminal). */
function playAiTurn(state: GameState, map: GameMap, pid: string, difficulty: AiDifficulty, dieRoll: () => number): void {
  state.phase = 'draft';
  const plan = computeAiTurn(state, map, difficulty);

  const build = selectAiBuildingPlacement(state, map, pid, difficulty);
  if (build) applyBuild(state, pid, build.territoryId, build.buildingType);
  const techId = selectAiTechResearch(state, pid, difficulty);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) applyResearch(state, pid, v.node);
  }

  applyDraft(state, pid, plan);

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

/** Highest territory_count non-eliminated player; null on a tie. */
function territoryLeader(state: GameState): string | null {
  const counts = state.players
    .filter((p) => !p.is_eliminated)
    .map((p) => ({ id: p.player_id, n: Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length }))
    .sort((a, b) => b.n - a.n);
  if (counts.length < 2) return counts[0]?.id ?? null;
  return counts[0].n > counts[1].n ? counts[0].id : null;
}

interface GameStat {
  game: number;
  turns: number;
  winnerFaction: string | null;
  victory: string;
  decisive: boolean;
  t10Leader: string | null;
  t10LeaderWon: boolean;
  maxTerritorySpread: number;
}

function runGame(gameIndex: number, map: GameMap): GameStat {
  const seed = hashStringToSeed(`${MASTER_SEED}:${gameIndex}`);
  const dieRoll = seededDie(seed);
  // Rotate faction-to-player assignment per game so faction win rate isn't
  // confounded with turn order (player 0 acts first).
  const rot = gameIndex % PLAYERS;
  const players = Array.from({ length: PLAYERS }, (_, i) => ({
    player_id: `ai_${i}`,
    player_index: i,
    username: `AI-${i}`,
    color: COLORS[i % COLORS.length],
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
    faction_id: FACTIONS[(i + rot) % PLAYERS],
  }));
  const factionOf: Record<string, string> = {};
  for (const p of players) factionOf[p.player_id] = p.faction_id;

  const state = initializeGameState(`galsim_${gameIndex}`, 'galaxy_age', map, players, simSettings(), {
    forceStartingPlayerIndex: 0,
  });

  let t10Leader: string | null = null;
  let t10Captured = false;
  let maxSpread = 0;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) playAiTurn(state, map, player.player_id, DIFFICULTY, dieRoll);
    advanceToNextPlayer(state, map);

    const counts = state.players
      .filter((p) => !p.is_eliminated)
      .map((p) => Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length);
    if (counts.length > 1) maxSpread = Math.max(maxSpread, Math.max(...counts) - Math.min(...counts));

    if (!t10Captured && state.turn_number >= 10) { t10Captured = true; t10Leader = territoryLeader(state); }

    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0];
      state.victory_condition = victory.condition;
    }
  }

  const winner = state.winner_id ?? null;
  return {
    game: gameIndex,
    turns: state.turn_number,
    winnerFaction: winner ? factionOf[winner] ?? null : null,
    victory: state.victory_condition ?? 'turn_limit',
    decisive: state.victory_condition != null && state.victory_condition !== 'turn_limit',
    t10Leader,
    t10LeaderWon: !!t10Leader && t10Leader === winner,
    maxTerritorySpread: maxSpread,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function main(): void {
  const map = loadMap();
  const terr = map.territories.length;
  const started = Date.now();
  const stats: GameStat[] = [];
  for (let i = 0; i < GAMES; i++) stats.push(runGame(i, map));
  const elapsedS = (Date.now() - started) / 1000;

  const decisive = stats.filter((s) => s.decisive);
  const withT10 = stats.filter((s) => s.t10Leader);
  const byFaction: Record<string, number> = {};
  for (const f of FACTIONS) byFaction[f] = 0;
  for (const s of stats) if (s.winnerFaction) byFaction[s.winnerFaction] = (byFaction[s.winnerFaction] ?? 0) + 1;

  console.log(`\nGalactic Age balance — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · maxTurns ${MAX_TURNS}${THRESHOLD != null ? ` · threshold ${THRESHOLD}%` : ''} · ${terr} territories`);
  console.log(`Seed "${MASTER_SEED}" · ${elapsedS.toFixed(1)}s (${((elapsedS / GAMES) * 1000).toFixed(1)}ms/game)\n`);
  console.log(`Avg game length (turns):          ${(stats.reduce((a, s) => a + s.turns, 0) / GAMES).toFixed(1)}`);
  console.log(`Decisive (non-turn-limit) wins:   ${pct(decisive.length, GAMES)}`);
  const byCondition = new Map<string, number>();
  for (const s of stats) byCondition.set(s.victory, (byCondition.get(s.victory) ?? 0) + 1);
  console.log(`Victory breakdown:                ${[...byCondition.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${pct(n, GAMES)}`).join(' · ')}`);
  console.log(`Territory-leader@turn10 win rate: ${pct(withT10.filter((s) => s.t10LeaderWon).length, withT10.length)}  (snowball signal; ${pct(1, PLAYERS)} baseline)`);
  console.log(`Avg peak territory spread:        ${(stats.reduce((a, s) => a + s.maxTerritorySpread, 0) / GAMES).toFixed(1)} (leader − laggard, of ${terr})`);
  console.log(`\n— Per-faction win rate (4p baseline = 25%) —`);
  for (const f of FACTIONS) {
    const wins = byFaction[f];
    const flag = wins / GAMES > 0.35 ? '  <== high' : wins / GAMES < 0.15 ? '  <== low' : '';
    console.log(`  ${f.padEnd(20)} ${FACTION_WORLD[f].padEnd(7)} ${pct(wins, GAMES).padStart(6)}${flag}`);
  }
  const noWinner = stats.filter((s) => !s.winnerFaction).length;
  if (noWinner) console.log(`  (no winner / turn-limit):           ${pct(noWinner, GAMES)}`);

  if (CSV_PATH) {
    const header = 'game,turns,winner_faction,victory,decisive,t10_leader,t10_leader_won,max_territory_spread';
    const rows = stats.map((s) => [s.game, s.turns, s.winnerFaction ?? '', s.victory, s.decisive, s.t10Leader ?? '', s.t10LeaderWon, s.maxTerritorySpread].join(','));
    writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n');
    console.log(`\nWrote per-game CSV → ${CSV_PATH}`);
  }
}

main();
