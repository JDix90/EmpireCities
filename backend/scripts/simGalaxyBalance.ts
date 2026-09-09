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
import {
  aiAttackExchangeBudget,
  shouldContinueGrind,
  shouldPressDecidedGame,
} from '../src/game-engine/ai/aiAttackGrind';
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
/**
 * Attack-loop fidelity. `SIM_GRIND=0` restores the pre-2026-09 harness (one dice
 * exchange per planned edge) for comparison; the default mirrors production.
 */
const GRIND = process.env.SIM_GRIND !== '0';

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

/** Order-independent key for a territory pair (matches moonAccess.orbitLaneId). */
function laneKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** Every orbit-typed edge as a lane key, so cross-world attacks can be counted. */
function orbitLanePairs(map: GameMap): Set<string> {
  return new Set(
    map.connections.filter((c) => c.type === 'orbit').map((c) => laneKey(c.from, c.to)),
  );
}

/** The map's world ids, in authored order. */
function worldIds(map: GameMap): string[] {
  return (map.worlds ?? []).map((w) => w.world_id);
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

/** Per-seat counters accumulated across a game (see SeatStat). */
interface SeatTelemetry {
  chartTurn: number | null;
  firstCrossCaptureTurn: number | null;
  crossExchanges: number;
  crossCaptures: number;
  homeExchanges: number;
}

/**
 * One AI player's full turn (no era advancement — galaxy is terminal).
 *
 * The attack loop mirrors `processAiTurn` in sockets/gameSocket.ts: a turn-wide
 * exchange budget from `aiAttackExchangeBudget`, each planned edge ground until
 * `shouldContinueGrind` says stop, and the remaining planned edges skipped once
 * the budget is spent. Resolving each planned edge exactly ONCE — what this
 * harness did until 2026-09 — models an AI that production does not run: the
 * grind exists because single exchanges left any 3+ unit territory uncapturable,
 * and without it this sim reported the wrong faction as broken (Forge 36% here
 * vs 8% live). `SIM_GRIND=0` restores the old behavior for comparison.
 */
function playAiTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  orbitLanePairs: Set<string>,
  seat: SeatTelemetry,
): void {
  state.phase = 'draft';
  const plan = computeAiTurn(state, map, difficulty);

  const build = selectAiBuildingPlacement(state, map, pid, difficulty);
  if (build) applyBuild(state, pid, build.territoryId, build.buildingType);
  const techId = selectAiTechResearch(state, pid, difficulty);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) {
      applyResearch(state, pid, v.node);
      if (techId === 'ga_hyperspace_chart' && seat.chartTurn == null) seat.chartTurn = state.turn_number;
    }
  }

  applyDraft(state, pid, plan);

  state.phase = 'attack';
  const budget = {
    left: GRIND
      ? aiAttackExchangeBudget(difficulty, shouldPressDecidedGame(state, pid, difficulty))
      : Number.POSITIVE_INFINITY,
  };
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    if (budget.left <= 0) break;
    const crossesLane = orbitLanePairs.has(laneKey(a.from, a.to));
    for (;;) {
      const ownerBefore = state.territories[a.to]?.owner_id;
      const outcome = executeLandAttack(state, pid, a.from, a.to, { dieRoll });
      budget.left -= 1;
      if (outcome) {
        if (crossesLane) {
          seat.crossExchanges++;
          if (state.territories[a.to].owner_id === pid && ownerBefore !== pid) {
            seat.crossCaptures++;
            if (seat.firstCrossCaptureTurn == null) seat.firstCrossCaptureTurn = state.turn_number;
          }
        } else {
          seat.homeExchanges++;
        }
      }
      if (!outcome || !GRIND) break;
      if (shouldContinueGrind(state, pid, a.from, a.to, budget.left) !== 'ok') break;
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

/** One seat's game-long record — the per-faction diagnostics the tables report. */
interface SeatStat extends SeatTelemetry {
  faction: string;
  won: boolean;
  eliminated: boolean;
  finalTerritories: number;
  territoriesAtTurn: Record<number, number>;
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
  seats: SeatStat[];
  /** world_id → largest share held by any single player at game end. */
  worldTopShare: Record<string, number>;
}

/** Turns at which per-seat territory counts are sampled for the trajectory table. */
const TERRITORY_SNAPSHOT_TURNS = [10, 30, 60] as const;

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

  const lanes = orbitLanePairs(map);
  const telemetry: Record<string, SeatTelemetry> = {};
  const snapshots: Record<string, Record<number, number>> = {};
  for (const p of players) {
    telemetry[p.player_id] = {
      chartTurn: null,
      firstCrossCaptureTurn: null,
      crossExchanges: 0,
      crossCaptures: 0,
      homeExchanges: 0,
    };
    snapshots[p.player_id] = {};
  }

  let t10Leader: string | null = null;
  let t10Captured = false;
  let maxSpread = 0;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      playAiTurn(state, map, player.player_id, DIFFICULTY, dieRoll, lanes, telemetry[player.player_id]);
    }
    advanceToNextPlayer(state, map);

    const counts = state.players
      .filter((p) => !p.is_eliminated)
      .map((p) => Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length);
    if (counts.length > 1) maxSpread = Math.max(maxSpread, Math.max(...counts) - Math.min(...counts));

    // Sample once per snapshot turn, at the top of the round.
    for (const turn of TERRITORY_SNAPSHOT_TURNS) {
      if (state.turn_number !== turn || state.current_player_index !== 0) continue;
      for (const p of state.players) {
        if (snapshots[p.player_id][turn] == null) {
          snapshots[p.player_id][turn] = ownedIds(state, p.player_id).length;
        }
      }
    }

    if (!t10Captured && state.turn_number >= 10) { t10Captured = true; t10Leader = territoryLeader(state); }

    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0];
      state.victory_condition = victory.condition;
    }
  }

  const winner = state.winner_id ?? null;

  const worldTopShare: Record<string, number> = {};
  for (const worldId of worldIds(map)) {
    const byOwner: Record<string, number> = {};
    for (const t of Object.values(state.territories)) {
      if (t.world_id === worldId && t.owner_id) byOwner[t.owner_id] = (byOwner[t.owner_id] ?? 0) + 1;
    }
    worldTopShare[worldId] = Math.max(0, ...Object.values(byOwner));
  }

  const seats: SeatStat[] = state.players.map((p) => ({
    ...telemetry[p.player_id],
    faction: factionOf[p.player_id] ?? `seat${p.player_index}`,
    won: winner === p.player_id,
    eliminated: p.is_eliminated,
    finalTerritories: ownedIds(state, p.player_id).length,
    territoriesAtTurn: snapshots[p.player_id],
  }));

  return {
    game: gameIndex,
    turns: state.turn_number,
    winnerFaction: winner ? factionOf[winner] ?? null : null,
    victory: state.victory_condition ?? 'turn_limit',
    decisive: state.victory_condition != null && state.victory_condition !== 'turn_limit',
    t10Leader,
    t10LeaderWon: !!t10Leader && t10Leader === winner,
    maxTerritorySpread: maxSpread,
    seats,
    worldTopShare,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function avg(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fixed(n: number, places = 1): string {
  return Number.isFinite(n) ? n.toFixed(places) : '—';
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
  console.log(`Seed "${MASTER_SEED}" · attack loop ${GRIND ? 'GRIND (mirrors live AI)' : 'single-exchange (SIM_GRIND=0, legacy)'} · ${elapsedS.toFixed(1)}s (${((elapsedS / GAMES) * 1000).toFixed(1)}ms/game)\n`);
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

  // ── Per-faction diagnostics ────────────────────────────────────────────────
  // Win rate alone can't say WHY a faction loses. These columns separate the
  // candidate causes: dying early (elim), never getting off its world (first
  // cross capture), spending exchanges without converting them (cross ex→cap),
  // or bleeding territory over time (the trajectory).
  const seatsByFaction = new Map<string, SeatStat[]>();
  for (const s of stats) {
    for (const seat of s.seats) {
      const list = seatsByFaction.get(seat.faction) ?? [];
      list.push(seat);
      seatsByFaction.set(seat.faction, list);
    }
  }
  const snapCols = TERRITORY_SNAPSHOT_TURNS.map((t) => `@${t}`.padStart(6)).join('');
  console.log(`\n— Per-faction diagnostics (per seat, per game) —`);
  console.log(`  ${'faction'.padEnd(20)}${'elim'.padStart(7)}${'chartT'.padStart(8)}${'1stCrossT'.padStart(11)}${'crossEx'.padStart(9)}${'crossCap'.padStart(9)}${'homeEx'.padStart(8)}${snapCols}${'@end'.padStart(7)}`);
  for (const f of FACTIONS) {
    const seats = seatsByFaction.get(f) ?? [];
    if (seats.length === 0) continue;
    const crossed = seats.filter((s) => s.firstCrossCaptureTurn != null);
    const snaps = TERRITORY_SNAPSHOT_TURNS.map((t) =>
      fixed(avg(seats.map((s) => s.territoriesAtTurn[t]).filter((n): n is number => n != null))).padStart(6),
    ).join('');
    console.log(
      `  ${f.padEnd(20)}${pct(seats.filter((s) => s.eliminated).length, seats.length).padStart(7)}` +
      `${fixed(avg(seats.map((s) => s.chartTurn).filter((n): n is number => n != null))).padStart(8)}` +
      `${fixed(avg(crossed.map((s) => s.firstCrossCaptureTurn!))).padStart(11)}` +
      `${fixed(avg(seats.map((s) => s.crossExchanges))).padStart(9)}` +
      `${fixed(avg(seats.map((s) => s.crossCaptures))).padStart(9)}` +
      `${fixed(avg(seats.map((s) => s.homeExchanges))).padStart(8)}` +
      `${snaps}${fixed(avg(seats.map((s) => s.finalTerritories))).padStart(7)}`,
    );
  }
  console.log(`  chartT/1stCrossT: turn, averaged over seats that got there · crossEx→crossCap: lane exchanges vs captures`);

  // Per-world concentration: a galaxy where every world ends wholly owned by one
  // player has stopped being contested, whatever the win rates say.
  const worlds = worldIds(map);
  if (worlds.length > 0) {
    const perWorld = worlds
      .map((w) => `${w} ${fixed(avg(stats.map((s) => s.worldTopShare[w] ?? 0)))}`)
      .join(' · ');
    console.log(`\nLargest single-owner share per world at game end: ${perWorld}`);
  }

  if (CSV_PATH) {
    // One row per SEAT per game: faction win rates are seat-level, so seat-level
    // rows are what any follow-up analysis actually needs.
    const header = [
      'game', 'turns', 'victory', 'decisive', 'max_territory_spread',
      'faction', 'won', 'eliminated', 'chart_turn', 'first_cross_capture_turn',
      'cross_exchanges', 'cross_captures', 'home_exchanges', 'final_territories',
      ...TERRITORY_SNAPSHOT_TURNS.map((t) => `territories_at_${t}`),
    ].join(',');
    const rows = stats.flatMap((s) =>
      s.seats.map((seat) => [
        s.game, s.turns, s.victory, s.decisive, s.maxTerritorySpread,
        seat.faction, seat.won, seat.eliminated, seat.chartTurn ?? '', seat.firstCrossCaptureTurn ?? '',
        seat.crossExchanges, seat.crossCaptures, seat.homeExchanges, seat.finalTerritories,
        ...TERRITORY_SNAPSHOT_TURNS.map((t) => seat.territoriesAtTurn[t] ?? ''),
      ].join(',')),
    );
    writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n');
    console.log(`\nWrote per-seat CSV → ${CSV_PATH} (${rows.length} rows)`);
  }
}

main();
