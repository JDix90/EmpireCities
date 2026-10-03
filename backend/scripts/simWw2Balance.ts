/**
 * Headless WW2 economy harness (docs/WW2_MANHATTAN_PROJECT.md §2).
 *
 * Neither existing harness can say how a World War II game plays out with its
 * economy: `simFactionBalance.ts` never researches or builds, and
 * `simEraBalance.ts` climbs from Ancient with factions off and reports nothing
 * about the era's showpiece weapon. This one plays the WW2 tree for real —
 * build, research, the faction kits, the attack exchanges — and reports when,
 * whether and how the Manhattan Project's bomb enters the game.
 *
 * Two modes:
 *
 *   SIM_MODE=custom  (default) a WW2 game on `era_ww2` with economy and tech on,
 *                    factions on (the six WW2 factions, rotated so every faction
 *                    sits in every seat), expert bots, a 90-turn cap. The
 *                    lobby's tech-on custom game.
 *   SIM_MODE=full    the Full Game climb as the lobby creates it, minus naval,
 *                    events and cards: Ancient start on `era_ancient`, the
 *                    classic spine, economy, tech and stability on, factions
 *                    off, `era_advancement_max_lead: 2`, a 150-turn cap, and
 *                    Full Game's defaults: four seats, medium bots, the
 *                    full-board ending.
 *
 * Every turn follows processAiTurn's pure-engine order: plan, build, research,
 * advance (full mode), the faction's draft ability, draft, the faction's attack
 * strike or buff, the attack exchanges, fortify. Engine randomness is seeded per
 * game (seededEngineRandomness.ts) and the run ends with a digest, so a re-run
 * of one configuration on one seed is the same run.
 *
 * Custom mode plays the Quick Match default ending, Conquest: domination, or
 * 65% of the board (`quickMatchPrefs.ts`, `majority`). The custom lobby's own
 * default is domination with no turn cap, which six bots never resolve inside
 * 90 turns, so a harness on it would measure only the cap.
 *
 * Knobs: SIM_MODE, SIM_GAMES, SIM_PLAYERS, SIM_SEED, SIM_DIFFICULTY,
 * SIM_MAX_TURNS, SIM_ENDING=conquest|domination, SIM_FACTIONS=0
 * (custom mode without kits), SIM_STABILITY=1 (custom mode with stability;
 * full mode always has it).
 *
 * Package phases, each the setting its flag bakes (all off by default, which is
 * the shipped game): SIM_BOMB_AI=1 (Phase 1, `ww2_bomb_ai`), SIM_SCIENCE=1
 * (Phase 2, `ww2_manhattan_science`), SIM_ARSENAL=1 (Phase 3, `ww2_atomic_arsenal`).
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simWw2Balance.ts
 *   SIM_MODE=full SIM_GAMES=1000 SIM_SEED=ww2-b pnpm exec tsx scripts/simWw2Balance.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { AiDifficulty, EraId, GameMap, GameSettings, GameState } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  initializeGameState,
} from '../src/game-engine/state/gameStateManager';
import { computeAiTurn, selectAiBuildingPlacement, selectAiTechResearch } from '../src/game-engine/ai/aiBot';
import { evaluateAiEraAdvancement } from '../src/game-engine/ai/aiEraAdvancement';
import { executeAdvanceEra } from '../src/game-engine/eraAdvancement/advanceEra';
import { resolvePlayerEraId } from '../src/game-engine/eraAdvancement/constants';
import { getMaxEraIndex } from '../src/game-engine/eraAdvancement/spines';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import {
  aiAttackExchangeBudget,
  runAiAttackExchanges,
  shouldPressDecidedGame,
} from '../src/game-engine/ai/aiAttackGrind';
import { shouldSpendTechPointsOnAbility } from '../src/game-engine/ai/aiTechBudget';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { getEraFactions } from '../src/game-engine/eras';
import { getPlayerFaction } from '../src/game-engine/eras/factionLineage';
import { executeTechAbility, isGameScopedAbility } from '../src/game-engine/abilities/executeTechAbility';
import { TARGETED_DRAFT_ABILITIES, TERRITORY_ABILITY_DEFS } from '../src/game-engine/abilities/techAbilities';
import { applyBombElimination, selectAiAtomBombStrike } from '../src/game-engine/ai/aiAtomBomb';
import { anyAtomBombDetonated } from '../src/game-engine/state/atomicArsenal';
import { seedEngineRandomness, seededUuid } from './seededEngineRandomness';

const MODE = (process.env.SIM_MODE ?? 'custom') as 'custom' | 'full';
if (MODE !== 'custom' && MODE !== 'full') throw new Error(`SIM_MODE must be custom or full, not ${MODE}`);
const WW2_FACTIONS = getEraFactions('ww2');
const FACTIONS_ON = MODE === 'custom' && process.env.SIM_FACTIONS !== '0';
const PLAYERS = Number(process.env.SIM_PLAYERS ?? (MODE === 'custom' ? WW2_FACTIONS.length : 4));
const GAMES = Number(process.env.SIM_GAMES ?? 300);
// Full mode plays Full Game's defaults (DEFAULT_FULL_GAME_PREFS): three medium
// bots and the full-board ending. Custom mode plays expert bots to Conquest.
const DIFFICULTY = (process.env.SIM_DIFFICULTY ?? (MODE === 'custom' ? 'expert' : 'medium')) as AiDifficulty;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? (MODE === 'custom' ? 90 : 150));
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-ww2-balance';
const STABILITY = MODE === 'full' || process.env.SIM_STABILITY === '1';
const ENDING = (process.env.SIM_ENDING ?? (MODE === 'custom' ? 'conquest' : 'domination')) as 'conquest' | 'domination';
if (ENDING !== 'conquest' && ENDING !== 'domination') throw new Error(`SIM_ENDING must be conquest or domination, not ${ENDING}`);
const START_ERA: EraId = MODE === 'custom' ? 'ww2' : 'ancient';
const MAP_ID = MODE === 'custom' ? 'era_ww2' : 'era_ancient';
const MANHATTAN = 'ww2_atom_bomb';
const BOMB_AI = process.env.SIM_BOMB_AI === '1';
const SCIENCE = process.env.SIM_SCIENCE === '1';
const ARSENAL = process.env.SIM_ARSENAL === '1';
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];

if (FACTIONS_ON && PLAYERS > WW2_FACTIONS.length) {
  throw new Error(`SIM_PLAYERS=${PLAYERS} exceeds the ${WW2_FACTIONS.length} WW2 factions`);
}

function loadMap(): GameMap {
  return JSON.parse(readFileSync(join(__dirname, '../../database/maps', `${MAP_ID}.json`), 'utf-8')) as GameMap;
}

function simSettings(): GameSettings {
  const common = {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    naval_enabled: false,
    events_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: STABILITY,
    combat_dice_cap_enabled: true,
    ...(BOMB_AI ? { ww2_bomb_ai: true } : {}),
    ...(SCIENCE ? { ww2_manhattan_science: true } : {}),
    ...(ARSENAL ? { ww2_atomic_arsenal: true } : {}),
    ...(ENDING === 'conquest'
      ? { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 65 }
      : { allowed_victory_conditions: ['domination'] }),
    victory_type: 'domination',
    max_turns: MAX_TURNS,
  };
  if (MODE === 'custom') return { ...common, factions_enabled: FACTIONS_ON } as GameSettings;
  return {
    ...common,
    factions_enabled: false,
    era_advancement_enabled: true,
    era_advancement_preset: 'standard',
    era_advancement_spine_id: 'classic',
    era_advancement_max_lead: 2,
  } as GameSettings;
}

function seededDie(seed: number): () => number {
  const rng = createSeededRng(seed);
  return () => Math.floor(rng() * 6) + 1;
}

function ownedIds(state: GameState, pid: string): string[] {
  return Object.keys(state.territories).filter((t) => state.territories[t]!.owner_id === pid).sort();
}

/** The seat a custom game deals faction `i` to: a rotation per game, a fresh window per cycle. */
function lineup(gameIndex: number): string[] {
  const n = WW2_FACTIONS.length;
  const start = gameIndex % n;
  return Array.from({ length: PLAYERS }, (_, i) => WW2_FACTIONS[(start + i) % n]!.faction_id);
}

