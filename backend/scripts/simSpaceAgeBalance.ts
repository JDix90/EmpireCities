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
 * SIM_FACTIONS=1 turns factions ON: each seat gets one of the six Space Age
 * factions round-robin (offset by game index so every faction sees every seat),
 * the AI fires its faction draft ability through the same executor the socket
 * uses, and a per-faction table (win / eliminated / reached-Moon / avg Moon
 * tiles / avg territories) is printed at the end — the faction-balance audit.
 * SIM_FACTION_ABILITIES=0 keeps the passives but silences the AI's ability use,
 * to separate what the passives do from what eager ability spending does.
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
 * selectAiTechResearch / selectAiBuildingPlacement) never fires it, so this sim
 * has to schedule the launch itself, via the same executor, during the DRAFT
 * phase — which is what production does.
 *
 * That socket block USED TO run after `state.phase = 'attack'`, and
 * executeTechAbility refuses launch_space_station during the attack phase, so
 * every AI launch failed silently and bots never reached the Moon. That was
 * fixed in ae02c66 (2026-07-13); the block now precedes the phase transition and
 * `spaceAgeMoonLadderSocket.test.ts` drives a real AI turn to keep it there.
 * SIM_LAUNCH_PHASE=attack still reproduces the old ordering, now as a
 * counterfactual — how much the Moon race is worth — rather than a prod repro.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simSpaceAgeBalance.ts
 *   SIM_GAMES=60 SIM_PLAYERS=4 SIM_DIFFICULTY=expert SIM_MAX_TURNS=80 \
 *     SIM_SEED=borderfall SIM_CSV=/tmp/sim_space_age.csv \
 *     pnpm exec tsx scripts/simSpaceAgeBalance.ts
 *   SIM_LAUNCH_PHASE=attack pnpm exec tsx scripts/simSpaceAgeBalance.ts   # no-Moon counterfactual
 *   SIM_FACTIONS=1 SIM_GAMES=120 SIM_PLAYERS=6 pnpm exec tsx scripts/simSpaceAgeBalance.ts
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
import { executeTechAbility, isGameScopedAbility } from '../src/game-engine/abilities/executeTechAbility';
import { countLunarTerritories } from '../src/game-engine/state/helium3';
import {
  canAiUseDropAssault,
  canAiUseDysonBeam,
  canAiUseOrbitalDrop,
  selectAiDropAssaultTarget,
  selectAiDysonBeamTarget,
  selectAiOrbitalDropTarget,
  shouldAiExportHelium3,
} from '../src/game-engine/ai/aiMoonPowers';
import { resolveDropAssaultsFor } from '../src/game-engine/abilities/dropAssault';
import { HEGEMONY_TURNS } from '../src/game-engine/state/lunarHegemony';
import { TERRITORY_ABILITY_DEFS, isOwnedTerritoryAdjacentToEnemy } from '../src/game-engine/abilities/techAbilities';
import { getPlayerFaction } from '../src/game-engine/eras/factionLineage';
import { SPACE_AGE_FACTIONS } from '../src/game-engine/eras/spaceage';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import {
  connectionRequiresMoonAccess,
  fortifyEndpointsRequireOrbitAccess,
  getOrbitAccessResult,
  syncLaunchPadLanes,
} from '../src/game-engine/state/moonAccess';
import { shouldSpendTechPointsOnAbility } from '../src/game-engine/ai/aiTechBudget';
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
/** When set (1–99), adds threshold victory at that % — mirrors the live orbit-gated create default (60). */
const THRESHOLD = process.env.SIM_THRESHOLD ? Number(process.env.SIM_THRESHOLD) : null;
/** Moon Race Phase 1: lunar Helium-3 income + Lunar Export. */
const MOON_HELIUM3 = process.env.SIM_MOON_HELIUM3 === '1';
/**
 * Moon Race Phase 2a: the gated tier — dyson_beam behind a lunar foothold plus
 * 6 He-3, and Orbital Drop. Implies Phase 1, exactly as the engine does: the
 * powers are priced in He-3, so without the economy this would delete
 * dyson_beam rather than gate it (moonPowers.ts areMoonPowersEnabled).
 */
