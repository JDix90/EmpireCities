import { v4 as uuidv4 } from 'uuid';
import { randomBytes, randomInt } from 'crypto';
import type {
  GameState, PlayerState, TerritoryState, TerritoryCard,
  GameMap, GameSettings, EraId, DiplomacyEntry, WinProbabilitySnapshot,
  VictoryConditionKey, GalaxySchismMode,
} from '../../types';
import { getEraFactions } from '../eras';
import { calculateReinforcements, getCardSetBonus } from '../combat/combatResolver';
import { getAllowedVictoryConditions, normalizeGameSettings } from './gameSettings';
import { collectProduction } from './economyManager';
import { applyTechPointIncome, getPlayerReinforceBonus } from './techManager';
import { applyHelium3Income } from './helium3';
import { syncLaunchPadLanes } from './moonAccess';
import { applyMoonTribute, clearTributeReceived } from './moonTribute';
import { hasCompletedHegemony, tickLunarHegemony } from './lunarHegemony';
import { getEraDeck, drawRandomCard, applyEventEffect, tickTemporaryModifiers } from '../events/eventCardManager';
import { getActiveSeasonalDeck } from '../events/seasonalDecks';
import { initializeNavalUnits, collectFleetIncome } from './navalManager';
import { initializeStability, applyStabilityTick, getDeployCap } from './stabilityManager';
import { getWonderReinforceBonus, applyWonderProductionIncome } from './wonderManager';
import {
  assignCapitals,
  dealSecretMissions,
  isMissionComplete,
} from '../victory/missions';
import { inferWorldId } from '@borderfall/shared';
import {
  getOrbitAccessResult,
  offworldTerritoryIdsForInitialNeutral,
  selectionExemptTerritoryIds,
  territoryRequiresOrbitAccessForClaim,
  tickLaneBlockades,
} from './moonAccess';
import { buildWorldModifierSnapshot } from './worldModifiers';
import { hasLaneSovereignty, tickLaneSovereignty } from '../victory/laneSovereignty';
import { checkTeamVictory } from '../victory/teamVictory';
import { isTeamGame, regionBonusHolder } from './teams';
import { dropSecretMissions, galaxyTeamsFor, seatTeamsApart } from './galaxyTeams';
import { applyLaneClosure, applyLaneSurge, laneSurgeHasGap, tickLaneWeather } from './laneWeather';
import { colonyGarrison, colonyLayout, resolveGalaxyHomeWorlds, syncGalaxyModeLanes } from './galaxyModes';
import {
  dealSchismFactions,
  floorSchismDraft,
  normalizeHouseRelations,
  openConcord,
  schismHouseTiles,
  schismLayout,
  schismOpeningBonus,
  schismUnclaimedTiles,
} from './galaxySchism';
import { arriveConvoys } from './transit';
import {
  applyStormAttrition,
  applyCradleMuster,
  buildWorldRuleSnapshot,
  vaultRegionGarrisons,
  worldDeployCapBonus,
} from './worldRules';
import { buildAscensionSpineFromEra, getMaxEraIndex, getSpineById } from '../eraAdvancement/spines';
import { territoryUnlockEra, seedsFullBoardAtStart, seedStandaloneFrontierTerritories } from '../eraAdvancement/territoryUnlock';
import { ensureEraKeyedEcho } from '../eraAdvancement/techEcho';
import { migrateAdvancedFactions } from '../eras/factionLineage';
import { eraModifiersFor } from './eraModifiers';

/** True when first-player seat should be randomized (normal multiplayer/solo/ranked). */
export function shouldRandomizeStartingPlayer(settings: GameSettings): boolean {
  if (settings.tutorial) return false;
  if (settings.is_campaign) return false;
  if (settings.daily_challenge_date) return false;
  if (settings.daily_challenge_spec && typeof settings.daily_challenge_spec === 'object') return false;
  return true;
}

type StartingPlayerRng = (min: number, max: number) => number;

/** Seat index for the first turn; 0 when randomization is disabled. */
export function pickStartingPlayerIndex(
  playerCount: number,
  settings: GameSettings,
  rng: StartingPlayerRng = randomInt,
): number {
  if (playerCount <= 0) return 0;
  if (!shouldRandomizeStartingPlayer(settings)) return 0;
  return rng(0, playerCount);
}

export interface InitializeGameStateOptions {
  /** Test/dev override — skips random draw when set. */
  forceStartingPlayerIndex?: number;
  /**
   * Test/sim override for a Schism deal (galaxySchism.ts): which half of its
   * world each house opens on, by player id. Skips the random draw for any
   * world whose first-seated house is listed.
   */
  forceSchismHalves?: Readonly<Record<string, 0 | 1>>;
}

/** Resolved starting seat for draft/territory-select transitions (persists after init). */
export function getStartingPlayerIndex(state: GameState): number {
  return state.starting_player_index ?? 0;
}

/**
 * True when handing the turn from seat `from` to seat `to` (forward in seat
 * order, wrapping) passes over or lands on `seat`. A hand-off that never moves
 * (`to === from`, one player left) is a full lap and crosses every seat.
 */
export function handOffCrossesSeat(from: number, to: number, seat: number, total: number): boolean {
  if (total <= 0) return false;
  const lap = (n: number) => (((n % total) + total) % total) || total;
  return lap(seat - from) <= lap(to - from);
}

/**
 * One production + tech income tick for every player at game start
 * (economy+tech bootstrap). Both helpers credit the player internally
 * (special_resource / tech_points), mirroring the per-turn tick in
 * advanceToNextPlayer — adding their return values again double-counts.
 */
export function applyOpeningEconomyTick(state: GameState): void {
  for (const player of state.players) {
    if (state.settings.economy_enabled) {
      collectProduction(state, player.player_id);
    }
    if (state.settings.tech_trees_enabled) {
      applyTechPointIncome(state, player.player_id);
    }
    // Lunar income is gated on the setting, not on tech_trees_enabled: the
    // Lunar Pioneers reach the Moon without researching anything.
    applyHelium3Income(state, player.player_id);
  }
}

/**
 * Economy without Technology Trees gets no opening tick (above: it needs
 * both), so its first player began turn one with nothing to spend, while
 * every later seat is paid as its turn begins (passTurn). This pays that
 * first turn-start production. Tutorials, campaign missions and daily
 * challenges, the starts with a fixed first seat (shouldRandomizeStartingPlayer),
 * are authored around their opening resources and keep them.
 */
function payFirstTurnProduction(state: GameState): void {
  const { economy_enabled, tech_trees_enabled } = state.settings;
  if (!economy_enabled || tech_trees_enabled || !shouldRandomizeStartingPlayer(state.settings)) return;
  const first = state.players[state.current_player_index];
  if (first) collectProduction(state, first.player_id);
}

/**
 * Initialize a brand-new GameState from a map and player list.
 */