/** Every reinforcement on the AI's planned draft target, else its first territory. */
function applyDraft(state: GameState, pid: string, plan: AiAction[]): void {
  const remaining = state.draft_units_remaining ?? 0;
  if (remaining <= 0) return;
  const owned = ownedIds(state, pid);
  if (owned.length === 0) { state.draft_units_remaining = 0; return; }
  const planned = plan.find((a) => a.type === 'draft' && a.to && state.territories[a.to]?.owner_id === pid)?.to;
  state.territories[planned ?? owned[0]!]!.unit_count += remaining;
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
 * The faction kit, as processAiTurn's parity blocks fire it: a draft ability
 * before placement (a tech-costed one only when the bot can spare the points),
 * an attack strike on the first planned enemy target, an attack self-buff.
 */
function fireFactionAbility(state: GameState, map: GameMap, pid: string, phase: 'draft' | 'attack', plan: AiAction[]): void {
  const player = state.players.find((p) => p.player_id === pid);
  if (!player || !state.settings.factions_enabled || !player.faction_id) return;
  const abilityId = getPlayerFaction(state, player)?.ability_id;
  if (!abilityId) return;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def || def.phase !== phase) return;
  const gameScoped = isGameScopedAbility(abilityId);
  const used = gameScoped
    ? (player.used_game_abilities ?? []).includes(abilityId)
    : !!(player.ability_uses ?? {})[abilityId];
  if (used) return;

  let territoryId: string | undefined;
  if (phase === 'draft') {
    if (!shouldSpendTechPointsOnAbility(state, pid, DIFFICULTY, def.techCost ?? 0)) return;
    if (def.ownPlacement || TARGETED_DRAFT_ABILITIES.has(abilityId)) {
      territoryId = Object.values(state.territories)
        .filter((t) => t.owner_id === pid)
        .sort((a, b) => b.unit_count - a.unit_count || a.territory_id.localeCompare(b.territory_id))[0]?.territory_id;
      if (!territoryId) return;
    }
  } else {
    const isStrike = def.unitReduction != null && !def.selfBuff;
    const isSelfBuff = def.selfBuff === 'extra_attack_die' || def.selfBuff === 'negate_attacker_losses';
    if (!isStrike && !isSelfBuff) return;
    if (isStrike) {
      territoryId = plan.find(
        (a) => a.type === 'attack' && a.from && a.from !== '__influence__' && a.to
          && state.territories[a.to]?.owner_id != null
          && state.territories[a.to]?.owner_id !== pid,
      )?.to;
      if (!territoryId) return;
    }
  }
  const res = executeTechAbility({ state, map, playerId: pid, abilityId, territoryId });
  if (res.success && !gameScoped) player.ability_uses = { ...(player.ability_uses ?? {}), [abilityId]: 1 };
}

