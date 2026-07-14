/**
 * Headless AI-vs-AI SPACE AGE balance simulator — the Moon-race audit.
 *
 * Drives the PURE game engine (no sockets, no DB) for N space_age games on
 * era_space_age.json and answers:
 *   1. Do AIs complete the Moon tech ladder (sa_digital_warfare → sa_orbital_recon
 *      → sa_launch_pad_tech → sa_space_station → sa_lunar_expansion), build a
 *      launch_pad, launch the station, and capture Moon tiles — and by what turn?
 *   2. Does Moon control correlate with winning (moon tiles at end, lunar_surface
 *      region control)?
 *   3. Tempo: game length, decisive rate, turn-10 snowball, and whether the three
 *      Earth orbit anchors (na_launch_base / euro_spaceport / asia_cosmodrome)
 *      correlate with winning.
 *
 * Ruleset: economy + tech + stability ON; naval / events / factions / cards /
 * era-advancement OFF (deterministic, isolates the Moon race — noted in output).
 * Victory: domination (+ implicit last_standing). NOTE: 'domination' requires
 * EVERY territory including the 9 neutral Moon tiles, so most decisive games end
 * via last_standing. With space_age_frontiers_enabled ON (default here), the 8
 * authored unlock_era_index>0 frontier tiles are seeded neutral at start → the
 * full 63-tile board (46 Earth + 8 frontier + 9 neutral Moon). Set SIM_FRONTIERS=0
 * for the 55-tile pre-feature baseline.
 *
 * ENGINE-vs-SOCKET NOTE (production discrepancy, replicated honestly here):
 * The AI's "Launch Space Station" step exists ONLY in the socket layer
 * (gameSocket.ts processAiTurn, ~line 5010) — the pure engine (computeAiTurn /
 * selectAiTechResearch / selectAiBuildingPlacement) never fires it. Worse, that
 * socket block runs AFTER `state.phase = 'attack'` (gameSocket.ts:4962), and
 * executeTechAbility rejects launch_space_station during the attack phase
 * (executeTechAbility.ts:306-308) — so in production the AI launch appears to
 * ALWAYS fail. This sim replicates the socket sequence via the same executor
 * (executeTechAbility) but schedules it in the DRAFT phase as intended;
 * SIM_LAUNCH_PHASE=attack reproduces the production ordering to quantify the bug.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simSpaceAgeBalance.ts
 *   SIM_GAMES=60 SIM_PLAYERS=4 SIM_DIFFICULTY=expert SIM_MAX_TURNS=80 \
 *     SIM_SEED=borderfall SIM_CSV=/tmp/sim_space_age.csv \
 *     pnpm exec tsx scripts/simSpaceAgeBalance.ts
 *   SIM_LAUNCH_PHASE=attack pnpm exec tsx scripts/simSpaceAgeBalance.ts   # prod repro
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
import { executeTechAbility } from '../src/game-engine/abilities/executeTechAbility';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import {
  connectionRequiresMoonAccess,
  fortifyEndpointsRequireOrbitAccess,
  getOrbitAccessResult,
} from '../src/game-engine/state/moonAccess';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

const GAMES = Number(process.env.SIM_GAMES ?? 60);
const PLAYERS = Number(process.env.SIM_PLAYERS ?? 4);
const DIFFICULTY = (process.env.SIM_DIFFICULTY ?? 'medium') as AiDifficulty;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 80);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-space-age';
const CSV_PATH = process.env.SIM_CSV ?? '';
/** 'draft' = intended behavior; 'attack' = replicate the production socket ordering (launch always rejected). */
const LAUNCH_PHASE = (process.env.SIM_LAUNCH_PHASE ?? 'draft') as 'draft' | 'attack';
/** Standalone frontier seeding (the full 63-tile board). Default ON — set SIM_FRONTIERS=0 for the 55-tile baseline. */
const FRONTIERS = process.env.SIM_FRONTIERS !== '0';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
const LADDER = [
  'sa_digital_warfare',
  'sa_orbital_recon',
  'sa_launch_pad_tech',
  'sa_space_station',
  'sa_lunar_expansion',
] as const;
const ANCHORS = ['na_launch_base', 'euro_spaceport', 'asia_cosmodrome'] as const;

function loadMap(): GameMap {
  const raw = readFileSync(join(__dirname, '../../database/maps/era_space_age.json'), 'utf-8');
  return JSON.parse(raw) as GameMap;
}