export function initializeGameState(
  gameId: string,
  era: EraId,
  map: GameMap,
  players: Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>[],
  settings: GameSettings,
  initOptions?: InitializeGameStateOptions,
): GameState {
  const settingsNorm = normalizeGameSettings(settings);
  // Galaxy per-world identity: snapshot the map's per-world modifiers onto settings
  // so per-turn calc sites (which only have `state`) can apply them by world_id.
  if (settingsNorm.world_modifiers_enabled !== false) {
    const worldMods = buildWorldModifierSnapshot(map, true);
    if (worldMods) settingsNorm.world_modifiers = worldMods;
  }
  // Galaxy worlds as characters: the map's per-world RULES, same discipline.
  if (settingsNorm.world_rules_enabled !== false) {
    const worldRules = buildWorldRuleSnapshot(map, true, settingsNorm.world_rules_disabled ?? []);
    if (worldRules) settingsNorm.world_rules = worldRules;
  }
  const territories: Record<string, TerritoryState> = {};

  // Build territory state — all unowned initially. Mirror the static
  // `region_id` from map data into the runtime state so per-region event
  // effects don't have to drag the heavy map document through every layer.
  // Era Advancement territory growth: hold back territories tagged for a later
  // era (`unlock_era_index > 0`); they're added as neutral frontiers when the
  // global era floor reaches them (see eraAdvancement/territoryUnlock.ts).
  for (const t of map.territories) {
    if (territoryUnlockEra(t) > 0) continue;
    territories[t.territory_id] = {
      territory_id: t.territory_id,
      owner_id: null,
      unit_count: 0,
      unit_type: 'infantry',
      world_id: inferWorldId(t),
      region_id: t.region_id,
    };
  }

  // Schism (five to eight Galactic Age seats): a split world's faction goes to
  // two seats instead, every world's at eight (state/galaxySchism.ts).
  const schismDealt = settingsNorm.factions_enabled && dealSchismFactions(era, map, players);

  // Assign factions to players (unique picks, resolve conflicts with dice roll) when enabled
  if (settingsNorm.factions_enabled && !schismDealt) {
    const eraFactions = getEraFactions(era);
    // Map: faction_id -> array of player indices who want it
    const factionRequests: Record<string, number[]> = {};
    const unassignedPlayers: number[] = [];
    players.forEach((p, idx) => {
      if (p.faction_id) {
        if (!factionRequests[p.faction_id]) factionRequests[p.faction_id] = [];
        factionRequests[p.faction_id].push(idx);
      } else {
        unassignedPlayers.push(idx);
      }
    });

    // Track which factions are already assigned
    const assignedFactions = new Set<string>();
    // Resolve conflicts: if >1 player wants a faction, pick one at random
    Object.entries(factionRequests).forEach(([factionId, indices]) => {
      if (indices.length === 1) {
        players[indices[0]].faction_id = factionId;
        assignedFactions.add(factionId);
      } else {
        // CSPRNG tie-break — Math.random would be deterministic across the
        // V8 instance and could be predicted by colluding observers.
        const winnerIdx = indices[randomInt(0, indices.length)];
        players[winnerIdx].faction_id = factionId;
        assignedFactions.add(factionId);
        indices.forEach((idx) => {
          if (idx !== winnerIdx) unassignedPlayers.push(idx);
        });
      }
    });

    const availableFactions = eraFactions.map(f => f.faction_id).filter(f => !assignedFactions.has(f));
    // Fisher–Yates with a CSPRNG so the faction order cannot be predicted.
    for (let i = availableFactions.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [availableFactions[i], availableFactions[j]] = [availableFactions[j], availableFactions[i]];
    }
    unassignedPlayers.forEach((idx, i) => {
      players[idx].faction_id = availableFactions[i] ?? null;
      if (availableFactions[i]) assignedFactions.add(availableFactions[i]);
    });
  }

  // Galactic Age team boards (state/galaxyTeams.ts): Allied houses at five to
  // eight seats, 2v2 at four. Dealt once the factions are, and the seats
  // reordered so allies never play back to back, before anything below reads a
  // seat.
  const teamsDealt = settingsNorm.factions_enabled && !settingsNorm.territory_selection
    ? galaxyTeamsFor(era, map, players, settingsNorm)
    : null;
  const teams = teamsDealt ? seatTeamsApart(players, teamsDealt) : null;
  // A secret mission is a win of one's own, and could name an ally to
  // eliminate: a team game plays without them.
  if (teams) dropSecretMissions(settingsNorm);

  // Galactic Age home worlds: each seat's faction world, when this game deals
  // them (state/galaxyModes.ts). With fewer than four seats the worlds nobody
  // calls home start neutral as colonies — the Colonies board mode.
  const galaxyHomeWorlds = settingsNorm.factions_enabled && !settingsNorm.territory_selection
    ? resolveGalaxyHomeWorlds(era, map, players)
    : null;
  const colonies = galaxyHomeWorlds ? colonyLayout(map, galaxyHomeWorlds) : null;
  // Five to eight seats: two houses to a split world, each on half of it.
  const schism = schismDealt && !settingsNorm.territory_selection
    ? schismLayout(era, map, players, normalizeHouseRelations(settingsNorm.galaxy_house_relations), {
      forceHalves: initOptions?.forceSchismHalves,
    })
    : null;
  const galaxyMode = colonies ?? schism;

  // Worlds explicitly flagged `initial_neutral_garrison: true` — and Space Age's
  // legacy moon — start NEUTRAL with a small garrison instead of being distributed.
  // For Space Age this preserves the original "tech up to claim the moon" race;
  // even Lunar Pioneers must conquer the Moon (their Earth home is Oceania; their
  // advantage is turn-1 orbit access via `space_station_launched: true` plus the
  // `offworld_defense_bonus` dice on any Moon tile they hold).
  // Galaxy era worlds intentionally do NOT set this flag so factions spawn on
  // their lore home; the orbit-access gate then forces hyperspace tech before
  // factions can engage across worlds.
  const lunarTerritoryIds = offworldTerritoryIdsForInitialNeutral(map);
  // Galaxy worlds as characters: a vault world's prize region (the Nexus Gate
  // Ring) starts neutral with its authored garrison, so its home faction holds
  // "all but the ring" and must take it like everyone else. This is the board's
  // starting layout, so it holds even with `world_rules_enabled` off: that kill
  // switch turns off what the Vault DOES (tech income, the Emergency Seal, AI
  // weighting), but handing the Custodians the ring at start broke the era's
  // balance (Nexus ~41% win rate in the sim).
  const vaultGarrisons = vaultRegionGarrisons(map);
  for (const tid of vaultGarrisons.keys()) lunarTerritoryIds.add(tid);
  // Colonies: every tile of a world no player calls home starts neutral too.
  const colonyTileIds = new Set<string>();
  if (colonies) {
    const colonyWorlds = new Set(colonies.neutral_worlds);
    for (const t of map.territories) {
      if (t.world_id && colonyWorlds.has(t.world_id)) colonyTileIds.add(t.territory_id);
    }
    for (const tid of colonyTileIds) lunarTerritoryIds.add(tid);
  }
  // Partial Schism: the half of a world its lone house did not open on starts
  // neutral too, with the garrison the board records (galaxySchism.ts).
  const unclaimedTileIds = new Set(schism?.unclaimed_garrison ? schismUnclaimedTiles(schism) : []);
  for (const tid of unclaimedTileIds) lunarTerritoryIds.add(tid);
  // Landing zones (tiles on an orbit lane — where the race arrives) hold a
  // beachhead garrison; the interior is tougher, so the first player to gain
  // orbit access establishes a foothold but can't sweep the whole world in one
  // push — a second lander at another gateway can still contest it.
  const NEUTRAL_OFFWORLD_LANDING_GARRISON = 4;
  const NEUTRAL_OFFWORLD_INTERIOR_GARRISON = 6;
  const orbitTouched = new Set<string>();
  for (const c of map.connections) {
    if (c.type === 'orbit') {
      orbitTouched.add(c.from);
      orbitTouched.add(c.to);
    }
  }
  // A Vault region keeps its authored garrison on a colony world too.
  const unclaimedGarrison = schism?.unclaimed_garrison;
  const neutralOffworldGarrison = (tid: string): number =>
    vaultGarrisons.get(tid)
      ?? (colonyTileIds.has(tid) ? colonyGarrison(orbitTouched.has(tid)) : undefined)
      ?? (unclaimedGarrison && unclaimedTileIds.has(tid)
        ? (orbitTouched.has(tid) ? unclaimedGarrison.gateway : unclaimedGarrison.interior)
        : undefined)
      ?? (orbitTouched.has(tid) ? NEUTRAL_OFFWORLD_LANDING_GARRISON : NEUTRAL_OFFWORLD_INTERIOR_GARRISON);

  // Build a map view that excludes neutral-garrison territories AND any orbit/land
  // connections touching them, so geographic distribution never seeds or grows
  // into them through Earth-side launch bases. It must also exclude territories
  // held back by `unlock_era_index` (they have no entry in `territories` yet):
  // the faction path distributes over this view's territory list, and writing an
  // owner into a not-yet-unlocked tile crashes game start (seen live as
  // "Cannot set properties of undefined (setting 'owner_id')" on
  // era_space_age + factions, whose 8 frontier tiles never spawn at init).
  const distributable = (tid: string) => territories[tid] != null && !lunarTerritoryIds.has(tid);
  const earthMap: GameMap = {
    ...map,
    territories: map.territories.filter((t) => distributable(t.territory_id)),
    connections: map.connections.filter((c) => distributable(c.from) && distributable(c.to)),
  };

  // Distribute territories — skip when territory_selection enabled (players pick manually)
  const earthTerritoryIds = Object.keys(territories).filter((tid) => !lunarTerritoryIds.has(tid));
  if (settingsNorm.territory_selection) {
    // All territories stay neutral; players will pick during 'territory_select' phase
  } else if (settingsNorm.factions_enabled) {
    const galaxyHomeworldsOk = schism
      ? distributeSchismHouses(territories, earthMap, schism, settingsNorm.initial_unit_count)
      : tryDistributeGalaxyAgeFactionHomeworlds(
        territories,
        earthMap,
        players,
        galaxyHomeWorlds,
        settingsNorm.initial_unit_count,
      );
    if (!galaxyHomeworldsOk) {
      distributeTerritoriesGeographic(territories, earthMap, players, era, settingsNorm.initial_unit_count);
    }
  } else {
    const shuffled = shuffleArray([...earthTerritoryIds]);
    shuffled.forEach((tid, idx) => {
      const playerIndex = idx % players.length;
      territories[tid].owner_id = players[playerIndex].player_id;
      territories[tid].unit_count = settingsNorm.initial_unit_count;
    });
  }

  // Final pass: ensure lunar territories stay neutral with a defending garrison
  // no matter which distribution path ran. This now also runs in
  // territory_selection mode: orbit-gated tiles are exempt from the selection
  // draft (nobody has orbit access at game start — see
  // selectionExemptTerritoryIds), so pre-spawned neutral defenders can't
  // interfere with manual picks and must exist once the game proper begins.
  for (const tid of lunarTerritoryIds) {
    // `lunarTerritoryIds` is derived from map.territories (the FULL authored
    // map), but `territories` deliberately omits tiles tagged
    // `unlock_era_index > 0` — they are held back until the era floor reaches
    // them. A tile that is both offworld AND era-gated therefore has no entry
    // here, and writing into it throws
    // "Cannot set properties of undefined (setting 'owner_id')", which crashed
    // EVERY game start on era_modern (its `lunar_outpost_mod` is exactly that
    // combination). This is the same guard `distributable` above already
    // applies for the distribution path; this sibling loop was missed.
    const territory = territories[tid];
    if (!territory) continue;
    territory.owner_id = null;
    territory.unit_count = neutralOffworldGarrison(tid);
  }

  // Standalone Space Age full board: with era advancement OFF the progressive
  // territory-growth machinery never runs, so the authored `unlock_era_index`
  // frontiers would be permanently dead content. Seed them now as neutral
  // garrisons and record the era floor so every `game:map` projection includes
  // them. Runs AFTER distribution + the lunar pass (frontiers are never in the
  // distributable set, so they're never dealt to a player) and BEFORE the
  // buildings / naval / stability init below (which then cover them exactly like
  // the neutral Moon). No-op unless the space_age_frontiers_enabled flag is on.
  let initialEraFloor = 0;
  if (seedsFullBoardAtStart(era, settingsNorm, map)) {
    initialEraFloor = seedStandaloneFrontierTerritories(territories, map);
  }

  // Build card deck
  const cardDeck = buildCardDeck(map.territories.map((t) => t.territory_id));

  // Build diplomacy matrix (all neutral)
  const diplomacy: DiplomacyEntry[] = [];
  for (let a = 0; a < players.length; a++) {
    for (let b = a + 1; b < players.length; b++) {
      diplomacy.push({
        player_index_a: a,
        player_index_b: b,
        status: 'neutral',
        truce_turns_remaining: 0,
      });
    }
  }
  // Schism under the Concord: each world's two houses open under a truce.
  if (schism) openConcord(diplomacy, players, schism);

  const economyTechBootstrap =
    settingsNorm.economy_enabled
    && settingsNorm.tech_trees_enabled
    && !settingsNorm.tutorial;
  const startingTechPoints = economyTechBootstrap
    ? (settingsNorm.economy_tech_starting_tech_points ?? 3)
    : 0;
  const startingGold = economyTechBootstrap
    ? (settingsNorm.economy_tech_starting_gold ?? 4)
    : 0;

  const playerStates: PlayerState[] = players.map((p) => ({
    ...p,
    territory_count: Object.values(territories).filter((t) => t.owner_id === p.player_id).length,
    cards: [],
    capital_territory_id: null,
    secret_mission: null,
    // Economy / tech initial values
    tech_points: settingsNorm.tech_trees_enabled ? startingTechPoints : undefined,
    special_resource: (settingsNorm.tech_trees_enabled || settingsNorm.economy_enabled)
      ? startingGold
      : undefined,
    unlocked_techs: [],
    ability_uses: {},
    space_station_launched: p.faction_id === 'lunar_pioneers' ? true : undefined,
    current_era_index: settingsNorm.era_advancement_enabled ? 0 : undefined,
    era_transition_turns_remaining: settingsNorm.era_advancement_enabled ? 0 : undefined,
    last_turn_production_income: settingsNorm.era_advancement_enabled ? 0 : undefined,
    era_advancement_tech_echo: settingsNorm.era_advancement_enabled ? {} : undefined,
    era_signature_charges: settingsNorm.era_advancement_enabled ? {} : undefined,
  }));

  // Initialize buildings array on territories when economy is enabled
  if (settingsNorm.economy_enabled) {
    for (const t of Object.values(territories)) {
      t.buildings = [];
    }
    // Faction starting buildings (Faction.starting_building). Gated on economy
    // because that is what creates the arrays above; in a no-economy game nobody
    // can build at all, so the board is equally bare for everyone.
    if (settingsNorm.factions_enabled) {
      const factionDefs = getEraFactions(era);
      for (const p of playerStates) {
        const building = p.faction_id
          ? factionDefs.find((f) => f.faction_id === p.faction_id)?.starting_building
          : undefined;
        if (!building) continue;
        const owned = Object.values(territories).filter((t) => t.owner_id === p.player_id);
        if (owned.length === 0) continue;
        // Most-connected owned territory: a lone starting building is a target,
        // and the well-connected tile is both the easiest to reinforce and the
        // one whose lane is most useful. Tie-break on id so a seeded game is
        // reproducible rather than depending on object key order.
        const host = owned.reduce((best, t) => {
          const deg = (id: string) => map.connections.filter(
            (c) => c.from === id || c.to === id,
          ).length;
          const d = deg(t.territory_id);
          const bd = deg(best.territory_id);
          if (d !== bd) return d > bd ? t : best;
          return t.territory_id < best.territory_id ? t : best;
        });
        if (!host.buildings?.includes(building)) host.buildings = [...(host.buildings ?? []), building];
      }
    }
  }

  const startingPlayerIndex = initOptions?.forceStartingPlayerIndex
    ?? pickStartingPlayerIndex(playerStates.length, settingsNorm);
  const firstPlayer = playerStates[startingPlayerIndex];
  const isTerritorySelect = !!settingsNorm.territory_selection;
  const continentBonus = isTerritorySelect
    ? 0
    : calculateContinentBonusesForPlayer(territories, map, firstPlayer.player_id, { teams: teams ?? undefined });
  const initialDraft = isTerritorySelect ? 0 : calculateReinforcements(
    firstPlayer.territory_count,
    continentBonus,
    playerStates.length,
  );

  // Era spine snapshot. Normally the configured spine (poc/classic/…) — all of
  // which begin at Ancient. When the board-transform feature is on AND the game
  // starts on a mid-line era map (e.g. era_ww2), anchor an ascension spine at
  // that era so the world transforms forward from the start map rather than only
  // from Ancient; a non-ascension start era (era_acw, galaxy, …) falls back to
  // the configured spine.
  let eraSpineSteps: GameState['era_spine'];
  if (settingsNorm.era_advancement_enabled) {
    const ascensionStart = settingsNorm.era_advancement_board_transform
      ? buildAscensionSpineFromEra(era)
      : null;
    eraSpineSteps = ascensionStart ?? getSpineById(settingsNorm.era_advancement_spine_id).steps;
  }

  const state: GameState = {
    game_id: gameId,
    era,
    map_id: map.map_id,
    phase: isTerritorySelect ? 'territory_select' : 'draft',
    current_player_index: startingPlayerIndex,
    starting_player_index: startingPlayerIndex,
    turn_number: 1,
    players: playerStates,
    territories,
    map_era_floor: initialEraFloor,
    card_deck: cardDeck,
    discard_pile: [],
    card_set_redemption_count: 0,
    diplomacy,
    settings: settingsNorm,
    draft_units_remaining: initialDraft,
    draft_placements_this_turn: {},
    draft_deployments_this_turn: [],
    turn_started_at: Date.now(),
    win_probability_history: [],
    era_spine: eraSpineSteps,
    era_modifiers: eraModifiersFor(era),
    fortify_moves_used: 0,
    influence_cooldown_remaining: 0,
    blitzkrieg_attacked: false,
  };

  if (galaxyMode) state.galaxy_mode = galaxyMode;
  if (teams) state.teams = teams;

  // Ensure first draft turn follows the same reinforcement rules as subsequent turns.
  if (!isTerritorySelect) {
    state.draft_units_remaining += getPlayerReinforceBonus(state, firstPlayer.player_id);
    floorSchismDraft(state);
  }

  // Private salt — 128 bits from CSPRNG. The client knows `game_id` (it's in
  // URLs, invite codes, replays), so deriving the mission RNG from game_id
  // alone would let any client recompute every opponent's secret mission
  // locally. The salt is generated server-side, persisted in the snapshot,
  // and stripped from client broadcasts in `buildClientState`.
  state.mission_seed_salt = randomBytes(16).toString('hex');

  const allowed = getAllowedVictoryConditions(settingsNorm);
  if (allowed.includes('capital')) {
    assignCapitals(state);
  }
  // A Territory Draft deals them when the draft ends (completeTerritorySelection).
  if (allowed.includes('secret_mission') && !isTerritorySelect) {
    dealSecretMissions(state, map);
  }

  // Initialize naval units on coastal territories when naval warfare is enabled
  if (settingsNorm.naval_enabled) {
    initializeNavalUnits(state, map);
  }

  // Initialize stability values when stability feature is enabled
  if (settingsNorm.stability_enabled) {
    initializeStability(state);
  }

  // Opening economy tick: all players receive first production/tech income before turn 1.
  if (
    economyTechBootstrap
    && !isTerritorySelect
    && state.settings.economy_enabled
    && state.settings.tech_trees_enabled
  ) {
    applyOpeningEconomyTick(state);
  }
  if (!isTerritorySelect) payFirstTurnProduction(state);

  // Inject seasonal event cards into the game-start deck
  if (settingsNorm.events_enabled) {
    const seasonal = getActiveSeasonalDeck(era, new Date());
    if (seasonal.length > 0) {
      // Seasonal cards are stored on the game state and merged into the era deck when drawing each round.
      state.seasonal_event_cards = seasonal;
    }
  }

  // Campaign starting-unit handicap. The underdog paths are built on starting
  // outnumbered — Last Defenders deals the human -3 to -5 on every stage — and
  // the field was authored on all eighteen stages but read by nothing, so every
  // campaign began even. Units come off the human's largest stacks first and
  // never take a territory below one, so the handicap thins the front rather
  // than handing territories away.
  const unitsDelta = settingsNorm.campaign_starting_units_delta ?? 0;
  if (settingsNorm.is_campaign && unitsDelta < 0) {
    const human = state.players.find((p) => !p.is_ai);
    if (human) {
      let left = -unitsDelta;
      const owned = Object.keys(territories).filter((t) => territories[t].owner_id === human.player_id);
      while (left > 0) {
        let biggest: string | null = null;
        for (const id of owned) {
          if (territories[id].unit_count <= 1) continue;
          if (!biggest || territories[id].unit_count > territories[biggest].unit_count
            || (territories[id].unit_count === territories[biggest].unit_count && id < biggest)) {
            biggest = id;
          }
        }
        if (!biggest) break;
        territories[biggest].unit_count -= 1;
        left -= 1;
      }
    }
  }

  // Prestige and the Survivor Bonus are no longer injected as
  // temporary_modifiers here. Combat only reads those when events are enabled,
  // which campaigns never do, so both carries were inert for every campaign
  // ever played. combatModifiers now reads them straight off settings.

  // A launch pad seeded above opens its own orbit lane, and the lane has to
  // exist from turn one or the building is decorative. gameRoomManager syncs on
  // every room load, but nothing had synced at INIT — which the balance sim
  // relies on, since it only syncs after a pad is built during play. Doing it
  // here removes that divergence: the same call, idempotent (it returns false
  // when there is nothing to add), on every path that starts a game.
  syncLaunchPadLanes(map, state);
  // A three-seat Colonies game bridges the ring's gaps from turn one, the same way.
  syncGalaxyModeLanes(map, state);

  appendWinProbabilitySnapshot(state);
  return state;
}