/** One seat's game-long record of the bomb. */
interface SeatRecord {
  label: string;
  /** Turn this seat researched Manhattan Project, if it did. */
  manhattanTurn: number | null;
  /** Full mode: turn this seat entered WW2, and left it. */
  ww2EnterTurn: number | null;
  ww2LeaveTurn: number | null;
  bombs: number;
  firstBombTurn: number | null;
  /** Detonations whose tile this seat took the same turn. */
  walkIns: number;
  /** Atomic arsenal: PP this seat paid for bombs, and whether it bought Manhattan at the proliferation discount. */
  bombPP: number;
  proliferated: boolean;
}

function emptySeat(label: string): SeatRecord {
  return {
    label, manhattanTurn: null, ww2EnterTurn: null, ww2LeaveTurn: null, bombs: 0, firstBombTurn: null, walkIns: 0,
    bombPP: 0, proliferated: false,
  };
}

/** One player's turn, in processAiTurn's order. */
async function playAiTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  dieRoll: () => number,
  jitter: () => number,
  seat: SeatRecord,
): Promise<void> {
  state.phase = 'draft';
  const decidedPress = shouldPressDecidedGame(state, pid, DIFFICULTY);
  const plan = computeAiTurn(state, map, DIFFICULTY, { captureOddsScoring: true, decidedGamePress: decidedPress, rng: jitter });

  const build = selectAiBuildingPlacement(state, map, pid, DIFFICULTY);
  if (build) applyBuild(state, pid, build.territoryId, build.buildingType);
  const techId = selectAiTechResearch(state, pid, DIFFICULTY);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) {
      const discounted = techId === MANHATTAN && ARSENAL && anyAtomBombDetonated(state);
      applyResearch(state, pid, v.node);
      if (techId === MANHATTAN && seat.manhattanTurn == null) {
        seat.manhattanTurn = state.turn_number;
        seat.proliferated = discounted;
      }
    }
  }

  if (state.settings.era_advancement_enabled) {
    const me = state.players.find((p) => p.player_id === pid)!;
    const before = resolvePlayerEraId(state, me);
    if (evaluateAiEraAdvancement(state, map, pid, DIFFICULTY).shouldAdvance && executeAdvanceEra(state, pid, map).success) {
      const after = resolvePlayerEraId(state, me);
      if (before === 'ww2') seat.ww2LeaveTurn = state.turn_number;
      if (after === 'ww2') seat.ww2EnterTurn = state.turn_number;
    }
  }

  fireFactionAbility(state, map, pid, 'draft', plan);
  applyDraft(state, pid, plan);

  state.phase = 'attack';
  fireFactionAbility(state, map, pid, 'attack', plan);
  // The bomb, where processAiTurn fires it: after the faction's strike, before
  // the attacks, with the walk-in at the head of the plan.
  let bombed: string | null = null;
  const strike = selectAiAtomBombStrike(state, map, pid);
  if (strike) {
    const res = executeTechAbility({ state, map, playerId: pid, abilityId: 'atom_bomb', territoryId: strike.territoryId });
    if (res.success) {
      const bomber = state.players.find((p) => p.player_id === pid)!;
      // Under the arsenal the bomb is once per turn, recorded as the socket records it.
      if (!isGameScopedAbility('atom_bomb', state)) bomber.ability_uses = { ...(bomber.ability_uses ?? {}), atom_bomb: 1 };
      seat.bombPP += res.productionSpent ?? 0;
      if (bomber.legacy_ability_charges?.atom_bomb) {
        const remaining = { ...bomber.legacy_ability_charges };
        delete remaining.atom_bomb;
        bomber.legacy_ability_charges = remaining;
      }
      applyBombElimination(state, pid, res.previousOwner ?? null);
      seat.bombs += 1;
      seat.firstBombTurn ??= state.turn_number;
      bombed = strike.territoryId;
      if (strike.walkInFrom) plan.unshift({ type: 'attack', from: strike.walkInFrom, to: strike.territoryId });
    }
  }
  const budget = { left: aiAttackExchangeBudget(DIFFICULTY, decidedPress) };
  // Blitzkrieg is a socket state machine with no ability def: one free follow-up
  // exchange after the turn's first capture is what it grants, to the
  // resolution this loop has (simFactionBalance.ts carries the same note).
  const me = state.players.find((p) => p.player_id === pid)!;
  const kit = state.settings.factions_enabled ? getPlayerFaction(state, me)?.ability_id : undefined;
  let blitzLeft = kit === 'double_blitz' ? 2 : kit === 'blitzkrieg' ? 1 : 0;
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    const fromId = a.from;
    const toId = a.to;
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
      exchange: () => (executeLandAttack(state, pid, fromId, toId, { dieRoll, connection }) ? 'ok' : 'stop'),
    });
    if (blitzLeft > 0 && state.territories[toId]?.owner_id === pid) {
      budget.left += 1;
      blitzLeft -= 1;
    }
    if (budget.left <= 0) break;
  }

  if (bombed && state.territories[bombed]?.owner_id === pid) seat.walkIns += 1;

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type === 'fortify' && a.from && a.to) applyFortify(state, pid, a.from, a.to, a.units);
  }
}