function simSettings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    factions_enabled: false, // no Lunar Pioneers shortcut — everyone must climb the ladder
    naval_enabled: false, // determinism: no fleet RNG (sea-lane land attacks still allowed)
    events_enabled: false, // determinism: no event deck
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    era_advancement_enabled: false, // space_age is the start AND terminal era here
    space_age_frontiers_enabled: FRONTIERS, // seed the 8 authored frontiers (full 63-tile board)
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

function applyFortify(state: GameState, map: GameMap, pid: string, from: string, to: string, units?: number): void {
  const f = state.territories[from];
  const t = state.territories[to];
  if (!f || !t || f.owner_id !== pid || t.owner_id !== pid) return;
  // Orbit parity with the socket fortify handler: any Moon endpoint requires access.
  if (fortifyEndpointsRequireOrbitAccess(map, state.era, from, to)) {
    const player = state.players.find((p) => p.player_id === pid);
    if (!player || !getOrbitAccessResult(state, player, map, state.era).allowed) return;
  }
  const move = Math.min(units ?? f.unit_count - 1, f.unit_count - 1);
  if (move <= 0) return;
  f.unit_count -= move;
  t.unit_count += move;
}

interface PlayerSim {
  pid: string;
  ladderTurns: (number | null)[]; // turn each rung was first unlocked
  launchPadTurn: number | null;
  stationLaunchTurn: number | null;
  launchRejectedAttackPhase: number; // production-repro mode: rejected launch attempts
  accessTurn: number | null; // first turn getOrbitAccessResult.allowed
  firstMoonCaptureTurn: number | null;
  moonCaptureEvents: number;
}

function ladderDepth(ps: PlayerSim): number {
  let d = 0;
  for (let i = 0; i < LADDER.length; i++) { if (ps.ladderTurns[i] != null) d = i + 1; }
  return d;
}

/** One AI player's full turn, mirroring gameSocket.processAiTurn's sequence. */
function playAiTurn(
  state: GameState,
  map: GameMap,
  ps: PlayerSim,
  difficulty: AiDifficulty,
  dieRoll: () => number,
): void {
  const pid = ps.pid;
  const player = state.players.find((p) => p.player_id === pid);
  if (!player) return;

  state.phase = 'draft';
  const plan = computeAiTurn(state, map, difficulty); // planned before economy, like the socket

  // Economy first (matches processAiTurn): build, then research.
  const build = selectAiBuildingPlacement(state, map, pid, difficulty);
  if (build) {
    applyBuild(state, pid, build.territoryId, build.buildingType); // validates internally (returns void)
    if (
      build.buildingType === 'launch_pad'
      && ps.launchPadTurn == null
      && (state.territories[build.territoryId]?.buildings?.includes('launch_pad') ?? false)
    ) {
      ps.launchPadTurn = state.turn_number;
    }
  }
  const techId = selectAiTechResearch(state, pid, difficulty);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) applyResearch(state, pid, v.node);
  }
  // Ladder progress snapshot (research above may have added a rung).
  const unlocked = player.unlocked_techs ?? [];
  LADDER.forEach((tid, i) => {
    if (ps.ladderTurns[i] == null && unlocked.includes(tid)) ps.ladderTurns[i] = state.turn_number;
  });

  // Space-station launch — replicates the gameSocket AI-parity block
  // (gameSocket.ts ~5010) through the SAME executor. Production runs it after
  // `state.phase = 'attack'`, where executeTechAbility rejects it; default
  // 'draft' mode schedules it where the ability is actually legal.
  const tryLaunch = (): void => {
    if (state.era !== 'space_age' || player.space_station_launched) return;
    if (!(player.unlocked_techs ?? []).includes('sa_space_station')) return;
    const res = executeTechAbility({ state, map, playerId: pid, abilityId: 'launch_space_station' });
    if (res.success && res.effect === 'space_station_launched') {
      if (ps.stationLaunchTurn == null) ps.stationLaunchTurn = state.turn_number;
    } else if (!res.success && state.phase === 'attack') {
      ps.launchRejectedAttackPhase++;
    }
  };
  if (LAUNCH_PHASE === 'draft') tryLaunch();

  applyDraft(state, pid, plan);

  state.phase = 'attack';
  if (LAUNCH_PHASE === 'attack') tryLaunch(); // production ordering repro

  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    // Orbit parity with the socket attack loop: crossing an orbit edge requires access.
    const orbitAllowed = getOrbitAccessResult(state, player, map, state.era).allowed;
    if (connectionRequiresMoonAccess(map, a.from, a.to) && !orbitAllowed) continue;
    const conn = map.connections.find(
      (c) => (c.from === a.from && c.to === a.to) || (c.from === a.to && c.to === a.from),
    );
    const outcome = executeLandAttack(state, pid, a.from, a.to, {
      dieRoll,
      connection: conn,
      neutralOffworldCaptureAllowed: orbitAllowed, // same rule the socket applies
    });
    if (outcome?.captured && state.territories[a.to]?.world_id === 'moon') {
      ps.moonCaptureEvents++;
      if (ps.firstMoonCaptureTurn == null) ps.firstMoonCaptureTurn = state.turn_number;
    }
  }

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type === 'fortify' && a.from && a.to) applyFortify(state, map, pid, a.from, a.to, a.units);
  }

  if (ps.accessTurn == null && getOrbitAccessResult(state, player, map, state.era).allowed) {
    ps.accessTurn = state.turn_number;
  }
}