/**
 * Patch older `state_json` rows (missing fields) and normalize settings.
 * Optionally pass `map` to backfill capitals when legacy rows omit them.
 */
export function repairLegacyGameState(state: GameState, map?: GameMap): void {
  state.settings = normalizeGameSettings(state.settings);
  for (const p of state.players) {
    if (p.capital_territory_id === undefined) p.capital_territory_id = null;
    if (p.secret_mission === undefined) p.secret_mission = null;
    if (p.tech_points === undefined && state.settings.tech_trees_enabled) p.tech_points = 0;
    if (p.special_resource === undefined && state.settings.tech_trees_enabled) p.special_resource = 0;
    if (p.unlocked_techs === undefined) p.unlocked_techs = [];
    if (p.ability_uses === undefined) p.ability_uses = {};
    // Migrate the legacy "converted to AI after grace" marker onto the away-seat
    // model: a taken-over human becomes an away human (is_ai reverts to false) so
    // the AI just covers their turns and they can reclaim instantly. Idempotent.
    if (p.ai_takeover) {
      p.is_ai = false;
      p.ai_difficulty = undefined;
      p.is_away = true;
      if (p.away_since === undefined) p.away_since = null;
      delete p.ai_takeover;
    }
  }
  // Patch missing per-turn fields on GameState
  if (state.fortify_moves_used === undefined) state.fortify_moves_used = 0;
  if (state.influence_cooldown_remaining === undefined) state.influence_cooldown_remaining = 0;
  if (state.blitzkrieg_attacked === undefined) state.blitzkrieg_attacked = false;
  // Patch era_modifiers to ensure new eras have defaults applied
  if (!state.era_modifiers && state.era) {
    state.era_modifiers = eraModifiersFor(state.era);
  }
  // Era advancement: synthesize the spine snapshot for pre-spine saves and
  // migrate the legacy medieval charge field into the generalized store.
  // Idempotent — the legacy field is deleted once migrated.
  if (state.settings.era_advancement_enabled) {
    if (!state.era_spine || state.era_spine.length === 0) {
      state.era_spine = getSpineById(state.settings.era_advancement_spine_id).steps;
    }
    for (const p of state.players) {
      if (p.medieval_signature_charges !== undefined) {
        if (p.medieval_signature_charges > 0) {
          p.era_signature_charges = {
            ...(p.era_signature_charges ?? {}),
            levy_of_knights:
              (p.era_signature_charges?.levy_of_knights ?? 0) + p.medieval_signature_charges,
          };
        }
        delete p.medieval_signature_charges;
      }
      if (p.era_signature_charges === undefined) p.era_signature_charges = {};
      // Wrap pre-era-keyed flat echoes under the decay-exempt `legacy` key.
      if (p.era_advancement_tech_echo) ensureEraKeyedEcho(p);
    }
    // Remap advanced players still holding a base-era faction_id onto their
    // lineage's current-era faction (pre-lineage saves).
    migrateAdvancedFactions(state);
  }
  // Patch buildings field on territories
  if (state.settings.economy_enabled) {
    for (const t of Object.values(state.territories)) {
      if (t.buildings === undefined) t.buildings = [];
    }
  }
  const allowed = getAllowedVictoryConditions(state.settings);
  if (map && allowed.includes('capital')) {
    const missing = state.players.some((p) => !p.capital_territory_id);
    if (missing) assignCapitals(state);
  }
}

/**
 * Heuristic win probability from territory share + total army share (55% / 45%), renormalized over active players.
 */
export function computeWinProbabilities(state: GameState): Record<string, number> {
  const active = state.players.filter((p) => !p.is_eliminated);
  const result: Record<string, number> = {};
  for (const p of state.players) {
    result[p.player_id] = 0;
  }
  if (active.length === 0) return result;
  if (active.length === 1) {
    result[active[0].player_id] = 1;
    return result;
  }

  let totalTerr = 0;
  let totalArmy = 0;
  const terrByPlayer: Record<string, number> = {};
  const armyByPlayer: Record<string, number> = {};

  for (const p of active) {
    terrByPlayer[p.player_id] = p.territory_count;
    totalTerr += p.territory_count;
    let units = 0;
    for (const t of Object.values(state.territories)) {
      if (t.owner_id === p.player_id) units += t.unit_count;
    }
    armyByPlayer[p.player_id] = units;
    totalArmy += units;
  }

  let rawSum = 0;
  const raw: Record<string, number> = {};
  for (const p of active) {
    const tShare = totalTerr > 0 ? terrByPlayer[p.player_id] / totalTerr : 1 / active.length;
    const aShare = totalArmy > 0 ? armyByPlayer[p.player_id] / totalArmy : 1 / active.length;
    const blend = 0.55 * tShare + 0.45 * aShare;
    raw[p.player_id] = blend;
    rawSum += blend;
  }

  if (rawSum <= 0) {
    const eq = 1 / active.length;
    for (const p of active) result[p.player_id] = eq;
    return result;
  }
  for (const p of active) {
    result[p.player_id] = raw[p.player_id] / rawSum;
  }
  return result;
}

export function appendWinProbabilitySnapshot(state: GameState): void {
  if (!state.win_probability_history) {
    state.win_probability_history = [];
  }
  const probs = computeWinProbabilities(state);
  const step = state.win_probability_history.length;
  const snapshot: WinProbabilitySnapshot = {
    step,
    turn: state.turn_number,
    probabilities: probs,
  };
  state.win_probability_history.push(snapshot);
}

function calculateContinentBonusesForPlayer(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  playerId: string,
  // A team game's sides (state/teams.ts): a region allies hold whole pays too.
  sides: Pick<GameState, 'teams'> = {},
): number {
  let bonus = 0;
  for (const region of map.regions) {
    const regionTerritories = map.territories.filter((t) => t.region_id === region.region_id);
    const owners = regionTerritories.map((t) => territories[t.territory_id]?.owner_id);
    // The player holding it all; in a team game, one side (state/teams.ts).
    const holds = isTeamGame(sides)
      ? regionBonusHolder(sides, owners) === playerId
      : owners.every((owner) => owner === playerId);
    if (holds) bonus += region.bonus;
  }
  return bonus;
}