interface GameStat {
  turns: number;
  decisive: boolean;
  winner: string | null;
  /** Territory leader at turn 10, when one seat strictly led. */
  leaderT10: string | null;
  seats: SeatRecord[];
  /** Seat labels by player id order, and who won. */
  winnerLabel: string | null;
  ppBanked: number[];
  // Full mode
  advances: number;
  firstAdvancer: string | null;
  eraLeaderT10: string | null;
  reachedFinal: boolean;
  maxEraSpread: number;
}

function territoryLeader(state: GameState): string | null {
  const counts = state.players
    .filter((p) => !p.is_eliminated)
    .map((p) => ({ id: p.player_id, n: ownedIds(state, p.player_id).length }))
    .sort((a, b) => b.n - a.n);
  if (counts.length < 2) return counts[0]?.id ?? null;
  return counts[0]!.n > counts[1]!.n ? counts[0]!.id : null;
}

function eraLeader(state: GameState): string | null {
  let best = -1;
  let leader: string | null = null;
  let tie = false;
  for (const p of state.players) {
    if (p.is_eliminated) continue;
    const era = p.current_era_index ?? 0;
    if (era > best) { best = era; leader = p.player_id; tie = false; } else if (era === best) tie = true;
  }
  return best > 0 && !tie ? leader : null;
}