interface GameStat {
  game: number;
  seed: number;
  turns: number;
  winner: string | null;
  victory: string;
  decisive: boolean;
  maxLadderDepth: number;
  laddersCompleted: number; // players reaching rung 5
  firstPadTurn: number | null;
  padsBuilt: number;
  firstStationTurn: number | null;
  stationsLaunched: number;
  launchRejectedAttackPhase: number;
  firstMoonCaptureTurn: number | null;
  moonCaptureEvents: number;
  moonTilesPlayerHeldEnd: number; // of 9
  winnerMoonTilesEnd: number;
  loserAvgMoonTilesEnd: number;
  moonLeader: string | null; // strict leader in moon tiles at end (>0)
  moonLeaderWon: boolean;
  lunarRegionHolder: string | null; // first player to hold all 9 moon tiles
  lunarRegionTurn: number | null;
  lunarRegionHolderWon: boolean;
  winnerAnchorsEnd: number;
  t10Leader: string | null;
  t10LeaderWon: boolean;
  t10AnchorLeader: string | null;
  t10AnchorLeaderWon: boolean;
  winnerLadderDepth: number;
  perPlayerDepths: string; // "5@t22|3@-|..." depth@stationTurn per seat
  frontierTilesInPlay: number; // seeded Earth frontiers (0 when SIM_FRONTIERS=0)
  frontierNeutralEnd: number; // frontiers still unowned at game end (should trend to ~0)
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

function anchorCounts(state: GameState): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of ANCHORS) {
    const owner = state.territories[a]?.owner_id;
    if (owner) m.set(owner, (m.get(owner) ?? 0) + 1);
  }
  return m;
}

function strictMaxKey(m: Map<string, number>): string | null {
  let best: string | null = null; let bestN = -1; let tie = false;
  for (const [k, n] of m) {
    if (n > bestN) { best = k; bestN = n; tie = false; }
    else if (n === bestN) tie = true;
  }
  return tie ? null : best;
}