/**
 * Recalculate territory counts for all players.
 */
export function syncTerritoryCounts(state: GameState): void {
  const counts: Record<string, number> = {};
  for (const t of Object.values(state.territories)) {
    if (t.owner_id) {
      counts[t.owner_id] = (counts[t.owner_id] ?? 0) + 1;
    }
  }
  for (const player of state.players) {
    player.territory_count = counts[player.player_id] ?? 0;
    if ((player.peak_territory_count ?? 0) < player.territory_count) {
      player.peak_territory_count = player.territory_count;
    }
  }
}

// ── Territory Draft (territory_select phase) ──────────────────────────────────

/** A territory nobody holds yet. Legacy rows used '' or 'neutral' for "no owner". */
export function isUnclaimedOwner(ownerId: string | null | undefined): boolean {
  return ownerId == null || ownerId === '' || ownerId === 'neutral';
}

/**
 * Territories the seat to move may claim right now. Seeded frontiers are
 * conquered in play rather than drafted, and orbit-gated tiles need the
 * same access a human would.
 */
export function claimableTerritoryIds(state: GameState, map: GameMap, playerId: string): string[] {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return [];
  const hasOrbitAccess = getOrbitAccessResult(state, player, map, state.era).allowed;
  const unlockIndex = new Map(map.territories.map((t) => [t.territory_id, t.unlock_era_index ?? 0]));
  return Object.entries(state.territories)
    .filter(([id, t]) =>
      isUnclaimedOwner(t.owner_id)
      && (hasOrbitAccess || !territoryRequiresOrbitAccessForClaim(map, id))
      && (unlockIndex.get(id) ?? 0) <= 0)
    .map(([id]) => id);
}

/**
 * Hand the draft pick to the next living seat: after a claim, after a seat
 * that timed out with nothing to claim, and when the seat to pick resigns.
 */
export function passSelectionPick(state: GameState): void {
  const total = state.players.length;
  let next = (state.current_player_index + 1) % total;
  let attempts = 0;
  while (state.players[next].is_eliminated && attempts < total) {
    next = (next + 1) % total;
    attempts++;
  }
  state.current_player_index = next;
  state.turn_started_at = Date.now();
}

/**
 * Claim one territory for the seat to move, pass the pick to the next living
 * seat, and end the draft once every claimable territory is taken. The caller
 * validates the pick; this is the shared bookkeeping for the human handler,
 * the AI and the timeout auto-pick.
 */
export function claimSelectionTerritory(
  state: GameState,
  map: GameMap,
  territoryId: string,
): { completed: boolean } {
  const player = state.players[state.current_player_index]!;
  const territory = state.territories[territoryId]!;
  territory.owner_id = player.player_id;
  territory.unit_count = state.settings.initial_unit_count;
  player.territory_count = Object.values(state.territories).filter((t) => t.owner_id === player.player_id).length;
  passSelectionPick(state);

  // Orbit-gated tiles are exempt: nobody holds orbit access at game start, so
  // counting them would soft-lock the phase.
  const exempt = selectionExemptTerritoryIds(map);
  const unclaimed = Object.values(state.territories).filter(
    (t) => isUnclaimedOwner(t.owner_id) && !exempt.has(t.territory_id),
  ).length;
  if (unclaimed > 0) return { completed: false };
  completeTerritorySelection(state, map);
  return { completed: true };
}

/**
 * Start turn one once the map is claimed. Everything `initializeGameState`
 * sets up from ownership had nothing to read in a draft game — nobody held a
 * tile at creation — so it runs here instead: capitals (else Capital victory
 * can never fire), secret missions (else a capture or region mission could name
 * ground its holder then drafted) and stability (else the whole layer stays
 * inert).
 */
export function completeTerritorySelection(state: GameState, map: GameMap): void {
  state.phase = 'draft';
  state.draft_placements_this_turn = {};
  state.draft_deployments_this_turn = [];
  const starterIdx = getStartingPlayerIndex(state);
  state.current_player_index = starterIdx;
  state.turn_number = 1;
  state.turn_started_at = Date.now();

  const allowed = getAllowedVictoryConditions(normalizeGameSettings(state.settings));
  if (allowed.includes('capital')) {
    assignCapitals(state);
  }
  if (allowed.includes('secret_mission')) {
    dealSecretMissions(state, map);
  }
  if (state.settings.stability_enabled) initializeStability(state);
  // The opening income tick initializeGameState skips for a draft (with no
  // territory owned it would pay only the per-territory minimums). Paid here,
  // on the drafted board, under the same conditions as a dealt game.
  if (state.settings.economy_enabled && state.settings.tech_trees_enabled && !state.settings.tutorial) {
    applyOpeningEconomyTick(state);
  }
  payFirstTurnProduction(state);

  const firstPlayer = state.players[starterIdx]!;
  state.draft_units_remaining = calculateReinforcements(
    firstPlayer.territory_count,
    calculateContinentBonuses(state, map, firstPlayer.player_id),
    state.players.length,
  ) + getPlayerReinforceBonus(state, firstPlayer.player_id);
}

/**
 * The seat to move ran out of time in the draft: claim a random claimable
 * territory for it and move on. Ending the phase instead would leave the
 * remaining tiles neutral at 0 units, which no attack can ever take.
 */
export function autoPickSelectionTerritory(
  state: GameState,
  map: GameMap,
): { territoryId: string | null; completed: boolean } {
  const player = state.players[state.current_player_index];
  const options = player ? claimableTerritoryIds(state, map, player.player_id) : [];
  if (options.length === 0) {
    // Nothing this seat may claim (e.g. only orbit-gated tiles left): pass.
    const exempt = selectionExemptTerritoryIds(map);
    const stuck = Object.values(state.territories).every(
      (t) => !isUnclaimedOwner(t.owner_id) || exempt.has(t.territory_id),
    );
    if (stuck) {
      completeTerritorySelection(state, map);
      return { territoryId: null, completed: true };
    }
    passSelectionPick(state);
    return { territoryId: null, completed: false };
  }
  const territoryId = options[randomInt(0, options.length)]!;
  return { territoryId, ...claimSelectionTerritory(state, map, territoryId) };
}

/**
 * Who receives this round's single-player event card: the living seats in
 * index order, one per round, so every player gets the same share of targeted
 * cards and choices over a game. Called after `turn_number` has advanced.
 */
export function eventTargetForRound(state: GameState): string {
  const living = state.players.filter((p) => !p.is_eliminated).sort((a, b) => a.player_index - b.player_index);
  return living[Math.max(0, state.turn_number - 2) % living.length]!.player_id;
}

/**
 * Calculate continent bonuses for a given player.
 */
export function calculateContinentBonuses(
  state: GameState,
  map: GameMap,
  playerId: string
): number {
  let bonus = 0;
  for (const region of map.regions) {
    // Only count territories that are currently in play. On a growing board (Era
    // Advancement territory growth) a region may include frontier territories not
    // yet unlocked: those must not block the bonus for the in-play part, and an
    // all-locked region must not award a vacuous bonus (`[].every()` is true).
    // No-op for maps without growth — every territory is always in play there.
    const regionTerritories = map.territories.filter(
      (t) => t.region_id === region.region_id && state.territories[t.territory_id] !== undefined
    );
    if (regionTerritories.length === 0) continue;
    const owners = regionTerritories.map((t) => state.territories[t.territory_id]?.owner_id);
    // The player holding it all; in a team game, one side (state/teams.ts).
    const holds = isTeamGame(state)
      ? regionBonusHolder(state, owners) === playerId
      : owners.every((owner) => owner === playerId);
    if (holds) bonus += region.bonus;
  }
  return bonus;
}

/**
 * Advance to the next player's turn.
 * Skips eliminated players and wraps around.
 */
export function advanceToNextPlayer(state: GameState, map?: GameMap): void {
  // An instant card is applied below, at the hand-off that makes it active,
  // and the socket layer retires it once announced (broadcastEventCard). One
  // still set here has therefore been applied already — it survived in a state
  // saved before it was retired — and must not fire again. A choice card
  // stays until someone resolves it.
  if (state.active_event && !state.active_event.choices?.length) {
    state.active_event = undefined;
    state.active_event_result = undefined;
  }
  passTurn(state, map);
}

/**
 * The hand-off itself: from the seat to move to the next living one, running
 * the round's effects (when it wraps) and the incoming player's turn start.
 */