async function runGame(gameIndex: number, sourceMap: GameMap): Promise<GameStat> {
  const map = structuredClone(sourceMap);
  seedEngineRandomness(`${MASTER_SEED}:engine:${gameIndex}`);
  const dieRoll = seededDie(hashStringToSeed(`${MASTER_SEED}:${gameIndex}`));
  const jitter = createSeededRng(hashStringToSeed(`${MASTER_SEED}:jitter:${gameIndex}`));
  const factions = FACTIONS_ON ? lineup(gameIndex) : null;
  const players = Array.from({ length: PLAYERS }, (_, i) => ({
    player_id: `ai_${i}`,
    player_index: i,
    username: `AI-${i}`,
    color: COLORS[i % COLORS.length]!,
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
    ...(factions ? { faction_id: factions[i]! } : {}),
  }));
  const state = initializeGameState(`ww2sim_${gameIndex}`, START_ERA, map, players, simSettings(), {
    forceStartingPlayerIndex: gameIndex % PLAYERS,
  });
  for (const card of state.card_deck ?? []) card.card_id = seededUuid();

  const seats = new Map(state.players.map((p) => [p.player_id, emptySeat(factions ? factions[p.player_index]! : `seat${p.player_index}`)]));
  const maxEra = MODE === 'full' ? getMaxEraIndex(state) : 0;
  let leaderT10: string | null = null;
  let eraLeaderT10: string | null = null;
  let t10 = false;
  let advances = 0;
  let firstAdvancer: string | null = null;
  let maxEraSpread = 0;
  const eraBefore = new Map(state.players.map((p) => [p.player_id, p.current_era_index ?? 0]));

  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard += 1;
    const player = state.players[state.current_player_index]!;
    if (!player.is_eliminated) {
      await playAiTurn(state, map, player.player_id, dieRoll, jitter, seats.get(player.player_id)!);
      const idx = player.current_era_index ?? 0;
      if (idx > (eraBefore.get(player.player_id) ?? 0)) {
        advances += 1;
        firstAdvancer ??= player.player_id;
        eraBefore.set(player.player_id, idx);
      }
    }
    advanceToNextPlayer(state, map);
    if (MODE === 'full') {
      const eras = state.players.filter((p) => !p.is_eliminated).map((p) => p.current_era_index ?? 0);
      if (eras.length > 1) maxEraSpread = Math.max(maxEraSpread, Math.max(...eras) - Math.min(...eras));
    }
    if (!t10 && state.turn_number >= 10) {
      t10 = true;
      leaderT10 = territoryLeader(state);
      eraLeaderT10 = MODE === 'full' ? eraLeader(state) : null;
    }
    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0] ?? null;
      state.victory_condition = victory.condition;
    }
  }

  const winner = state.winner_id ?? null;
  return {
    turns: state.turn_number,
    decisive: state.victory_condition != null && state.victory_condition !== 'turn_limit',
    winner,
    leaderT10,
    seats: state.players.map((p) => seats.get(p.player_id)!),
    winnerLabel: winner ? seats.get(winner)!.label : null,
    ppBanked: state.players.map((p) => p.special_resource ?? 0),
    advances,
    firstAdvancer,
    eraLeaderT10,
    reachedFinal: MODE === 'full' && state.players.some((p) => (p.current_era_index ?? 0) >= maxEra),
    maxEraSpread,
  };
}

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fixed = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