function runGame(map: GameMap, moonTileIds: string[], frontierIds: string[], gameIndex: number): GameStat {
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

  const state = initializeGameState(`sasim_${gameIndex}`, 'space_age', map, players, simSettings(), {
    forceStartingPlayerIndex: 0,
  });
  const sims = new Map<string, PlayerSim>(players.map((p) => [p.player_id, {
    pid: p.player_id,
    ladderTurns: LADDER.map(() => null),
    launchPadTurn: null,
    stationLaunchTurn: null,
    launchRejectedAttackPhase: 0,
    accessTurn: null,
    firstMoonCaptureTurn: null,
    moonCaptureEvents: 0,
  }]));

  let t10Leader: string | null = null;
  let t10AnchorLeader: string | null = null;
  let t10Captured = false;
  let lunarRegionHolder: string | null = null;
  let lunarRegionTurn: number | null = null;

  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      playAiTurn(state, map, sims.get(player.player_id)!, DIFFICULTY, dieRoll);
    }
    advanceToNextPlayer(state, map);

    if (!t10Captured && state.turn_number >= 10) {
      t10Captured = true;
      t10Leader = territoryLeader(state);
      t10AnchorLeader = strictMaxKey(anchorCounts(state));
    }

    if (lunarRegionHolder == null) {
      const owners = new Set(moonTileIds.map((tid) => state.territories[tid]?.owner_id ?? null));
      if (owners.size === 1) {
        const only = owners.values().next().value;
        if (only) { lunarRegionHolder = only; lunarRegionTurn = state.turn_number; }
      }
    }

    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0];
      state.victory_condition = victory.condition;
    }
  }

  const winner = state.winner_id ?? null;
  const simList = [...sims.values()];
  const moonEnd = new Map<string, number>();
  for (const tid of moonTileIds) {
    const o = state.territories[tid]?.owner_id;
    if (o) moonEnd.set(o, (moonEnd.get(o) ?? 0) + 1);
  }
  const moonTilesPlayerHeldEnd = [...moonEnd.values()].reduce((a, b) => a + b, 0);
  const frontierNeutralEnd = frontierIds.filter((tid) => !state.territories[tid]?.owner_id).length;
  const moonLeader = strictMaxKey(moonEnd);
  const winnerMoonTilesEnd = winner ? (moonEnd.get(winner) ?? 0) : 0;
  const loserMoon = players.filter((p) => p.player_id !== winner).map((p) => moonEnd.get(p.player_id) ?? 0);
  const winnerSim = winner ? sims.get(winner) : undefined;

  const firsts = (vals: (number | null)[]): number | null => {
    const xs = vals.filter((v): v is number => v != null);
    return xs.length ? Math.min(...xs) : null;
  };

  return {
    game: gameIndex,
    seed,
    turns: state.turn_number,
    winner,
    victory: state.victory_condition ?? 'none',
    decisive: state.victory_condition != null && state.victory_condition !== 'turn_limit',
    maxLadderDepth: Math.max(...simList.map(ladderDepth)),
    laddersCompleted: simList.filter((s) => ladderDepth(s) >= LADDER.length).length,
    firstPadTurn: firsts(simList.map((s) => s.launchPadTurn)),
    padsBuilt: simList.filter((s) => s.launchPadTurn != null).length,
    firstStationTurn: firsts(simList.map((s) => s.stationLaunchTurn)),
    stationsLaunched: simList.filter((s) => s.stationLaunchTurn != null).length,
    launchRejectedAttackPhase: simList.reduce((a, s) => a + s.launchRejectedAttackPhase, 0),
    firstMoonCaptureTurn: firsts(simList.map((s) => s.firstMoonCaptureTurn)),
    moonCaptureEvents: simList.reduce((a, s) => a + s.moonCaptureEvents, 0),
    moonTilesPlayerHeldEnd,
    winnerMoonTilesEnd,
    loserAvgMoonTilesEnd: loserMoon.length ? loserMoon.reduce((a, b) => a + b, 0) / loserMoon.length : 0,
    moonLeader,
    moonLeaderWon: !!moonLeader && moonLeader === winner,
    lunarRegionHolder,
    lunarRegionTurn,
    lunarRegionHolderWon: !!lunarRegionHolder && lunarRegionHolder === winner,
    winnerAnchorsEnd: winner ? (anchorCounts(state).get(winner) ?? 0) : 0,
    t10Leader,
    t10LeaderWon: !!t10Leader && t10Leader === winner,
    t10AnchorLeader,
    t10AnchorLeaderWon: !!t10AnchorLeader && t10AnchorLeader === winner,
    winnerLadderDepth: winnerSim ? ladderDepth(winnerSim) : 0,
    perPlayerDepths: simList
      .map((s) => `${ladderDepth(s)}@${s.stationLaunchTurn != null ? `t${s.stationLaunchTurn}` : '-'}`)
      .join('|'),
    frontierTilesInPlay: frontierIds.length,
    frontierNeutralEnd,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmt(n: number, digits = 1): string {
  return Number.isNaN(n) ? 'n/a' : n.toFixed(digits);
}

function main(): void {
  const map = loadMap();
  const moonTileIds = map.territories
    .filter((t) => t.region_id === 'lunar_surface')
    .map((t) => t.territory_id);
  // Earth-side frontiers seeded only when the flag is on; empty otherwise.
  const frontierIds = FRONTIERS
    ? map.territories.filter((t) => (t.unlock_era_index ?? 0) > 0).map((t) => t.territory_id)
    : [];
  const started = Date.now();
  const stats: GameStat[] = [];
  for (let i = 0; i < GAMES; i++) stats.push(runGame(map, moonTileIds, frontierIds, i));
  const elapsedS = (Date.now() - started) / 1000;

  const decisive = stats.filter((s) => s.decisive);
  const victories = stats.reduce<Record<string, number>>((acc, s) => { acc[s.victory] = (acc[s.victory] ?? 0) + 1; return acc; }, {});
  const withT10 = stats.filter((s) => s.t10Leader);
  const withT10Anchor = stats.filter((s) => s.t10AnchorLeader);
  const withMoonLeader = stats.filter((s) => s.moonLeader);
  const withStation = stats.filter((s) => s.firstStationTurn != null);
  const withPad = stats.filter((s) => s.firstPadTurn != null);
  const withCapture = stats.filter((s) => s.firstMoonCaptureTurn != null);
  const withRegion = stats.filter((s) => s.lunarRegionHolder);
  const totalRejected = stats.reduce((a, s) => a + s.launchRejectedAttackPhase, 0);

  const baseInPlay = map.territories.filter((t) => (t.unlock_era_index ?? 0) <= 0).length;
  const frontierCount = map.territories.length - baseInPlay;
  const inPlay = FRONTIERS ? map.territories.length : baseInPlay;
  console.log(`\nSpace Age balance — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · maxTurns ${MAX_TURNS} · launchPhase=${LAUNCH_PHASE} · frontiers=${FRONTIERS ? 'on' : 'off'}`);
  console.log(`Map: ${map.territories.length} territories in file · ${inPlay} in play (${baseInPlay - moonTileIds.length} Earth${FRONTIERS ? ` + ${frontierCount} frontier` : ''} + ${moonTileIds.length} neutral Moon${FRONTIERS ? '' : '; era-locked frontiers never spawn'})`);
  console.log(`Seed "${MASTER_SEED}" · ${elapsedS.toFixed(1)}s (${((elapsedS / GAMES) * 1000).toFixed(1)}ms/game)`);
  console.log(`Ruleset: economy+tech+stability ON · naval/events/factions/era-advancement OFF · domination(+last_standing)\n`);

  console.log(`— Moon tech ladder (${LADDER.join(' → ')}) —`);
  console.log(`Games where any player completed the ladder: ${pct(stats.filter((s) => s.maxLadderDepth >= 5).length, GAMES)}`);
  console.log(`Player-slots completing the ladder:          ${pct(stats.reduce((a, s) => a + s.laddersCompleted, 0), GAMES * PLAYERS)}`);
  console.log(`Median deepest ladder rung per game (0-5):   ${fmt(median(stats.map((s) => s.maxLadderDepth)), 1)}`);
  console.log(`Launch pad built (any player):               ${pct(withPad.length, GAMES)} · avg first-pad turn ${fmt(avg(withPad.map((s) => s.firstPadTurn!)))}`);
  console.log(`Space station launched (any player):         ${pct(withStation.length, GAMES)} · avg first-launch turn ${fmt(avg(withStation.map((s) => s.firstStationTurn!)))}`);
  console.log(`Avg stations launched per game:              ${fmt(avg(stats.map((s) => s.stationsLaunched)), 2)}`);
  if (LAUNCH_PHASE === 'attack' || totalRejected > 0) {
    console.log(`Launches REJECTED (attack-phase ordering):   ${totalRejected} attempts across ${GAMES} games  <== production gameSocket ordering`);
  }

  console.log(`\n— Moon conquest —`);
  console.log(`Games with any Moon tile captured:           ${pct(withCapture.length, GAMES)} · avg first-capture turn ${fmt(avg(withCapture.map((s) => s.firstMoonCaptureTurn!)))}`);
  console.log(`Avg player-held Moon tiles at end (of 9):    ${fmt(avg(stats.map((s) => s.moonTilesPlayerHeldEnd)), 2)}`);
  console.log(`Lunar Surface region fully held (any):       ${pct(withRegion.length, GAMES)}${withRegion.length ? ` · avg turn ${fmt(avg(withRegion.map((s) => s.lunarRegionTurn!)))}` : ''}`);

  console.log(`\n— Does the Moon correlate with winning? —`);
  console.log(`Moon-tile leader at end won:                 ${pct(withMoonLeader.filter((s) => s.moonLeaderWon).length, withMoonLeader.length)}  (n=${withMoonLeader.length}; baseline ${pct(1, PLAYERS)})`);
  console.log(`Winner avg Moon tiles at end:                ${fmt(avg(stats.filter((s) => s.winner).map((s) => s.winnerMoonTilesEnd)), 2)} vs losers ${fmt(avg(stats.filter((s) => s.winner).map((s) => s.loserAvgMoonTilesEnd)), 2)}`);
  if (withRegion.length) {
    console.log(`Lunar-region holder won:                     ${pct(withRegion.filter((s) => s.lunarRegionHolderWon).length, withRegion.length)}  (n=${withRegion.length})`);
  }
  console.log(`Winner ladder depth (avg rungs of 5):        ${fmt(avg(stats.filter((s) => s.winner).map((s) => s.winnerLadderDepth)), 2)}`);

  console.log(`\n— Orbit anchors (${ANCHORS.join(', ')}) —`);
  console.log(`Anchor leader at turn 10 won:                ${pct(withT10Anchor.filter((s) => s.t10AnchorLeaderWon).length, withT10Anchor.length)}  (n=${withT10Anchor.length}; baseline ${pct(1, PLAYERS)})`);
  console.log(`Winner anchors held at end (avg of 3):       ${fmt(avg(stats.filter((s) => s.winner).map((s) => s.winnerAnchorsEnd)), 2)}`);

  console.log(`\n— Tempo / snowball —`);
  console.log(`Avg game length (turns):                     ${fmt(avg(stats.map((s) => s.turns)))} · median ${fmt(median(stats.map((s) => s.turns)))}`);
  console.log(`Decisive (non-turn-limit) wins:              ${pct(decisive.length, GAMES)}`);
  console.log(`Victory distribution:                        ${Object.entries(victories).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log(`Territory-leader@turn10 win rate:            ${pct(withT10.filter((s) => s.t10LeaderWon).length, withT10.length)}  (n=${withT10.length}; baseline ${pct(1, PLAYERS)})`);
  if (FRONTIERS && frontierIds.length > 0) {
    // Confirms seeded frontiers get conquered rather than sitting decorative.
    console.log(`Frontier tiles (${frontierIds.length}): avg still-neutral at end:  ${fmt(avg(stats.map((s) => s.frontierNeutralEnd)))} (0 = all conquered)`);
  }

  if (CSV_PATH) {
    const header = [
      'game', 'seed', 'turns', 'winner', 'victory', 'decisive',
      'max_ladder_depth', 'ladders_completed', 'first_pad_turn', 'pads_built',
      'first_station_turn', 'stations_launched', 'launch_rejected_attack_phase',
      'first_moon_capture_turn', 'moon_capture_events', 'moon_tiles_player_held_end',
      'winner_moon_tiles_end', 'loser_avg_moon_tiles_end', 'moon_leader', 'moon_leader_won',
      'lunar_region_holder', 'lunar_region_turn', 'lunar_region_holder_won',
      'winner_anchors_end', 't10_leader', 't10_leader_won', 't10_anchor_leader', 't10_anchor_leader_won',
      'winner_ladder_depth', 'per_player_depth_at_station_turn',
    ].join(',');
    const rows = stats.map((s) => [
      s.game, s.seed, s.turns, s.winner ?? '', s.victory, s.decisive,
      s.maxLadderDepth, s.laddersCompleted, s.firstPadTurn ?? '', s.padsBuilt,
      s.firstStationTurn ?? '', s.stationsLaunched, s.launchRejectedAttackPhase,
      s.firstMoonCaptureTurn ?? '', s.moonCaptureEvents, s.moonTilesPlayerHeldEnd,
      s.winnerMoonTilesEnd, s.loserAvgMoonTilesEnd.toFixed(2), s.moonLeader ?? '', s.moonLeaderWon,
      s.lunarRegionHolder ?? '', s.lunarRegionTurn ?? '', s.lunarRegionHolderWon,
      s.winnerAnchorsEnd, s.t10Leader ?? '', s.t10LeaderWon, s.t10AnchorLeader ?? '', s.t10AnchorLeaderWon,
      s.winnerLadderDepth, s.perPlayerDepths,
    ].join(','));
    writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n');
    console.log(`\nWrote per-game CSV → ${CSV_PATH}`);
  }
}

main();