function passTurn(state: GameState, map?: GameMap): void {
  // Lunar Hegemony (Phase 3): the outgoing player's turn is ending, which is
  // exactly when "hold the whole Moon at the end of your turn" is judged.
  // `checkVictory` reads the completed clock; the callers all run it right
  // after this returns.
  const outgoing = state.players[state.current_player_index]?.player_id ?? null;
  tickLunarHegemony(state, outgoing);

  const total = state.players.length;
  let next = (state.current_player_index + 1) % total;
  let attempts = 0;
  while (state.players[next].is_eliminated && attempts < total) {
    next = (next + 1) % total;
    attempts++;
  }
  // A round ends when the hand-off crosses the starting seat, so every
  // player's first turn is turn 1 whichever seat the random start picked, and
  // an eliminated starting seat still marks the boundary. (The counter used
  // to roll over whenever the seat index wrapped past the last seat, which
  // labelled a non-starting host's first turn "Turn 2" and shifted everything
  // keyed to the turn number — turn caps, speed achievements, the daily par,
  // the resign grace window — by one seat.)
  if (handOffCrossesSeat(state.current_player_index, next, getStartingPlayerIndex(state), total)) {
    state.turn_number++;

    // Round-end sweep for the Hegemony clock. The end-of-turn tick above only
    // sees the board as the holder left it; an event card that flips a lunar
    // tile between turns has to break the clock too, and this is the one place
    // that runs after everybody has acted.
    tickLunarHegemony(state, null);

    // Galaxy worlds as characters: the storms shed units from over-stacked
    // tiles once per round, before anyone drafts.
    applyStormAttrition(state);
    // ...and the cradle refills its thin tiles for whoever holds them.
    applyCradleMuster(state);

    // Galaxy lane weather ages with the round, not with a player's turn: a
    // closure nobody owns cannot wait on whose charge it was.
    tickLaneWeather(state);

    // Space Age Orbital Blockades age with the round. The Galactic Age's seals
    // do NOT — they age at their owner's own turn start (below), so every seat
    // faces one for the same length of time. Each seal records which clock it
    // is on, so a board carrying both works.
    tickLaneBlockades(state);

    // Decrement truce timers once per round (not per player turn). An agreed
    // truce's rounds are the ones after it is accepted, so the round it was
    // accepted in ends without a tick (see agreeTruce).
    for (const entry of state.diplomacy) {
      if (entry.status === 'truce' && entry.truce_turns_remaining > 0) {
        if (entry.truce_agreed_turn === state.turn_number - 1) continue;
        entry.truce_turns_remaining--;
        if (entry.truce_turns_remaining === 0) {
          entry.status = 'neutral';
        }
      }
    }

    // Draw an event card at the start of each new round
    if (state.settings.events_enabled) {
      const deck = [...getEraDeck(state.era), ...(state.seasonal_event_cards ?? [])]
        // A Lane Surge with no gap left to bridge would be a card that does nothing.
        .filter((c) => c.effect?.type !== 'lane_surge' || !map || laneSurgeHasGap(map));
      const card = drawRandomCard(deck);
      // An undelivered card from last round (its target was eliminated) lapses.
      state.pending_event = undefined;
      if (card && (card.effect || card.choices?.length)) {
        if (card.affects_all_players && !card.choices?.length) {
          // Hits every player: resolve now, whoever opens the round.
          state.active_event = card;
        } else {
          // One player's card (or a choice). It used to fire here too, and the
          // player whose turn opens the round is always the same seat, so one
          // seat received every targeted card and every choice all game.
          // The target now rotates through the living seats, round by round,
          // and the card fires at the start of that player's own turn.
          state.pending_event = { card, target_player_id: eventTargetForRound(state) };
        }
      }
    }
  }
  state.current_player_index = next;
  // Galaxy: the incoming player's own lane seals age as their turn begins, and
  // their Lane Sovereignty streak extends or breaks on the corridors they hold
  // right now — both are "at the start of your turn" rules.
  tickLaneBlockades(state, state.players[next].player_id);
  if (map) tickLaneSovereignty(state, map, state.players[next].player_id);
  // Galaxy transit: convoys the incoming player sent last turn arrive now (or
  // turn back, if the world they were sent to is no longer theirs).
  const arrivals = arriveConvoys(state, state.players[next].player_id);
  state.last_transit_arrivals = arrivals.length > 0 ? arrivals : undefined;
  state.phase = 'draft';
  state.draft_placements_this_turn = {};
  state.draft_deployments_this_turn = [];
  state.turn_started_at = Date.now();

  // Expire any pending truce proposals sent by the player whose turn is now starting.
  // The target had until the proposer's next turn to respond; after that the proposal
  // is silently discarded so it can never permanently block re-proposals. One from
  // or to a player who is out of the game lapses now: an eliminated proposer has no
  // next turn, so theirs used to stand for good.
  const eliminatedIds = new Set(state.players.filter((p) => p.is_eliminated).map((p) => p.player_id));
  if (state.pending_truces?.length) {
    const nextPlayerId = state.players[next].player_id;
    state.pending_truces = state.pending_truces.filter(
      (pt) => pt.proposer_id !== nextPlayerId
        && !eliminatedIds.has(pt.proposer_id) && !eliminatedIds.has(pt.target_id),
    );
  }
  // A Drop Assault lands as its owner's turn begins, which never comes again for
  // a player who is out: theirs is called off, where it used to keep its target's
  // incoming-drop marker up for the rest of the game.
  if (state.drop_assaults?.length) {
    state.drop_assaults = state.drop_assaults.filter((d) => !eliminatedIds.has(d.owner_id));
  }

  const nextPlayer = state.players[next];
  // Tick down the post-advance vulnerability window at the start of the
  // advancer's turn. Decrement (not zero) so era_advancement_vuln_turns > 1
  // genuinely lasts multiple turns.
  if (state.settings.era_advancement_enabled && (nextPlayer.era_transition_turns_remaining ?? 0) > 0) {
    nextPlayer.era_transition_turns_remaining = Math.max(0, (nextPlayer.era_transition_turns_remaining ?? 0) - 1);
  }
  if (map) {
    const bonus = calculateContinentBonusesForPlayer(state.territories, map, nextPlayer.player_id, state);
    const passiveReinforceBonus = getPlayerReinforceBonus(state, nextPlayer.player_id);
    const wonderReinforceBonus = state.settings.economy_enabled
      ? getWonderReinforceBonus(state, nextPlayer.player_id)
      : 0;
    state.draft_units_remaining = calculateReinforcements(
      nextPlayer.territory_count,
      bonus,
      state.players.length,
    ) + passiveReinforceBonus + wonderReinforceBonus;
  } else {
    state.draft_units_remaining = calculateReinforcements(
      nextPlayer.territory_count,
      0,
      state.players.length,
    );
  }
  floorSchismDraft(state);

  appendWinProbabilitySnapshot(state);

  // Collect production income and tech point income for the next player
  if (state.settings.economy_enabled) {
    collectProduction(state, nextPlayer.player_id);
    applyWonderProductionIncome(state, nextPlayer.player_id);
  }
  if (state.settings.tech_trees_enabled) {
    applyTechPointIncome(state, nextPlayer.player_id);
  }

  // Helium-3 from owned Moon tiles (Space Age Moon Race, Phase 1). Its own
  // gate rather than tech_trees_enabled — a Lunar Pioneer holds lunar ground
  // from turn one without researching the ladder.
  applyHelium3Income(state, nextPlayer.player_id);

  // Tribute (§8, off by default): the Moon holder's levy, taken at the PAYER's
  // income tick — the turn where they can see what it cost them, rather than
  // quietly at the holder's. The holder's running total resets on their own
  // turn so the figure reads "collected since I last acted".
  clearTributeReceived(state, nextPlayer.player_id);
  applyMoonTribute(state, nextPlayer.player_id);

  // Collect fleet income from ports / naval bases
  if (state.settings.naval_enabled) {
    collectFleetIncome(state, nextPlayer.player_id);
  }

  // Apply stability recovery tick
  if (state.settings.stability_enabled) {
    applyStabilityTick(state, nextPlayer.player_id);
    // Rebels took the incoming player's last territory: they are out before
    // their turn begins, and it passes on to the next living seat. (Not via
    // advanceToNextPlayer: a card the round opened with is still to apply.)
    if (nextPlayer.is_eliminated && state.players.some((p) => !p.is_eliminated)) {
      passTurn(state, map);
      return;
    }
  }

  // Tick temporary modifiers from event cards
  if (state.settings.events_enabled) {
    tickTemporaryModifiers(state, nextPlayer.player_id);
    // This round's single-player card reaches its target as their turn begins.
    if (state.pending_event?.target_player_id === nextPlayer.player_id) {
      state.active_event = state.pending_event.card;
      state.pending_event = undefined;
    }
    // Apply instant event cards now (current_player_index is set to next player)
    if (state.active_event && (!state.active_event.choices || state.active_event.choices.length === 0) && state.active_event.effect) {
      // Lane weather rewrites the GRAPH, so it needs the map — which the generic
      // effect applier deliberately does not take. Resolved here, where both are
      // in hand; the caller then projects a new surge onto its map copy
      // (`syncLaneWeatherLanes`).
      const effectType = state.active_event.effect.type;
      const effectResult = map && effectType === 'lane_closure'
        ? applyLaneClosure(state, map)
        : map && effectType === 'lane_surge'
          ? applyLaneSurge(state, map)
          : applyEventEffect(state, state.active_event.effect, state.active_event.affects_all_players);
      state.active_event_result = effectResult;
      // Leave active_event set so the socket layer can broadcast it, then clear it there
    }
  }

  // Reset per-turn ability flags
  state.fortify_moves_used = 0;
  if ((state.influence_cooldown_remaining ?? 0) > 0) state.influence_cooldown_remaining!--;
  state.blitzkrieg_attacked = false;
  state.blitzkrieg_active = false;
  state.blitzkrieg_bonus_source_id = null;
  state.blitzkrieg_bonus_attacks_remaining = 0;
  // Reset per-player per-turn ability use counts
  for (const player of state.players) {
    player.ability_uses = {};
    player.territories_captured_this_turn = 0;
    player.card_earned_this_turn = false;
    // Armored Push grants extra fortify moves for one turn only.
    player.bonus_fortify_moves = 0;
    // Refresh per-turn defensive charges so each opponent's turn gets a fresh
    // "first attack against you" trigger (greek_fire / great_wall) and the
    // papal_dispensation influence block resets.
    player.defensive_charge_used_this_turn = false;
    player.influence_block_used_this_turn = false;
    // March to the Sea is a single-turn doctrine (once per game); clear its chain
    // state so a stale chain can't grant bonus dice on a later turn.
    player.march_to_sea_active = false;
    player.march_to_sea_hops_used = 0;
    player.march_to_sea_last_capture_id = null;
    player.era_advanced_this_turn = false;
  }
}

export interface AutoDraftPlacement {
  territory_id: string;
  units: number;
  totalAfter: number;
}

export interface AutoDraftResult {
  total: number;
  placements: AutoDraftPlacement[];
}

export type TimeoutPhaseAdvance =
  | { kind: 'selection'; territoryId: string | null; completed: boolean }
  | { kind: 'turn'; autoDraft: AutoDraftResult };

/**
 * What a real-time turn timer's expiry does.
 *
 * The clock covers the whole turn (draft, attack and fortify together) and
 * runs on through phase changes. When it runs out, reinforcements still
 * unplaced are placed for the player and the turn passes on (`{ kind: 'turn' }`).
 * It used to time out one phase at a time and restart a full clock for each,
 * so a "5 minute" turn could run fifteen.
 *
 * The Territory Draft keeps its clock per pick: an expiry picks for the seat
 * (`{ kind: 'selection' }`).
 */
export function advancePhaseOnTimeout(state: GameState, map?: GameMap): TimeoutPhaseAdvance {
  // Territory Draft: pick for the seat that timed out. Falling through to the
  // turn hand-off below set phase = 'draft' and abandoned every unclaimed tile.
  if (state.phase === 'territory_select' && map) {
    return { kind: 'selection', ...autoPickSelectionTerritory(state, map) };
  }
  const autoDraft = state.phase === 'draft' && state.draft_units_remaining > 0
    ? autoPlaceDraftUnits(state)
    : { total: 0, placements: [] };
  state.draft_units_remaining = 0;
  state.fortify_moves_used = 0;
  advanceToNextPlayer(state, map);
  return { kind: 'turn', autoDraft };
}

/**
 * Auto-place remaining draft units when the turn timer expires (or a player ends
 * the draft with units unspent). Distributes units round-robin across the player's
 * territories in sorted `territory_id` order, honoring the per-territory stability
 * deploy cap so the auto-place path can't quietly bypass the limit the manual
 * `game:draft` handler enforces. Units that can't be placed because every owned
 * territory is capped are left in `draft_units_remaining` for the caller to clear.
 */
export function autoPlaceDraftUnits(state: GameState): AutoDraftResult {
  const empty: AutoDraftResult = { total: 0, placements: [] };
  if (state.phase !== 'draft' || state.draft_units_remaining <= 0) return empty;

  const player = state.players[state.current_player_index];
  const playerId = player?.player_id;
  if (!player || !playerId) return empty;

  const ownedIds = Object.keys(state.territories)
    .filter((tid) => state.territories[tid].owner_id === playerId)
    .sort();
  if (ownedIds.length === 0) return empty;

  const stabilityEnabled = !!state.settings.stability_enabled;
  const placedThisTurn = stabilityEnabled
    ? (state.draft_placements_this_turn = state.draft_placements_this_turn ?? {})
    : null;

  // Per-territory remaining capacity for the rest of this draft. Infinity when
  // stability is off or the territory is stable enough to be uncapped.
  const remainingCap = new Map<string, number>();
  for (const tid of ownedIds) {
    if (!stabilityEnabled) {
      remainingCap.set(tid, Infinity);
      continue;
    }
    const cap = getDeployCap(state.territories[tid].stability, {
      era: state.era,
      turnNumber: state.turn_number,
      economyEnabled: !!state.settings.economy_enabled,
      playerSpecialResource: player.special_resource ?? 0,
      worldDeployCapBonus: worldDeployCapBonus(state, state.territories[tid].world_id),
    });
    remainingCap.set(tid, Math.max(0, cap - (placedThisTurn![tid] ?? 0)));
  }

  const counts = new Map<string, number>();
  let placed = 0;
  let idx = 0;
  let consecutiveSkips = 0;
  // Stop when the pool is empty or every territory has hit its cap (a full lap of
  // skips). The skip counter resets on each successful placement.
  while (state.draft_units_remaining > 0 && consecutiveSkips < ownedIds.length) {
    const tid = ownedIds[idx % ownedIds.length]!;
    idx++;
    const cap = remainingCap.get(tid) ?? 0;
    if (cap <= 0) {
      consecutiveSkips++;
      continue;
    }
    state.territories[tid].unit_count += 1;
    state.draft_units_remaining -= 1;
    remainingCap.set(tid, cap - 1);
    if (placedThisTurn) placedThisTurn[tid] = (placedThisTurn[tid] ?? 0) + 1;
    counts.set(tid, (counts.get(tid) ?? 0) + 1);
    placed++;
    consecutiveSkips = 0;
  }

  const placements: AutoDraftPlacement[] = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([territory_id, units]) => ({
      territory_id,
      units,
      totalAfter: state.territories[territory_id]!.unit_count,
    }));

  return { total: placed, placements };
}