async function main(): Promise<void> {
  const map = loadMap();
  const started = Date.now();
  const stats: GameStat[] = [];
  for (let g = 0; g < GAMES; g++) stats.push(await runGame(g, map));
  const elapsed = (Date.now() - started) / 1000;

  const decisive = stats.filter((s) => s.decisive);
  const withLeader = stats.filter((s) => s.leaderT10);
  const seats = stats.flatMap((s) => s.seats.map((seat, i) => ({ s, seat, pid: `ai_${i}` })));
  const holders = seats.filter((x) => x.seat.manhattanTurn != null);
  const firers = seats.filter((x) => x.seat.bombs > 0);
  const reached = stats.filter((s) => s.seats.some((x) => x.manhattanTurn != null));

  console.log(`\nWW2 balance (${MODE}) — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · ${ENDING} · maxTurns ${MAX_TURNS} · map ${MAP_ID}`);
  console.log(
    `Seed "${MASTER_SEED}" · factions ${FACTIONS_ON ? 'ON' : 'OFF'} · stability ${STABILITY ? 'ON' : 'OFF'}`
    + ` · bomb AI ${BOMB_AI ? 'ON (SIM_BOMB_AI=1)' : 'OFF'}`
    + ` · Manhattan ${SCIENCE ? 'on the science line (SIM_SCIENCE=1)' : 'behind Panzer Tactics'}`
    + ` · bomb ${ARSENAL ? 'the atomic arsenal (SIM_ARSENAL=1)' : 'once per game'}`
    + ` · ${elapsed.toFixed(1)}s (${((elapsed / GAMES) * 1000).toFixed(1)}ms/game)\n`,
  );
  console.log(`Avg game length (turns):          ${fixed(avg(stats.map((s) => s.turns)))}`);
  console.log(`Decisive (non-turn-limit) wins:   ${pct(decisive.length, GAMES)}`);
  console.log(`Territory-leader@turn10 win rate: ${pct(withLeader.filter((s) => s.leaderT10 === s.winner).length, withLeader.length)}  (snowball signal; ${pct(1, PLAYERS)} baseline)`);
  console.log(`PP banked at game end:            ${fixed(avg(stats.flatMap((s) => s.ppBanked)))} per seat`);

  if (FACTIONS_ON) {
    console.log(`\n— Per-faction win rate (of the games it played; ${pct(1, PLAYERS)} baseline) —`);
    for (const f of WW2_FACTIONS) {
      const played = stats.filter((s) => s.seats.some((x) => x.label === f.faction_id));
      const won = played.filter((s) => s.winnerLabel === f.faction_id).length;
      if (played.length) console.log(`  ${f.faction_id.padEnd(16)} ${pct(won, played.length).padStart(6)}  (of ${played.length})`);
    }
  }

  if (MODE === 'full') {
    const withAdvancer = stats.filter((s) => s.firstAdvancer);
    const withEraLeader = stats.filter((s) => s.eraLeaderT10);
    console.log(`\n— The climb —`);
    console.log(`Reached final era (any player):   ${pct(stats.filter((s) => s.reachedFinal).length, GAMES)}`);
    console.log(`Avg advances / game:              ${fixed(avg(stats.map((s) => s.advances)), 2)}`);
    console.log(`First-advancer win rate:          ${pct(withAdvancer.filter((s) => s.firstAdvancer === s.winner).length, withAdvancer.length)}`);
    console.log(`Era-leader@turn10 win rate:       ${pct(withEraLeader.filter((s) => s.eraLeaderT10 === s.winner).length, withEraLeader.length)}`);
    console.log(`Avg peak era spread:              ${fixed(avg(stats.map((s) => s.maxEraSpread)), 2)} eras`);
    const entered = seats.filter((x) => x.seat.ww2EnterTurn != null);
    const left = entered.filter((x) => x.seat.ww2LeaveTurn != null);
    console.log(`Seats that reached WW2:           ${pct(entered.length, seats.length)} · on turn ${fixed(avg(entered.map((x) => x.seat.ww2EnterTurn!)))}`);
    console.log(`  ...and left it:                 ${pct(left.length, entered.length)} · after ${fixed(avg(left.map((x) => x.seat.ww2LeaveTurn! - x.seat.ww2EnterTurn!)))} turns in WW2`);
    console.log(`  ...researching Manhattan there: ${pct(entered.filter((x) => x.seat.manhattanTurn != null).length, entered.length)}`);
  }

  console.log(`\n— The Manhattan Project —`);
  console.log(`Games where anyone researched it: ${pct(reached.length, GAMES)} · first on turn ${fixed(avg(reached.map((s) => Math.min(...s.seats.filter((x) => x.manhattanTurn != null).map((x) => x.manhattanTurn!)))))}`);
  console.log(`Seats that researched it:         ${pct(holders.length, seats.length)} · on turn ${fixed(avg(holders.map((x) => x.seat.manhattanTurn!)))} · win ${pct(holders.filter((x) => x.s.winner === x.pid).length, holders.length)} of their games`);
  console.log(`Detonations per game:             ${fixed(avg(stats.map((s) => s.seats.reduce((a, x) => a + x.bombs, 0))), 2)}`);
  console.log(`Holders who fired:                ${pct(holders.filter((x) => x.seat.bombs > 0).length, holders.length)} · first on turn ${fixed(avg(firers.map((x) => x.seat.firstBombTurn!)))}`);
  console.log(`Seats that fired win:             ${pct(firers.filter((x) => x.s.winner === x.pid).length, firers.length)} of their games`);
  console.log(`Detonations walked into:          ${pct(firers.reduce((a, x) => a + x.seat.walkIns, 0), firers.reduce((a, x) => a + x.seat.bombs, 0))}`);
  if (ARSENAL) {
    console.log(`Bombs per firing seat:            ${fixed(avg(firers.map((x) => x.seat.bombs)), 2)} · PP paid per firing seat ${fixed(avg(firers.map((x) => x.seat.bombPP)))}`);
    console.log(`Manhattan bought at half price:   ${pct(holders.filter((x) => x.seat.proliferated).length, holders.length)} of the seats that researched it`);
  }

  // The digest covers every per-game record the tables are built from: two runs
  // of one configuration on one seed print the same eight characters. The
  // arsenal's own fields join it only when the arsenal plays, so a run without
  // it prints the digest it printed before those fields existed.
  const digested = ARSENAL ? stats : stats.map((g) => ({
    ...g,
    seats: g.seats.map((seat) => {
      const plain: Partial<SeatRecord> = { ...seat };
      delete plain.bombPP;
      delete plain.proliferated;
      return plain;
    }),
  }));
  console.log(`\nRun digest: ${hashStringToSeed(JSON.stringify(digested)).toString(16).padStart(8, '0')} (the same on every run of this configuration and seed)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