const MOON_TIER = process.env.SIM_MOON_TIER === '1';
/**
 * Phase 2b's declaration, on by default with the tier. `SIM_DROP_ASSAULT=0`
 * suppresses it so a Phase 2b run has a matched 2a-only control ON THE SAME
 * COMMIT — both phases ship behind one flag, so there is no setting that
 * separates them in a real game.
 */
const DROP_ASSAULT = process.env.SIM_DROP_ASSAULT !== '0';
/**
 * Moon Race Phase 3: the Lunar Hegemony victory, its clock, and the contest
 * rule. Independent of Phases 1 and 2 — it prices nothing in He-3 — so it can
 * be measured alone or stacked on the tier.
 */
const MOON_HEGEMONY = process.env.SIM_MOON_HEGEMONY === '1';
/** §9's clock-length sweep (4-8). Unset leaves the engine default of 6. */
const HEGEMONY_TURNS_OVERRIDE = process.env.SIM_HEGEMONY_TURNS
  ? Number(process.env.SIM_HEGEMONY_TURNS) : null;
/** Factions ON: seats get Space Age factions round-robin (offset by game index) and the per-faction table prints. */
const FACTIONS = process.env.SIM_FACTIONS === '1';
const FACTION_ORDER = SPACE_AGE_FACTIONS.map((f) => f.faction_id);
/** SIM_FACTION_ABILITIES=0 keeps passives but stops the AI firing draft abilities — isolates ability vs passive impact. */
const FACTION_ABILITIES = process.env.SIM_FACTION_ABILITIES !== '0';

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
    factions_enabled: FACTIONS, // default off: no Lunar Pioneers shortcut — everyone must climb the ladder
    naval_enabled: false, // determinism: no fleet RNG (sea-lane land attacks still allowed)
    events_enabled: false, // determinism: no event deck
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    era_advancement_enabled: false, // space_age is the start AND terminal era here
    space_age_frontiers_enabled: FRONTIERS, // seed the 8 authored frontiers (full 63-tile board)
    space_age_moon_helium3_enabled: MOON_HELIUM3 || MOON_TIER,
    space_age_moon_gated_tier_enabled: MOON_TIER,
    space_age_moon_hegemony_enabled: MOON_HEGEMONY,
    space_age_hegemony_turns: HEGEMONY_TURNS_OVERRIDE ?? undefined,
    // Phase 3 adds a third decisive route, mirroring applyOrbitGatedVictoryDefaults.
    allowed_victory_conditions: [
      'domination',
      ...(THRESHOLD != null ? ['threshold' as const] : []),
      ...(MOON_HEGEMONY ? ['lunar_hegemony' as const] : []),
    ],
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
  // Orbit parity with the socket fortify handler: crossing between worlds
  // requires access, whether or not the named endpoints are the lane itself.
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
  /** Moon Race Phase 1: He-3 converted to tech points across the game. */
  helium3Exported: number;
  /** Phase 2a: uses of each Moon-gated power across the game. */
  dysonBeams: number;
  orbitalDrops: number;
  /** Phase 2b: drops declared, and how they ended. */
  dropAssaultsDeclared: number;
  dropAssaultsLanded: number;
  dropAssaultsCaptured: number;
  dropAssaultsCancelled: number;
  dropAssaultsCancelledSelfTook: number;
  dropAssaultsCancelledNoFoothold: number;
  dropAssaultsCancelledOther: number;
  /** Most lunar tiles this player held at once — the §4.5 usage denominator. */
  peakMoonTiles: number;
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

  // Phase 2b: a drop declared last turn lands as this turn begins, before the
  // bot plans — the socket lands it in the same place, right after
  // advanceToNextPlayer, so the plan is made against the post-landing board.
  for (const res of resolveDropAssaultsFor(state, map, pid, { dieRoll })) {
    if (res.status === 'cancelled') {
      ps.dropAssaultsCancelled++;
      if (res.cancelCode === 'already_held') ps.dropAssaultsCancelledSelfTook++;
      if (res.cancelCode === 'lost_foothold') ps.dropAssaultsCancelledNoFoothold++;
      if (res.cancelCode !== 'lost_foothold' && res.cancelCode !== 'already_held') {
        ps.dropAssaultsCancelledOther++;
      }
    }
    else {
      ps.dropAssaultsLanded++;
      if (res.captured) ps.dropAssaultsCaptured++;
    }
  }

  state.phase = 'draft';
  const plan = computeAiTurn(state, map, difficulty); // planned before economy, like the socket

  // Economy first (matches processAiTurn): build, then research.
  const build = selectAiBuildingPlacement(state, map, pid, difficulty);
  if (build) {
    applyBuild(state, pid, build.territoryId, build.buildingType); // validates internally (returns void)
    if (build.buildingType === 'launch_pad') syncLaunchPadLanes(map, state); // the pad's orbit lane, as the socket does
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

  // Peak lunar holding, sampled every turn: the §4.5 gate is "usage in games
  // where someone held three Moon tiles", and a holding that is taken and lost
  // again would be invisible in an end-of-game reading.
  ps.peakMoonTiles = Math.max(ps.peakMoonTiles, countLunarTerritories(state, pid));

  // Orbital Drop (Phase 2a) — before the export, exactly as the socket orders
  // them: a bot that exported first would never hold the 8 He-3 it costs.
  if (canAiUseOrbitalDrop(state, pid)) {
    const dropTarget = selectAiOrbitalDropTarget(state, map, pid);
    if (dropTarget) {
      const res = executeTechAbility({
        state, map, playerId: pid, abilityId: 'orbital_drop', territoryId: dropTarget,
      });
      if (res.success) {
        ps.orbitalDrops++;
        player.ability_uses = { ...(player.ability_uses ?? {}), orbital_drop: 1 };
      }
    }
  }

  // Drop Assault declaration (Phase 2b), before the export for the same reason
  // the drop is: a bot that exported first would never hold the 10 He-3.
  if (DROP_ASSAULT && canAiUseDropAssault(state, pid)) {
    const assaultTarget = selectAiDropAssaultTarget(state, pid);
    if (assaultTarget) {
      const res = executeTechAbility({
        state, map, playerId: pid, abilityId: 'drop_assault', territoryId: assaultTarget,
      });
      if (res.success) {
        ps.dropAssaultsDeclared++;
        player.ability_uses = { ...(player.ability_uses ?? {}), drop_assault: 1 };
      }
    }
  }

  // Lunar Export — mirrors the gameSocket AI-parity block: convert only on a
  // full load so the one use per turn is not spent on a single point, and under
  // Phase 2 only the surplus over what the powers are saving for.
  if (shouldAiExportHelium3(state, map, pid)) {
    const res = executeTechAbility({ state, map, playerId: pid, abilityId: 'lunar_export' });
    if (res.success) ps.helium3Exported += res.amount ?? 0;
  }

  useFactionDraftAbility(state, map, pid, difficulty);
  applyDraft(state, pid, plan);

  state.phase = 'attack';
  if (LAUNCH_PHASE === 'attack') tryLaunch(); // production ordering repro

  // Dyson Beam (Phase 2a) — fired before the attack loop, as the socket does,
  // so the softened stack is one the planned attacks can actually take.
  if (canAiUseDysonBeam(state, pid)) {
    const beamTarget = selectAiDysonBeamTarget(state, map, pid);
    if (beamTarget) {
      const res = executeTechAbility({
        state, map, playerId: pid, abilityId: 'dyson_beam', territoryId: beamTarget,
      });
      if (res.success) {
        ps.dysonBeams++;
        player.ability_uses = { ...(player.ability_uses ?? {}), dyson_beam: 1 };
      }
    }
  }

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

/**
 * AI parity for draft-phase faction abilities — the same rule as the socket
 * block in gameSocket.processAiTurn (any ownPlacement / draftReinforcements
 * def, target = best-garrisoned owned tile passing the def's target filters),
 * including the tech-point budget guard that keeps back the bot's next
 * research. Keep the two in sync.
 */
function useFactionDraftAbility(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
): void {
  if (!state.settings.factions_enabled || !FACTION_ABILITIES) return;
  const player = state.players.find((p) => p.player_id === pid);
  if (!player?.faction_id) return;
  const abilityId = getPlayerFaction(state, player)?.ability_id;
  const def = abilityId ? TERRITORY_ABILITY_DEFS[abilityId] : undefined;
  if (!abilityId || !def || def.phase !== 'draft' || (!def.ownPlacement && !def.draftReinforcements)) return;
  const gameScoped = isGameScopedAbility(abilityId);
  const alreadyUsed = gameScoped
    ? (player.used_game_abilities ?? []).includes(abilityId)
    : !!(player.ability_uses ?? {})[abilityId];
  if (alreadyUsed) return;
  if (!shouldSpendTechPointsOnAbility(state, pid, difficulty, def.techCost ?? 0)) return;
  const op = def.ownPlacement;
  const target = op
    ? Object.values(state.territories)
        .filter((t) => t.owner_id === pid
          && (!op.requiresMoon || t.world_id === 'moon' || t.globe_id === 'moon')
          && (!op.requiresProductionBuilding || (t.buildings ?? []).some((b) => b.startsWith('production')))
          && (!op.requiresEnemyAdjacent || isOwnedTerritoryAdjacentToEnemy(state, map, pid, t.territory_id)))
        .sort((a, b) => b.unit_count - a.unit_count)[0]
    : undefined;
  if (op && !target) return;
  const res = executeTechAbility({ state, map, playerId: pid, abilityId, territoryId: target?.territory_id });
  if (res.success && !gameScoped) {
    player.ability_uses = { ...(player.ability_uses ?? {}), [abilityId]: 1 };
  }
}

interface SeatStat {
  faction: string | null;
  won: boolean;
  eliminated: boolean;
  reachedMoon: boolean; // captured at least one Moon tile at some point
  moonTilesEnd: number;
  territoriesEnd: number;
}

interface GameStat {
  game: number;
  seats: SeatStat[];
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
  /** Two or more players held Moon tiles at the same time at some point. */
  everSharedMoon: boolean;
  helium3Exported: number;
  /** Phase 2a usage, and whether anyone ever held enough Moon to unlock it. */
  dysonBeams: number;
  orbitalDrops: number;
  dropAssaultsDeclared: number;
  dropAssaultsLanded: number;
  dropAssaultsCaptured: number;
  dropAssaultsCancelled: number;
  anyThreeMoonTiles: boolean;
  /** The player who peaked highest on the Moon, and whether they won. */
  moonPeakLeaderWon: boolean;
  /** Phase 3: Hegemony clocks started, and how many of them were broken. */
  hegemonyClocksStarted: number;
  hegemonyClocksReset: number;
  /** Longest a clock ever ran in this game, in own-turns. */
  hegemonyPeakTurns: number;
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

function runGame(baseMap: GameMap, moonTileIds: string[], frontierIds: string[], gameIndex: number): GameStat {
  // Launch Pad lanes are written into the game's map copy, so each game needs its own.
  const map = JSON.parse(JSON.stringify(baseMap)) as GameMap;
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
    // Offset by game index so each faction rotates through every seat / turn order.
    ...(FACTIONS ? { faction_id: FACTION_ORDER[(i + gameIndex) % FACTION_ORDER.length] } : {}),
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
    helium3Exported: 0,
    dysonBeams: 0,
    orbitalDrops: 0,
    dropAssaultsDeclared: 0,
    dropAssaultsLanded: 0,
    dropAssaultsCaptured: 0,
    dropAssaultsCancelled: 0,
    dropAssaultsCancelledSelfTook: 0,
    dropAssaultsCancelledNoFoothold: 0,
    dropAssaultsCancelledOther: 0,
    peakMoonTiles: 0,
  }]));

  let t10Leader: string | null = null;
  let t10AnchorLeader: string | null = null;
  let t10Captured = false;
  let lunarRegionHolder: string | null = null;
  let lunarRegionTurn: number | null = null;
  /**
   * Phase 1's gate asks whether two players are ever on the Moon at once —
   * the difference between a shared frontier and a race one player wins. It
   * has to be sampled during play, not read at the end, because a contested
   * Moon usually resolves before the final turn.
   */
  let everSharedMoon = false;

  /**
   * Phase 3's gate is about whether the clock is CONTESTED, so starts and
   * breaks are counted as they happen. Read off the state around each turn
   * boundary rather than returned from the engine, because the tick lives
   * inside `advanceToNextPlayer` where the sim has no return value to read.
   */
  let hegemonyClocksStarted = 0;
  let hegemonyClocksReset = 0;
  let hegemonyPeakTurns = 0;

  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      playAiTurn(state, map, sims.get(player.player_id)!, DIFFICULTY, dieRoll);
    }
    const clockBefore = state.lunar_hegemony
      ? { ...state.lunar_hegemony } : null;
    advanceToNextPlayer(state, map);
    const clockAfter = state.lunar_hegemony;
    if (!clockBefore && clockAfter) hegemonyClocksStarted++;
    if (clockBefore && (!clockAfter
      || clockAfter.owner_id !== clockBefore.owner_id
      || clockAfter.turns_held < clockBefore.turns_held)) {
      hegemonyClocksReset++;
      // A takeover is both: the old clock broke and a new one started.
      if (clockAfter && clockAfter.owner_id !== clockBefore.owner_id) hegemonyClocksStarted++;
    }
    if (clockAfter) hegemonyPeakTurns = Math.max(hegemonyPeakTurns, clockAfter.turns_held);

    if (!t10Captured && state.turn_number >= 10) {
      t10Captured = true;
      t10Leader = territoryLeader(state);
      t10AnchorLeader = strictMaxKey(anchorCounts(state));
    }

    if (!everSharedMoon) {
      const holders = new Set(
        moonTileIds.map((tid) => state.territories[tid]?.owner_id).filter(Boolean),
      );
      if (holders.size >= 2) everSharedMoon = true;
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
    seats: players.map((p) => ({
      faction: p.faction_id ?? null,
      won: winner === p.player_id,
      eliminated: !!state.players.find((sp) => sp.player_id === p.player_id)?.is_eliminated,
      reachedMoon: sims.get(p.player_id)!.firstMoonCaptureTurn != null,
      moonTilesEnd: moonEnd.get(p.player_id) ?? 0,
      territoriesEnd: Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length,
    })),
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
    everSharedMoon,
    helium3Exported: simList.reduce((a, s) => a + s.helium3Exported, 0),
    dysonBeams: simList.reduce((a, s) => a + s.dysonBeams, 0),
    orbitalDrops: simList.reduce((a, s) => a + s.orbitalDrops, 0),
    dropAssaultsDeclared: simList.reduce((a, s) => a + s.dropAssaultsDeclared, 0),
    dropAssaultsLanded: simList.reduce((a, s) => a + s.dropAssaultsLanded, 0),
    dropAssaultsCaptured: simList.reduce((a, s) => a + s.dropAssaultsCaptured, 0),
    dropAssaultsCancelled: simList.reduce((a, s) => a + s.dropAssaultsCancelled, 0),
    dropAssaultsCancelledSelfTook: simList.reduce((a, s) => a + s.dropAssaultsCancelledSelfTook, 0),
    dropAssaultsCancelledNoFoothold: simList.reduce((a, s) => a + s.dropAssaultsCancelledNoFoothold, 0),
    dropAssaultsCancelledOther: simList.reduce((a, s) => a + s.dropAssaultsCancelledOther, 0),
    // The §4.5 denominator: a tier nobody could reach tells us nothing about
    // whether the tier is used, so usage is scored over these games only.
    anyThreeMoonTiles: simList.some((s) => s.peakMoonTiles >= 3),
    hegemonyClocksStarted,
    hegemonyClocksReset,
    hegemonyPeakTurns,
    moonPeakLeaderWon: (() => {
      const peak = new Map(simList.map((s) => [s.pid, s.peakMoonTiles]));
      const leader = strictMaxKey(new Map([...peak].filter(([, v]) => v > 0)));
      return !!leader && leader === winner;
    })(),
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
  console.log(`\nSpace Age balance — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · maxTurns ${MAX_TURNS}${THRESHOLD != null ? ` · threshold ${THRESHOLD}%` : ''} · launchPhase=${LAUNCH_PHASE} · frontiers=${FRONTIERS ? 'on' : 'off'}`);
  console.log(`Map: ${map.territories.length} territories in file · ${inPlay} in play (${baseInPlay - moonTileIds.length} Earth${FRONTIERS ? ` + ${frontierCount} frontier` : ''} + ${moonTileIds.length} neutral Moon${FRONTIERS ? '' : '; era-locked frontiers never spawn'})`);
  console.log(`Seed "${MASTER_SEED}" · ${elapsedS.toFixed(1)}s (${((elapsedS / GAMES) * 1000).toFixed(1)}ms/game)`);
  console.log(`Ruleset: economy+tech+stability ON · factions ${FACTIONS ? `ON (round-robin Space Age factions; AI abilities ${FACTION_ABILITIES ? 'on' : 'off'})` : 'OFF'} · naval/events/era-advancement OFF · domination(+last_standing)\n`);

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

  // Printed unconditionally: "is the Moon shared or swept?" is a property of
  // the board, so a He-3 run needs a He-3-off control for the same number.
  console.log(`Games with 2+ players on the Moon at once:   ${pct(stats.filter((s) => s.everSharedMoon).length, GAMES)}`);
  // Also printed unconditionally: it is the §4.5 denominator, so a control run
  // has to report the same figure or the usage percentages cannot be compared.
  const reachedTier = stats.filter((s) => s.anyThreeMoonTiles);
  console.log(`Games where a player held 3+ Moon tiles:     ${pct(reachedTier.length, GAMES)}`);
  console.log(`Peak-Moon leader won:                        ${pct(stats.filter((s) => s.moonPeakLeaderWon).length, GAMES)}  (baseline ${pct(1, PLAYERS)})`);
  if (MOON_HELIUM3 || MOON_TIER) {
    console.log(`\n— Helium-3 economy (Moon Race, Phase 1) —`);
    console.log(`Avg He-3 exported to tech points per game:   ${fmt(avg(stats.map((s) => s.helium3Exported)), 1)}`);
    console.log(`Games where any He-3 was exported:           ${pct(stats.filter((s) => s.helium3Exported > 0).length, GAMES)}`);
  }
  if (MOON_TIER) {
    console.log(`\n— The gated tier (Moon Race, Phase 2a) —`);
    // Scored over games where the tier was reachable at all: a power nobody
    // could unlock says nothing about whether the power is worth firing.
    console.log(`Dyson Beam fired (of reachable games):       ${pct(reachedTier.filter((s) => s.dysonBeams > 0).length, reachedTier.length)}  (n=${reachedTier.length})`);
    console.log(`Orbital Drop used (of reachable games):      ${pct(reachedTier.filter((s) => s.orbitalDrops > 0).length, reachedTier.length)}`);
    console.log(`Avg beams per game:                          ${fmt(avg(stats.map((s) => s.dysonBeams)), 2)} · avg drops ${fmt(avg(stats.map((s) => s.orbitalDrops)), 2)}`);
    const withAssault = stats.filter((s) => s.dropAssaultsDeclared > 0);
    const declared = stats.reduce((a, s) => a + s.dropAssaultsDeclared, 0);
    const landed = stats.reduce((a, s) => a + s.dropAssaultsLanded, 0);
    const captured = stats.reduce((a, s) => a + s.dropAssaultsCaptured, 0);
    console.log(`Drop Assault declared (of reachable games): ${pct(withAssault.length, reachedTier.length)}`);
    console.log(`Avg declared per game:                       ${fmt(avg(stats.map((s) => s.dropAssaultsDeclared)), 2)}`);
    // Cancelled-vs-landed is the telegraph working: a drop cancelled at landing
    // is one whose declarer was thrown off the Moon in the round it was in flight.
    console.log(`Of those declared: landed ${pct(landed, declared)} · cancelled ${pct(stats.reduce((a, s) => a + s.dropAssaultsCancelled, 0), declared)}`);
    console.log(`Of those landed: took the tile ${pct(captured, landed)}`);
    console.log(`Cancelled because the declarer took it anyway: ${stats.reduce((a, s) => a + s.dropAssaultsCancelledSelfTook, 0)} · lost the Moon: ${stats.reduce((a, s) => a + s.dropAssaultsCancelledNoFoothold, 0)} · other: ${stats.reduce((a, s) => a + s.dropAssaultsCancelledOther, 0)}`);
  }

  if (MOON_HEGEMONY) {
    const started = stats.reduce((a, s) => a + s.hegemonyClocksStarted, 0);
    const reset = stats.reduce((a, s) => a + s.hegemonyClocksReset, 0);
    const won = stats.filter((s) => s.victory === 'lunar_hegemony').length;
    console.log(`\n— Lunar Hegemony (Moon Race, Phase 3) —`);
    console.log(`Games won by Hegemony:                       ${pct(won, GAMES)}  (gate: 10-35%)`);
    console.log(`Games where a clock started:                 ${pct(stats.filter((s) => s.hegemonyClocksStarted > 0).length, GAMES)}`);
    console.log(`Clocks started / broken:                     ${started} / ${reset}  (gate: >=50% broken)`);
    console.log(`Avg longest clock per game (of ${HEGEMONY_TURNS_OVERRIDE ?? HEGEMONY_TURNS}):        ${fmt(avg(stats.map((s) => s.hegemonyPeakTurns)), 2)}`);
  }

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

  if (FACTIONS) {
    console.log(`\n— Faction balance (baseline win ${pct(1, PLAYERS)}) —`);
    console.log('faction              games   win%   elim%  moon%  avgMoon  avgTerr');
    for (const fid of FACTION_ORDER) {
      const seats = stats.flatMap((s) => s.seats.filter((seat) => seat.faction === fid));
      if (!seats.length) continue;
      const name = SPACE_AGE_FACTIONS.find((f) => f.faction_id === fid)?.name ?? fid;
      console.log([
        name.padEnd(20),
        String(seats.length).padStart(5),
        pct(seats.filter((x) => x.won).length, seats.length).padStart(7),
        pct(seats.filter((x) => x.eliminated).length, seats.length).padStart(7),
        pct(seats.filter((x) => x.reachedMoon).length, seats.length).padStart(6),
        fmt(avg(seats.map((x) => x.moonTilesEnd)), 2).padStart(8),
        fmt(avg(seats.map((x) => x.territoriesEnd)), 1).padStart(8),
      ].join(' '));
    }
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