/**
 * Older saved games may omit draft_units_remaining. Restore it when resuming in draft phase.
 */
export function repairDraftUnitsIfMissing(state: GameState, map: GameMap): void {
  if (state.phase !== 'draft') return;
  if (
    state.draft_units_remaining != null &&
    typeof state.draft_units_remaining === 'number' &&
    !Number.isNaN(state.draft_units_remaining)
  ) {
    return;
  }
  const p = state.players[state.current_player_index];
  if (!p) return;
  const bonus = calculateContinentBonusesForPlayer(state.territories, map, p.player_id, state);
  state.draft_units_remaining = calculateReinforcements(
    p.territory_count,
    bonus,
    state.players.length,
  );
}

/**
 * Tie-break when multiple players satisfy a victory condition in the same update:
 * prefer the current turn holder, else lowest player_index.
 */
function pickWinnerAmong(candidates: string[], state: GameState): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const current = state.players[state.current_player_index]?.player_id;
  if (current && candidates.includes(current)) return current;
  let best: string | null = null;
  let bestIdx = Infinity;
  for (const id of candidates) {
    const p = state.players.find((x) => x.player_id === id);
    if (p && p.player_index < bestIdx) {
      bestIdx = p.player_index;
      best = id;
    }
  }
  return best;
}

function playerSatisfiesCapitalVictory(state: GameState, playerId: string): boolean {
  const p = state.players.find((x) => x.player_id === playerId);
  if (!p || p.is_eliminated || !p.capital_territory_id) return false;
  if (state.territories[p.capital_territory_id]?.owner_id !== playerId) return false;
  const others = state.players.filter((o) => !o.is_eliminated && o.player_id !== playerId);
  for (const o of others) {
    if (!o.capital_territory_id) return false;
    if (state.territories[o.capital_territory_id]?.owner_id !== playerId) return false;
  }
  return true;
}

/**
 * Check if the game has a winner based on configured victory conditions (OR semantics).
 */
export function checkVictory(state: GameState, map: GameMap): { winnerIds: string[]; condition: VictoryConditionKey } | null {
  // A team game is judged side by side (victory/teamVictory.ts).
  if (isTeamGame(state)) return checkTeamVictory(state, map);
  const activePlayers = state.players.filter((p) => !p.is_eliminated);
  if (activePlayers.length === 1) return { winnerIds: [activePlayers[0].player_id], condition: 'last_standing' };

  // Every human is out. Without this the surviving bots grind on against each
  // other for the rest of the turn limit with nobody watching, and the human
  // who was just eliminated never gets a result screen. Credit the leading AI
  // (most territories, then most units) so the defeat reads as a real outcome.
  // Guarded on the game having had a human in it at all, so an all-AI match
  // — simulation, or a seeded fixture — is unaffected.
  const hasHumanSeat = state.players.some((p) => !p.is_ai);
  if (hasHumanSeat && activePlayers.length > 0 && !activePlayers.some((p) => !p.is_ai)) {
    const unitsOf = (playerId: string) => Object.values(state.territories)
      .reduce((sum, t) => (t.owner_id === playerId ? sum + (t.unit_count ?? 0) : sum), 0);
    const leader = [...activePlayers].sort(
      (a, b) => b.territory_count - a.territory_count || unitsOf(b.player_id) - unitsOf(a.player_id),
    )[0]!;
    return { winnerIds: [leader.player_id], condition: 'humans_eliminated' };
  }

  const settings = normalizeGameSettings(state.settings);
  const allowed = getAllowedVictoryConditions(settings);
  const totalTerritories = Object.keys(state.territories).length;
  const winners: Array<{ winnerIds: string[]; condition: VictoryConditionKey }> = [];

  // Alliance victory check (secret_mission mode)
  if (allowed.includes('secret_mission')) {
    for (let i = 0; i < activePlayers.length; i++) {
      const p1 = activePlayers[i];
      if (p1.secret_mission?.kind !== 'alliance') continue;
      const threshold = p1.secret_mission.territory_threshold;
      if (p1.territory_count < threshold) continue;
      const p2 = activePlayers.find(
        (p) =>
          p.player_id === (p1.secret_mission as { kind: 'alliance'; ally_player_id: string; territory_threshold: number }).ally_player_id &&
          p.secret_mission?.kind === 'alliance' &&
          (p.secret_mission as { kind: 'alliance'; ally_player_id: string; territory_threshold: number }).ally_player_id === p1.player_id &&
          p.territory_count >= threshold,
      );
      if (p2) {
        return { winnerIds: [p1.player_id, p2.player_id], condition: 'alliance_victory' };
      }
    }
  }

  for (const player of activePlayers) {
    let condition: VictoryConditionKey | null = null;

    if (allowed.includes('domination') && player.territory_count >= totalTerritories) {
      condition = 'domination';
    }

    if (
      condition == null &&
      allowed.includes('threshold') &&
      settings.victory_threshold != null
    ) {
      // Integer maths: `total * (pct / 100)` rounds in binary floating point,
      // so 55% of 100 came out 55.000000000000007 and demanded a 56th territory.
      const need = Math.ceil((totalTerritories * settings.victory_threshold) / 100);
      if (player.territory_count >= need) condition = 'threshold';
    }

    // Lunar Hegemony (Space Age Moon Race, Phase 3): the clock is advanced at
    // end of turn by `tickLunarHegemony`; this only reads whether it has run
    // out. Placed with the other alternates — `last_standing` still pre-empts
    // it, which is fine: a hegemon who also cleared Earth has won either way.
    if (condition == null && allowed.includes('lunar_hegemony')) {
      if (hasCompletedHegemony(state, player.player_id)) condition = 'lunar_hegemony';
    }

    if (condition == null && allowed.includes('capital')) {
      if (playerSatisfiesCapitalVictory(state, player.player_id)) condition = 'capital';
    }

    // Lane Sovereignty (galaxy): the streak is banked at the holder's own turn
    // start, so this only reads it — see victory/laneSovereignty.ts.
    if (condition == null && allowed.includes('lane_sovereignty')) {
      if (hasLaneSovereignty(state, player.player_id)) condition = 'lane_sovereignty';
    }

    if (condition == null && allowed.includes('secret_mission') && player.secret_mission) {
      if (player.secret_mission.kind !== 'alliance' && isMissionComplete(state, map, player)) condition = 'secret_mission';
    }

    // Transcendence (opt-in, era-advancement only): reach the final era of the
    // spine AND hold a wonder — converting a tech/era lead into an alternate win
    // without a full conquest. "A wonder" is era-agnostic (any wonder_* building
    // the player owns) since the base-era wonder helper wouldn't track later eras.
    if (
      condition == null
      && allowed.includes('transcendence')
      && settings.era_advancement_enabled
      && (player.current_era_index ?? 0) >= getMaxEraIndex(state)
      && Object.values(state.territories).some(
        (t) => t.owner_id === player.player_id && (t.buildings ?? []).some((b) => b.startsWith('wonder_')),
      )
    ) {
      condition = 'transcendence';
    }

    if (condition != null) winners.push({ winnerIds: [player.player_id], condition });
  }

  // Stalemate guard, evaluated only when no real victory condition fired
  // this check: past the configured (normalized) turn cap, the strongest
  // position wins — most territories, tiebreak most total units. A player
  // completing a configured condition on the cap turn still takes precedence,
  // and the result is never mislabeled as turn_limit.
  const maxTurns = settings.max_turns;
  if (
    winners.length === 0 &&
    typeof maxTurns === 'number' &&
    maxTurns > 0 &&
    state.turn_number > maxTurns
  ) {
    const unitsByOwner = new Map<string, number>();
    for (const t of Object.values(state.territories)) {
      if (!t.owner_id) continue;
      unitsByOwner.set(t.owner_id, (unitsByOwner.get(t.owner_id) ?? 0) + t.unit_count);
    }
    const leader = [...activePlayers].sort((a, b) => {
      const territoryDiff = (b.territory_count ?? 0) - (a.territory_count ?? 0);
      if (territoryDiff !== 0) return territoryDiff;
      return (unitsByOwner.get(b.player_id) ?? 0) - (unitsByOwner.get(a.player_id) ?? 0);
    })[0];
    if (leader) return { winnerIds: [leader.player_id], condition: 'turn_limit' };
  }

  if (winners.length === 0) return null;
  if (winners.length === 1) return winners[0];

  // Tiebreak: most territories wins
  const result = pickWinnerAmong(winners.flatMap((w) => w.winnerIds), state);
  if (!result) return null;
  const winner = winners.find((w) => w.winnerIds.includes(result));
  return winner ?? null;
}

/**
 * Draw a territory card from the deck for a player.
 */
export function drawCard(state: GameState, playerId: string): void {
  if (state.card_deck.length === 0) {
    // Deck exhausted: recycle redeemed cards by reshuffling the discard pile
    // back in (classic Risk). The deck is only `territoryCount + 2` cards and is
    // never otherwise replenished, so without this it runs dry in long games and
    // capturing silently stops earning cards.
    if (state.discard_pile && state.discard_pile.length > 0) {
      state.card_deck = shuffleArray(state.discard_pile);
      state.discard_pile = [];
    }
    if (state.card_deck.length === 0) return;
  }
  const card = state.card_deck.shift()!;
  const player = state.players.find((p) => p.player_id === playerId);
  if (player) player.cards.push(card);
}

/**
 * Validate and redeem a card set, returning the bonus units awarded.
 */
export function redeemCardSet(
  state: GameState,
  playerId: string,
  cardIds: string[]
): number {
  if (cardIds.length !== 3) throw new Error('Must redeem exactly 3 cards');

  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) throw new Error('Player not found');

  const cards = cardIds.map((id) => {
    const card = player.cards.find((c) => c.card_id === id);
    if (!card) throw new Error(`Card ${id} not in player's hand`);
    return card;
  });

  if (!isValidCardSet(cards.map((c) => c.symbol))) {
    throw new Error('Invalid card set combination');
  }

  // Remove cards from hand and move them to the discard pile so they can be
  // reshuffled back into the deck once it empties (see drawCard).
  player.cards = player.cards.filter((c) => !cardIds.includes(c.card_id));
  (state.discard_pile ??= []).push(...cards);

  const bonus = getCardSetBonus(state.card_set_redemption_count, state.settings.card_set_bonus_cap);
  state.card_set_redemption_count++;
  // Per-player redemption tracking — used by post-game stats and by the
  // `card_shark` achievement. Centralised here so AI redemptions are counted
  // identically to human ones.
  player.cards_redeemed_count = (player.cards_redeemed_count ?? 0) + 1;
  player.card_set_bonus_units = (player.card_set_bonus_units ?? 0) + bonus;
  return bonus;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isValidCardSet(symbols: string[]): boolean {
  const nonWild = symbols.filter((s) => s !== 'wild');
  const uniqueNonWild = new Set(nonWild);
  // Three of a kind
  if (uniqueNonWild.size === 1) return true;
  // One of each
  if (uniqueNonWild.size === 3) return true;
  // Two of a kind + wild
  if (symbols.includes('wild') && uniqueNonWild.size <= 2) return true;
  return false;
}

/** First valid 3-card set: cards sorted by `card_id`, combinations tried in stable index order. */
export function findRedeemableCardIds(cards: TerritoryCard[]): string[] | null {
  if (cards.length < 3) return null;
  const sorted = [...cards].sort((a, b) => a.card_id.localeCompare(b.card_id));
  const n = sorted.length;
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const syms = [sorted[i].symbol, sorted[j].symbol, sorted[k].symbol];
        if (isValidCardSet(syms)) {
          return [sorted[i].card_id, sorted[j].card_id, sorted[k].card_id];
        }
      }
    }
  }
  return null;
}

export function buildCardDeck(territoryIds: string[]): TerritoryCard[] {
  const symbols: Array<'infantry' | 'cavalry' | 'artillery'> = ['infantry', 'cavalry', 'artillery'];
  const deck: TerritoryCard[] = territoryIds.map((tid, i) => ({
    card_id: uuidv4(),
    territory_id: tid,
    symbol: symbols[i % 3],
  }));
  // Add 2 wild cards
  deck.push({ card_id: uuidv4(), territory_id: null, symbol: 'wild' });
  deck.push({ card_id: uuidv4(), territory_id: null, symbol: 'wild' });
  return shuffleArray(deck);
}

function shuffleArray<T>(arr: T[]): T[] {
  // Cards in the territory deck affect game outcomes (set bonuses), so the
  // shuffle uses a CSPRNG to keep the order unpredictable to all clients.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deal each player their faction's whole home WORLD (no cross-world swaps from
 * `distributeTerritoriesGeographic` rebalance), when `resolveGalaxyHomeWorlds`
 * found one distinct world per seat — two to four seats. With fewer than four,
 * the other worlds were already set aside as neutral colonies (`map` here is
 * the distributable view), so this deals only the home worlds. Returns false so
 * callers fall back to geographic distribution.
 */
function tryDistributeGalaxyAgeFactionHomeworlds(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  players: Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>[],
  homeWorlds: readonly string[] | null,
  initialUnitCount: number,
): boolean {
  if (!homeWorlds || homeWorlds.length !== players.length) return false;

  for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
    const worldId = homeWorlds[playerIndex]!;
    const playerId = players[playerIndex]!.player_id;
    // Worlds as characters: a vault world's home faction starts without the
    // ring, so the rule pays them back in units on the tiles they do hold. Part
    // of the starting layout, like the neutral ring itself, so it does not
    // depend on `world_rules_enabled`.
    const homeBonus = map.worlds?.find((w) => w.world_id === worldId)?.rules?.vault?.home_unit_bonus ?? 0;
    let any = false;
    for (const t of map.territories) {
      if (t.world_id !== worldId) continue;
      const st = territories[t.territory_id];
      if (!st) return false;
      st.owner_id = playerId;
      st.unit_count = initialUnitCount + homeBonus;
      any = true;
    }
    if (!any) return false;
  }

  return true;
}

/**
 * Deal each Schism house its half of its home world (galaxySchism.ts), at the
 * initial unit count plus a Vault world's home-unit bonus, which pays for the
 * neutral ring as it does in the whole-world deal, plus the half's own opening
 * bonus. A lone house's unclaimed half is not in the distributable view: it
 * opens neutral. In an Allied Partial Schism each seat on a whole world is
 * dealt all of it, as at four seats. `map` is the distributable view. Returns
 * false so callers fall back to geographic distribution.
 */
function distributeSchismHouses(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  schism: GalaxySchismMode,
  initialUnitCount: number,
): boolean {
  const homeBonusOf = (worldId: string) =>
    map.worlds?.find((w) => w.world_id === worldId)?.rules?.vault?.home_unit_bonus ?? 0;
  const seats = schism.houses.length + (schism.whole_worlds?.length ?? 0);
  for (const house of schism.houses) {
    const opening = schismOpeningBonus(house, schism.relations, seats);
    const units = Math.max(1, initialUnitCount + homeBonusOf(house.world_id) + opening);
    const tiles = schismHouseTiles(house);
    if (tiles.length === 0) return false;
    for (const tid of tiles) {
      const st = territories[tid];
      if (!st) return false;
      st.owner_id = house.player_id;
      st.unit_count = units;
    }
  }
  for (const whole of schism.whole_worlds ?? []) {
    let any = false;
    for (const t of map.territories) {
      if (t.world_id !== whole.world_id) continue;
      const st = territories[t.territory_id];
      if (!st) return false;
      st.owner_id = whole.player_id;
      st.unit_count = initialUnitCount + homeBonusOf(whole.world_id);
      any = true;
    }
    if (!any) return false;
  }
  return true;
}

/**
 * Geographic territory distribution for faction-enabled games.
 *
 * Players should begin near their faction home regions, but no faction should gain a
 * runaway start simply because its metadata references more regions than another faction.
 * This balances both territory count and territory value while preserving geographic flavor.
 */
function distributeTerritoriesGeographic(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  players: Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>[],
  era: EraId,
  initialUnitCount: number
): void {
  const factions = getEraFactions(era);
  if (players.length === 0) return;

  const adjacency: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adjacency[conn.from]) adjacency[conn.from] = [];
    if (!adjacency[conn.to]) adjacency[conn.to] = [];
    adjacency[conn.from].push(conn.to);
    adjacency[conn.to].push(conn.from);
  }

  const territoryById = new Map(map.territories.map((territory) => [territory.territory_id, territory]));
  const playerIndexById = new Map(players.map((player, playerIndex) => [player.player_id, playerIndex]));
  const regionBonusById = new Map(map.regions.map((region) => [region.region_id, region.bonus]));
  const territoryIdsByRegion = new Map<string, string[]>();
  for (const territory of map.territories) {
    const current = territoryIdsByRegion.get(territory.region_id) ?? [];
    current.push(territory.territory_id);
    territoryIdsByRegion.set(territory.region_id, current);
  }

  const territoryValues = new Map<string, number>();
  for (const territory of map.territories) {
    const regionTerritories = territoryIdsByRegion.get(territory.region_id) ?? [];
    const regionBonus = regionBonusById.get(territory.region_id) ?? 0;
    territoryValues.set(
      territory.territory_id,
      1 + regionBonus / Math.max(1, regionTerritories.length),
    );
  }

  const playerHomeRegionSets = players.map((player) => {
    const faction = factions.find((entry) => entry.faction_id === player.faction_id);
    return new Set(faction?.home_region_ids ?? []);
  });
  const playersByRegion = new Map<string, number[]>();
  playerHomeRegionSets.forEach((regionSet, playerIndex) => {
    for (const regionId of regionSet) {
      const claimers = playersByRegion.get(regionId) ?? [];
      claimers.push(playerIndex);
      playersByRegion.set(regionId, claimers);
    }
  });

  const playerHomeIds: string[][] = players.map((_player, playerIndex) => {
    const preferredRegions = playerHomeRegionSets[playerIndex];
    return map.territories
      .filter((territory) => preferredRegions.has(territory.region_id))
      .map((territory) => territory.territory_id)
      .sort((left, right) => {
        const leftRegionId = territoryById.get(left)?.region_id ?? '';
        const rightRegionId = territoryById.get(right)?.region_id ?? '';
        const leftClaimers = playersByRegion.get(leftRegionId)?.length ?? 0;
        const rightClaimers = playersByRegion.get(rightRegionId)?.length ?? 0;
        if (leftClaimers !== rightClaimers) return leftClaimers - rightClaimers;

        const leftDegree = adjacency[left]?.length ?? 0;
        const rightDegree = adjacency[right]?.length ?? 0;
        if (leftDegree !== rightDegree) return rightDegree - leftDegree;

        return left.localeCompare(right);
      });
  });

  const targetCountBase = Math.floor(map.territories.length / players.length);
  const targetCountRemainder = map.territories.length % players.length;
  const targetCounts = players.map((_, playerIndex) => targetCountBase + (playerIndex < targetCountRemainder ? 1 : 0));
  const targetValue = [...territoryValues.values()].reduce((sum, value) => sum + value, 0) / players.length;

  const assigned = new Map<string, string>();
  const ownedCounts = players.map(() => 0);
  const ownedValues = players.map(() => 0);
  const ownedTerritories = players.map(() => new Set<string>());

  const assignTerritory = (territoryId: string, playerIndex: number) => {
    if (assigned.has(territoryId)) return;
    assigned.set(territoryId, players[playerIndex].player_id);
    ownedCounts[playerIndex] += 1;
    ownedValues[playerIndex] += territoryValues.get(territoryId) ?? 1;
    ownedTerritories[playerIndex].add(territoryId);
  };

  const chooseBestPlayer = (territoryId: string, candidates: number[]): number => {
    const regionId = territoryById.get(territoryId)?.region_id ?? '';
    return [...candidates].sort((left, right) => {
      const leftCountPressure = ownedCounts[left] / Math.max(1, targetCounts[left]);
      const rightCountPressure = ownedCounts[right] / Math.max(1, targetCounts[right]);
      if (leftCountPressure !== rightCountPressure) return leftCountPressure - rightCountPressure;

      const leftValuePressure = ownedValues[left] / Math.max(1, targetValue);
      const rightValuePressure = ownedValues[right] / Math.max(1, targetValue);
      if (leftValuePressure !== rightValuePressure) return leftValuePressure - rightValuePressure;

      const leftHome = playerHomeRegionSets[left].has(regionId) ? 1 : 0;
      const rightHome = playerHomeRegionSets[right].has(regionId) ? 1 : 0;
      if (leftHome !== rightHome) return rightHome - leftHome;

      if (ownedCounts[left] !== ownedCounts[right]) return ownedCounts[left] - ownedCounts[right];
      if (ownedValues[left] !== ownedValues[right]) return ownedValues[left] - ownedValues[right];
      return left - right;
    })[0] ?? candidates[0] ?? 0;
  };

  const getOwnedTerritoriesByPlayer = (ownership: Map<string, string>): string[][] => {
    const grouped = players.map(() => [] as string[]);
    for (const [territoryId, ownerId] of ownership.entries()) {
      const playerIndex = playerIndexById.get(ownerId);
      if (playerIndex != null) grouped[playerIndex].push(territoryId);
    }
    return grouped;
  };

  const getRegionBonusForOwnedTerritories = (ownedIds: Set<string>): number => {
    let bonus = 0;
    for (const region of map.regions) {
      const regionTerritories = territoryIdsByRegion.get(region.region_id) ?? [];
      if (regionTerritories.length > 0 && regionTerritories.every((territoryId) => ownedIds.has(territoryId))) {
        bonus += region.bonus;
      }
    }
    return bonus;
  };

  const getLargestConnectedComponentSize = (ownedIds: Set<string>): number => {
    const remaining = new Set(ownedIds);
    let largest = 0;
    while (remaining.size > 0) {
      const [start] = remaining;
      if (!start) break;
      const queue = [start];
      remaining.delete(start);
      let size = 0;
      while (queue.length > 0) {
        const current = queue.shift()!;
        size += 1;
        for (const adjacentId of adjacency[current] ?? []) {
          if (remaining.has(adjacentId)) {
            remaining.delete(adjacentId);
            queue.push(adjacentId);
          }
        }
      }
      largest = Math.max(largest, size);
    }
    return largest;
  };

  const scoreOwnership = (ownership: Map<string, string>): number[] => {
    const ownedByPlayer = getOwnedTerritoriesByPlayer(ownership);
    return ownedByPlayer.map((territoryIds, playerIndex) => {
      const ownedSet = new Set(territoryIds);
      const territoryValue = territoryIds.reduce((sum, territoryId) => sum + (territoryValues.get(territoryId) ?? 1), 0);
      const regionBonus = getRegionBonusForOwnedTerritories(ownedSet);
      const reinforcements = calculateReinforcements(territoryIds.length, regionBonus, players.length);

      let hostileEdges = 0;
      let seaEdges = 0;
      let homeOwned = 0;
      for (const territoryId of territoryIds) {
        const territory = territoryById.get(territoryId);
        if (territory && playerHomeRegionSets[playerIndex].has(territory.region_id)) {
          homeOwned += 1;
        }
        for (const connection of map.connections) {
          if (connection.from !== territoryId && connection.to !== territoryId) continue;
          const otherId = connection.from === territoryId ? connection.to : connection.from;
          if (!ownedSet.has(otherId)) hostileEdges += 1;
          if (connection.type === 'sea') seaEdges += 1;
        }
      }

      const cohesion = getLargestConnectedComponentSize(ownedSet);
      return territoryValue
        + reinforcements * 1.6
        + cohesion * 0.22
        + homeOwned * 0.18
        + seaEdges * 0.04
        - hostileEdges * 0.08;
    });
  };

  const rebalanceAssignedTerritories = () => {
    const maxIterations = Math.min(6, map.territories.length);
    const ownership = new Map(assigned);
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const scores = scoreOwnership(ownership);
      let strongestIndex = 0;
      let weakestIndex = 0;
      for (let playerIndex = 1; playerIndex < players.length; playerIndex++) {
        if (scores[playerIndex] > scores[strongestIndex]) strongestIndex = playerIndex;
        if (scores[playerIndex] < scores[weakestIndex]) weakestIndex = playerIndex;
      }

      const currentGap = scores[strongestIndex] - scores[weakestIndex];
      if (currentGap <= 1.5) break;

      const strongestOwned = getOwnedTerritoriesByPlayer(ownership)[strongestIndex] ?? [];
      const weakestOwned = new Set(getOwnedTerritoriesByPlayer(ownership)[weakestIndex] ?? []);
      const strongestHomeOwnedCount = strongestOwned.filter((territoryId) =>
        playerHomeRegionSets[strongestIndex].has(territoryById.get(territoryId)?.region_id ?? ''),
      ).length;
      const weakestHomeOwnedCount = [...weakestOwned].filter((territoryId) =>
        playerHomeRegionSets[weakestIndex].has(territoryById.get(territoryId)?.region_id ?? ''),
      ).length;

      const strongestCandidates = strongestOwned
        .filter((territoryId) => (adjacency[territoryId] ?? []).some((adjacentId) => weakestOwned.has(adjacentId)))
        .filter((territoryId) => {
          const regionId = territoryById.get(territoryId)?.region_id ?? '';
          if (!playerHomeRegionSets[strongestIndex].has(regionId)) return true;
          return strongestHomeOwnedCount > 1;
        })
        .sort((left, right) => {
          const leftHome = playerHomeRegionSets[strongestIndex].has(territoryById.get(left)?.region_id ?? '') ? 1 : 0;
          const rightHome = playerHomeRegionSets[strongestIndex].has(territoryById.get(right)?.region_id ?? '') ? 1 : 0;
          if (leftHome !== rightHome) return leftHome - rightHome;
          const leftValue = territoryValues.get(left) ?? 1;
          const rightValue = territoryValues.get(right) ?? 1;
          if (leftValue !== rightValue) return rightValue - leftValue;
          return left.localeCompare(right);
        });

      const weakestCandidates = [...weakestOwned]
        .filter((territoryId) => (adjacency[territoryId] ?? []).some((adjacentId) => ownership.get(adjacentId) === players[strongestIndex].player_id))
        .filter((territoryId) => {
          const regionId = territoryById.get(territoryId)?.region_id ?? '';
          if (!playerHomeRegionSets[weakestIndex].has(regionId)) return true;
          return weakestHomeOwnedCount > 1;
        })
        .sort((left, right) => {
          const leftHome = playerHomeRegionSets[weakestIndex].has(territoryById.get(left)?.region_id ?? '') ? 1 : 0;
          const rightHome = playerHomeRegionSets[weakestIndex].has(territoryById.get(right)?.region_id ?? '') ? 1 : 0;
          if (leftHome !== rightHome) return rightHome - leftHome;
          const leftValue = territoryValues.get(left) ?? 1;
          const rightValue = territoryValues.get(right) ?? 1;
          if (leftValue !== rightValue) return leftValue - rightValue;
          return left.localeCompare(right);
        });

      let bestSwap:
        | { fromStrongest: string; fromWeakest: string; gap: number }
        | null = null;

      for (const strongestTerritory of strongestCandidates.slice(0, 8)) {
        for (const weakestTerritory of weakestCandidates.slice(0, 8)) {
          const trialOwnership = new Map(ownership);
          trialOwnership.set(strongestTerritory, players[weakestIndex].player_id);
          trialOwnership.set(weakestTerritory, players[strongestIndex].player_id);
          const trialScores = scoreOwnership(trialOwnership);
          const trialGap = Math.max(...trialScores) - Math.min(...trialScores);
          if (trialGap + 0.25 < currentGap && (!bestSwap || trialGap < bestSwap.gap)) {
            bestSwap = {
              fromStrongest: strongestTerritory,
              fromWeakest: weakestTerritory,
              gap: trialGap,
            };
          }
        }
      }

      if (!bestSwap) break;
      ownership.set(bestSwap.fromStrongest, players[weakestIndex].player_id);
      ownership.set(bestSwap.fromWeakest, players[strongestIndex].player_id);
    }

    assigned.clear();
    for (const [territoryId, ownerId] of ownership.entries()) {
      assigned.set(territoryId, ownerId);
    }
  };

  const allTerritoryIds = map.territories
    .map((territory) => territory.territory_id)
    .sort((left, right) => {
      const leftDegree = adjacency[left]?.length ?? 0;
      const rightDegree = adjacency[right]?.length ?? 0;
      if (leftDegree !== rightDegree) return rightDegree - leftDegree;
      return left.localeCompare(right);
    });

  const seedOrder = players.map((_, playerIndex) => playerIndex).sort((left, right) => {
    const leftChoices = playerHomeIds[left]?.length ?? 0;
    const rightChoices = playerHomeIds[right]?.length ?? 0;
    if (leftChoices !== rightChoices) return leftChoices - rightChoices;
    return left - right;
  });

  for (const playerIndex of seedOrder) {
    const preferredSeed = playerHomeIds[playerIndex].find((territoryId) => !assigned.has(territoryId));
    const fallbackSeed = allTerritoryIds.find((territoryId) => !assigned.has(territoryId));
    const seedTerritoryId = preferredSeed ?? fallbackSeed;
    if (seedTerritoryId) assignTerritory(seedTerritoryId, playerIndex);
  }

  const unassigned = new Set(allTerritoryIds.filter((territoryId) => !assigned.has(territoryId)));
  const frontiers = ownedTerritories.map((territorySet) => new Set(territorySet));

  while (unassigned.size > 0) {
    const waveClaims = new Map<string, number[]>();
    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      if (ownedCounts[playerIndex] >= targetCounts[playerIndex]) continue;
      for (const territoryId of frontiers[playerIndex]) {
        for (const adjacentId of adjacency[territoryId] ?? []) {
          if (!unassigned.has(adjacentId)) continue;
          const claimers = waveClaims.get(adjacentId) ?? [];
          if (!claimers.includes(playerIndex)) claimers.push(playerIndex);
          waveClaims.set(adjacentId, claimers);
        }
      }
    }

    if (waveClaims.size === 0) break;

    const nextFrontiers: string[][] = players.map(() => []);
    const waveTerritories = [...waveClaims.keys()].sort((left, right) => {
      const leftValue = territoryValues.get(left) ?? 1;
      const rightValue = territoryValues.get(right) ?? 1;
      if (leftValue !== rightValue) return rightValue - leftValue;
      return left.localeCompare(right);
    });

    for (const territoryId of waveTerritories) {
      const allCandidates = waveClaims.get(territoryId) ?? [];
      // Re-filter mid-wave: skip players who already hit their target during this wave
      const underQuota = allCandidates.filter((p) => ownedCounts[p] < targetCounts[p]);
      const candidates = underQuota.length > 0 ? underQuota : allCandidates;
      const playerIndex = chooseBestPlayer(territoryId, candidates);
      assignTerritory(territoryId, playerIndex);
      unassigned.delete(territoryId);
      nextFrontiers[playerIndex].push(territoryId);
    }

    nextFrontiers.forEach((territoryIds, playerIndex) => {
      frontiers[playerIndex] = new Set(territoryIds);
    });
  }

  for (const territoryId of [...unassigned].sort((left, right) => {
    const leftValue = territoryValues.get(left) ?? 1;
    const rightValue = territoryValues.get(right) ?? 1;
    if (leftValue !== rightValue) return rightValue - leftValue;
    return left.localeCompare(right);
  })) {
    const underQuotaPlayers = players
      .map((_, playerIndex) => playerIndex)
      .filter((playerIndex) => ownedCounts[playerIndex] < targetCounts[playerIndex]);
    const playerIndex = chooseBestPlayer(
      territoryId,
      underQuotaPlayers.length > 0 ? underQuotaPlayers : players.map((_, playerIndex) => playerIndex),
    );
    assignTerritory(territoryId, playerIndex);
    unassigned.delete(territoryId);
  }

  rebalanceAssignedTerritories();

  // Hard count-equalization: after all geographic logic, ensure no player has 2+ more
  // territories than any other player. Transfer (not swap) territories from the most-
  // over-quota player to the most-under-quota player until the gap is <= 1.
  const equalizeTerritoryCounts = () => {
    const actualCounts = players.map(() => 0);
    for (const ownerId of assigned.values()) {
      const idx = playerIndexById.get(ownerId);
      if (idx != null) actualCounts[idx]++;
    }

    for (let pass = 0; pass < map.territories.length; pass++) {
      let maxCount = -Infinity;
      let minCount = Infinity;
      let richest = 0;
      let poorest = 0;
      for (let i = 0; i < players.length; i++) {
        if (actualCounts[i] > maxCount) { maxCount = actualCounts[i]; richest = i; }
        if (actualCounts[i] < minCount) { minCount = actualCounts[i]; poorest = i; }
      }
      if (maxCount - minCount < 2) break;

      const poorestOwnedSet = new Set(
        [...assigned.entries()]
          .filter(([, id]) => id === players[poorest].player_id)
          .map(([tid]) => tid),
      );

      const richestOwned = [...assigned.entries()]
        .filter(([, id]) => id === players[richest].player_id)
        .map(([tid]) => tid);

      // Prefer territories adjacent to the poorest player's holdings (promotes contiguity).
      const adjacentToPoort = richestOwned.filter((tid) =>
        (adjacency[tid] ?? []).some((adj) => poorestOwnedSet.has(adj)),
      );
      const pool = adjacentToPoort.length > 0 ? adjacentToPoort : richestOwned;

      // Among candidates: non-home first, then lowest value.
      pool.sort((a, b) => {
        const aHome = playerHomeRegionSets[richest].has(territoryById.get(a)?.region_id ?? '') ? 1 : 0;
        const bHome = playerHomeRegionSets[richest].has(territoryById.get(b)?.region_id ?? '') ? 1 : 0;
        if (aHome !== bHome) return aHome - bHome;
        return (territoryValues.get(a) ?? 1) - (territoryValues.get(b) ?? 1);
      });

      const transferId = pool[0];
      if (!transferId) break;

      assigned.set(transferId, players[poorest].player_id);
      actualCounts[richest]--;
      actualCounts[poorest]++;
    }
  };

  equalizeTerritoryCounts();

  for (const [territoryId, playerId] of assigned.entries()) {
    territories[territoryId].owner_id = playerId;
    territories[territoryId].unit_count = initialUnitCount;
  }
}

