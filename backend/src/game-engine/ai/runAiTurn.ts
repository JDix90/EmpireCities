/**
 * One bot turn, from the draft to the last fortify move: the rules a bot plays
 * by, with no socket in sight. The live game (gameSocket.ts processAiTurn) and
 * the headless harnesses run this same code, so a harness measures the bot
 * players actually meet, and a rule change reaches both at once.
 *
 * Everything the live game does around the rules (broadcasting the board,
 * animations, saving, stats, the 600 ms pacing between steps, finalizing a won
 * game) arrives as a hook. The harness passes headlessAiTurnHooks: no pacing,
 * no broadcasts, and a victory check that only marks the state.
 *
 * The turn hand-off (advanceToNextPlayer and what follows it) stays with the
 * caller, which also decides where an away seat resumes.
 */
import { EMERGENCY_SEAL_ABILITY_ID, GALAXY_LANE_SEAL_DURATION, canSealLane, connectionRequiresMoonAccess, fortifyEndpointsRequireOrbitAccess, getOrbitAccessResult, isLaneSealedForPlayer, laneSealDuration, laneSealHelium3Cost, laneSealTick, syncLaunchPadLanes } from '../state/moonAccess';
import { TARGETED_DRAFT_ABILITIES, TERRITORY_ABILITY_DEFS, getFortifyMoveLimit, getInfluenceUnitCost, isOwnedTerritoryAdjacentToEnemy, playerHasUnlockedAbility } from '../abilities/techAbilities';
import { aiAttackExchangeBudget, runAiAttackExchanges, shouldPressDecidedGame } from './aiAttackGrind';
import { aiFiresLanePowers, canAiFireLanePower, selectAiLanceBatteryTarget, selectAiOrbitalMusterTarget, selectAiSealBreaker, selectAiSurgeProjector } from './aiLanePowers';
import { appendWinProbabilitySnapshot, checkVictory, drawCard, findRedeemableCardIds, redeemCardSet, syncTerritoryCounts } from '../state/gameStateManager';
import { applyBombElimination, selectAiAtomBombStrike } from './aiAtomBomb';
import { applyBuild } from '../state/economyManager';
import { applyGarrisonDoctrine, garrisonsEnabled, validateGarrisonDoctrine } from '../state/garrisonDoctrines';
import { applyResearch, getEraTechTreeForPlayer, validateResearch } from '../state/techManager';
import { areMoonPowersEnabled } from '../abilities/moonPowers';
import { attachCombatAbilityCallouts, buildCombatAbilityCallouts } from '../combat/combatAbilityCallouts';
import { buildCombatMapVisual, buildEraAdvanceMapVisual, buildFortifyMapVisual, buildNavalMapVisual, buildReinforceMapVisual } from '../visuals/mapVisualEvents';
import { buildStrikeAnimationPayload } from '../abilities/strikeAnimation';
import { canAiUseDropAssault, canAiUseDysonBeam, canAiUseOrbitalDrop, selectAiDropAssaultTarget, selectAiDysonBeamTarget, selectAiLaneSeal, selectAiOrbitalDropTarget, shouldAiExportHelium3 } from './aiMoonPowers';
import { chooseEmergencySealLane, selectAiBuildingPlacement, selectAiGarrisonDoctrines, selectAiTechResearch } from './aiBot';
import { consumeSealBreaker, lanePowersEnabled } from '../abilities/lanePowers';
import { createPuzzleDieRoll } from '../daily/puzzleDice';
import { dailySiegeTarget } from '../daily/dailySiege';
import { eliminatePlayer } from '../state/elimination';
import { evaluateAiEraAdvancement } from './aiEraAdvancement';
import { executeAdvanceEra } from '../eraAdvancement/advanceEra';
import { executeLandAttack } from '../combat/executeLandAttack';
import { executeTechAbility, isGameScopedAbility } from '../abilities/executeTechAbility';
import { fortifyBecomesConvoy, launchConvoy } from '../state/transit';
import { getDeployCap, onInfluenceStabilityPenalty } from '../state/stabilityManager';
import { getEraIdForAdvancementIndex } from '../eraAdvancement/constants';
import { getInfluenceHopLimit, isTerritoryReachableWithinHops } from '../state/influenceManager';
import { getMarchToSeaBonus, recordMarchToSeaResult } from '../combat/combatModifiers';
import { getPlayerEraModifiers } from '../state/eraModifiers';
import { getPlayerFaction } from '../eras/factionLineage';
import { getWonderInfluenceRange } from '../state/wonderManager';
import { isShieldedFrom } from '../state/teams';
import { playerHoldsVaultSeal, worldDeployCapBonus } from '../state/worldRules';
import { resolveSeaCrossing } from '../state/navalManager';
import { shouldSpendTechPointsOnAbility } from './aiTechBudget';
import { syncJumpGateLanes } from '../state/jumpGates';
import { syncSurgeProjectorLanes } from '../state/surgeProjector';
import { unlockTerritoriesForFloor } from '../eraAdvancement/territoryUnlock';
import type { AiAction, AiTurnOptions } from './aiBot';
import { aiProfile, type AiLevel } from './aiProfiles';
import type { EraId, GameMap, GameState, PlayerState } from '../../types';
import type { MapVisualEventPayload } from '../visuals/mapVisualEvents';
import type { StrikeAnimationPayload } from '../abilities/strikeAnimation';

/** The live feature flags a bot turn reads, threaded in so a harness can set them per seat. */
export interface AiTurnFlags {
  captureOddsScoring: boolean;
  attackGrind: boolean;
  decidedGamePress: boolean;
}

/** How planning reaches the board: the view the bot may see, and the planner to run on it. */
export interface AiPlanHooks {
  /** The board as this seat sees it (the fog-filtered view when fog of war is on). */
  planningState(): GameState;
  plan(state: GameState, map: GameMap, difficulty: AiLevel, options: AiTurnOptions): Promise<AiAction[]>;
}

/** Everything a bot turn does besides the rules themselves. */
export interface AiTurnHooks {
  /** The pause between paced steps; throws to abandon the turn. */
  delay(): Promise<void>;
  /** True when the game has just ended, in which case the turn stops at once. */
  victoryCheck(): Promise<boolean>;
  broadcast(): void;
  persist(): void;
  emit(event: string, payload: unknown): void;
  spectatorEvent(event: string, payload: unknown): void;
  visual(event: Omit<MapVisualEventPayload, 'id'>): void;
  strikeVisuals(payload: StrikeAnimationPayload): void;
  launchPadLane(territoryId: string): Promise<void>;
  eraBoardChange(nextEraId: EraId): Promise<void>;
  /** The map itself changed (a Surge Projector lane): save and send it. */
  mapChanged(): Promise<void>;
  /** A territory was just captured: re-sync the jump-gate lanes. */
  afterCapture(): Promise<void>;
  /** The attack phase is over: close any Surge Projector lane. */
  surgeLanesClosed(): Promise<void>;
  recordCombat(
    defenderId: string | null,
    result: { attacker_losses: number; defender_losses: number; territory_captured: boolean },
    options: { isSea?: boolean },
  ): void;
  recordElimination(): void;
}

export interface AiTurnPlan {
  actions: AiAction[];
  /** Dice exchanges left this turn; spent across every attack. */
  attackBudget: { left: number };
  attackGrind: boolean;
}

/** Plan the turn: the planner's ranked actions and the turn's attack budget. */
export async function planAiTurn(
  state: GameState,
  map: GameMap,
  currentPlayer: PlayerState,
  difficulty: AiLevel,
  flags: AiTurnFlags,
  hooks: AiPlanHooks,
): Promise<AiTurnPlan> {
  const planningState = hooks.planningState();
  // Decided-game escape: when this AI already holds the game (win probability
  // past the threshold), it presses to finish instead of dribbling exchanges
  // while the loser lingers. Computed from the AUTHORITATIVE state, not the
  // fog-filtered planning view: it gates pacing, never targeting, and masked
  // unit counts would distort the army share and trigger the press spuriously.
  // A daily build or research day: the bot besieges the human seat and
  // presses as if the game were decided (daily/dailySiege.ts). Mirrored in
  // puzzleSim.aiTurn — the AI-parity rule.
  const siege = dailySiegeTarget(state);
  const decidedPress =
    !!siege ||
    (flags.decidedGamePress &&
      shouldPressDecidedGame(state, currentPlayer.player_id, difficulty));

  // The flags are threaded explicitly because planning may run in a worker
  // thread, where the admin-config override cache is not loaded.
  const actions = await hooks.plan(planningState, map, difficulty, {
    captureOddsScoring: flags.captureOddsScoring,
    decidedGamePress: decidedPress,
    siege,
  });

  // Attack budget for the whole turn, spent in dice exchanges. The planner's
  // ranked candidate list is a priority order; this is what actually limits how
  // much fighting happens, so a turn that grinds one hard target does fewer
  // separate attacks rather than more total exchanges.
  const attackBudget = {
    left: flags.attackGrind
      ? aiAttackExchangeBudget(difficulty, decidedPress)
      : Number.POSITIVE_INFINITY,
  };
  return { actions, attackBudget, attackGrind: flags.attackGrind };
}

/**
 * Play a planned turn from `resumeAt` through the last fortify move. Returns
 * 'over' when the game ended during the turn (the caller must not hand it on),
 * otherwise 'done'.
 */
export async function playAiTurn(
  state: GameState,
  map: GameMap,
  currentPlayer: PlayerState,
  difficulty: AiLevel,
  plan: AiTurnPlan,
  resumeAt: 'draft' | 'attack' | 'fortify',
  hooks: AiTurnHooks,
): Promise<'done' | 'over'> {
  const { actions, attackBudget: aiAttackBudget, attackGrind: aiAttackGrindEnabled } = plan;

  // ── Draft Phase ────────────────────────────────────────────────────────
  if (resumeAt === 'draft') {
  state.phase = 'draft';

  // Economy FIRST: build + research before evaluating advancement, so a bot that
  // satisfies the milestone gate this turn can advance the SAME turn (previously
  // the advance check ran before that turn's research, costing a turn each climb).
  if (state.settings.economy_enabled || state.settings.tech_trees_enabled) {
    if (state.settings.economy_enabled) {
      const buildDecision = selectAiBuildingPlacement(state, map, currentPlayer.player_id, difficulty);
      if (buildDecision) {
        applyBuild(state, currentPlayer.player_id, buildDecision.territoryId, buildDecision.buildingType);
        if (buildDecision.buildingType === 'launch_pad') {
          await hooks.launchPadLane(buildDecision.territoryId);
        }
      }
    }
    if (state.settings.tech_trees_enabled) {
      const techId = selectAiTechResearch(state, currentPlayer.player_id, difficulty);
      if (techId) {
        const techValidation = validateResearch(state, currentPlayer.player_id, techId);
        if (techValidation.valid && techValidation.node) {
          applyResearch(state, currentPlayer.player_id, techValidation.node);
        }
      }
    }
    // Garrison doctrines (state/garrisonDoctrines.ts): bought after the plan is
    // made and before its attacks, so a Forward garrison is in place for the
    // crossing it was bought for. Same validator as the human handler.
    if (state.settings.economy_enabled && garrisonsEnabled(state)) {
      for (const pick of selectAiGarrisonDoctrines(state, map, currentPlayer.player_id, difficulty, actions)) {
        if (validateGarrisonDoctrine(state, currentPlayer.player_id, pick.territoryId, pick.doctrine).valid) {
          applyGarrisonDoctrine(state, currentPlayer.player_id, pick.territoryId, pick.doctrine);
        }
      }
    }
    hooks.broadcast();
    // A wonder can complete Transcendence: the bot wins now, as a human would.
    if (await hooks.victoryCheck()) return 'over';
  }

  if (
    state.settings.era_advancement_enabled
    && !aiProfile(difficulty).passive
    && evaluateAiEraAdvancement(state, map, currentPlayer.player_id, difficulty).shouldAdvance
  ) {
    const advanceResult = executeAdvanceEra(state, currentPlayer.player_id, map);
    if (advanceResult.success) {
      const nextEraId = getEraIdForAdvancementIndex(state, currentPlayer.current_era_index ?? 0);
      hooks.visual(buildEraAdvanceMapVisual({
        playerId: currentPlayer.player_id,
        eraId: nextEraId,
        state,
      }));
      // Territory growth: an AI reaching a new era can open the same neutral
      // frontiers for everyone (global, first-to-reach). Re-emit the projected
      // map before broadcastState so clients render the additions (or the whole
      // board recomposition under the board-transform flag).
      await hooks.eraBoardChange(nextEraId);
      hooks.broadcast();
      hooks.persist();
      // Reaching the final era can complete Transcendence.
      if (await hooks.victoryCheck()) return 'over';
      await hooks.delay();
    }
  }

  if (!aiProfile(difficulty).passive) {
    for (;;) {
      const ids = findRedeemableCardIds(currentPlayer.cards);
      if (!ids) break;
      try {
        const bonus = redeemCardSet(state, currentPlayer.player_id, ids);
        state.draft_units_remaining += bonus;
        // Room-wide, so the table can note it; `playerId` is what stops every
        // human client from taking the toast and the bonus as its own.
        hooks.emit('game:cards_redeemed', { bonus, playerId: currentPlayer.player_id });
        await hooks.delay();
        hooks.broadcast();
        hooks.persist();
      } catch {
        break;
      }
    }
  }

  // AI parity for draft-phase faction abilities (Mass Mobilization, Group A free
  // units, Group B tech-gated placement, Group C reinforcement/economy boosts).
  // Activated BEFORE placement so draft-pool boosters (spice_trade, total_war,
  // imperial_diet) get placed this turn. Reuses executeTechAbility for exact
  // human/bot parity. Free abilities are used eagerly — they only ever help —
  // but tech-costed ones go through shouldSpendTechPointsOnAbility, which keeps
  // back the price of the bot's next research (see aiTechBudget.ts).
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    const factionAbilityId = aiFaction?.ability_id;
    const factionDef = factionAbilityId ? TERRITORY_ABILITY_DEFS[factionAbilityId] : undefined;
    const draftAbilityIds = new Set([
      'mass_mobilization', 'total_war', 'peoples_war', 'imperial_diet', 'silk_road', 'house_of_wisdom',
    ]);
    const isDraftAbility = !!factionAbilityId && !!factionDef && factionDef.phase === 'draft'
      && (draftAbilityIds.has(factionAbilityId) || !!factionDef.ownPlacement || !!factionDef.draftReinforcements);
    const gameScoped = !!factionAbilityId && isGameScopedAbility(factionAbilityId);
    const alreadyUsed = !!factionAbilityId && (gameScoped
      ? (currentPlayer.used_game_abilities ?? []).includes(factionAbilityId)
      : !!(currentPlayer.ability_uses ?? {})[factionAbilityId]);
    const techCost = factionDef?.techCost ?? 0;
    const affordable = shouldSpendTechPointsOnAbility(
      state, currentPlayer.player_id, difficulty, techCost,
    );
    if (factionAbilityId && isDraftAbility && !alreadyUsed && affordable) {
      // `ownPlacement` is not the only way a draft ability needs a territory:
      // mass_mobilization and royal_decree take one in executeTechAbility
      // without advertising it here. Deriving this from ownPlacement alone
      // handed them `undefined` and the call failed silently below.
      const needsTarget = !!factionDef?.ownPlacement
        || TARGETED_DRAFT_ABILITIES.has(factionAbilityId);
      const requiresMoon = factionDef?.ownPlacement?.requiresMoon ?? false;
      const requiresProduction = factionDef?.ownPlacement?.requiresProductionBuilding ?? false;
      const requiresEnemyAdjacent = factionDef?.ownPlacement?.requiresEnemyAdjacent ?? false;
      const target = needsTarget
        ? Object.values(state.territories)
            .filter((t) => t.owner_id === currentPlayer.player_id
              && (!requiresMoon || t.world_id === 'moon' || t.globe_id === 'moon')
              && (!requiresProduction || (t.buildings ?? []).some((b) => b.startsWith('production')))
              && (!requiresEnemyAdjacent
                || isOwnedTerritoryAdjacentToEnemy(state, map, currentPlayer.player_id, t.territory_id)))
            .sort((a, b) => b.unit_count - a.unit_count)[0]
        : undefined;
      if (!needsTarget || target) {
        const res = executeTechAbility({
          state,
          map,
          playerId: currentPlayer.player_id,
          abilityId: factionAbilityId,
          territoryId: target?.territory_id,
        });
        if (res.success) {
          if (!gameScoped) {
            currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), [factionAbilityId]: 1 };
          }
          hooks.broadcast();
        }
      }
    }
  }

  const firstDraftIdx = actions.findIndex(
    (a) => a.type === 'draft' && a.to && a.units != null,
  );
  if (firstDraftIdx >= 0) {
    actions[firstDraftIdx].units = state.draft_units_remaining;
  } else if (state.draft_units_remaining > 0) {
    const owned = Object.keys(state.territories).find(
      (tid) => state.territories[tid].owner_id === currentPlayer.player_id,
    );
    if (owned) {
      const endIdx = actions.findIndex((a) => a.type === 'end_phase');
      const draftAction = { type: 'draft' as const, to: owned, units: state.draft_units_remaining };
      if (endIdx >= 0) actions.splice(endIdx, 0, draftAction);
      else actions.unshift(draftAction);
    }
  }

  for (const action of actions) {
    if (action.type !== 'draft' || !action.to || !action.units) continue;
    await hooks.delay();
    const t = state.territories[action.to];
    let clamped = Math.min(action.units, state.draft_units_remaining);
    if (t && state.settings.stability_enabled) {
      const cap = getDeployCap(t.stability, {
        era: state.era,
        turnNumber: state.turn_number,
        economyEnabled: !!state.settings.economy_enabled,
        playerSpecialResource: currentPlayer.special_resource ?? 0,
        worldDeployCapBonus: worldDeployCapBonus(state, t.world_id),
      });
      const placements = state.draft_placements_this_turn ?? {};
      const alreadyPlaced = placements[action.to] ?? 0;
      clamped = Math.min(clamped, Math.max(0, cap - alreadyPlaced));
    }
    if (t && t.owner_id === currentPlayer.player_id && clamped > 0) {
      t.unit_count += clamped;
      state.draft_units_remaining -= clamped;
      if (state.settings.stability_enabled) {
        state.draft_placements_this_turn = state.draft_placements_this_turn ?? {};
        state.draft_placements_this_turn[action.to] = (state.draft_placements_this_turn[action.to] ?? 0) + clamped;
      }
      hooks.visual(buildReinforceMapVisual({
        territoryId: action.to,
        units: clamped,
        totalAfter: t.unit_count,
        playerId: currentPlayer.player_id,
        state,
      }));
    }
    hooks.broadcast();
  }

  // Place any remaining draft units while respecting stability caps per territory.
  if (state.draft_units_remaining > 0) {
    const ownedIds = Object.keys(state.territories).filter(
      (tid) => state.territories[tid].owner_id === currentPlayer.player_id,
    );
    let placedAny = true;
    while (state.draft_units_remaining > 0 && placedAny) {
      placedAny = false;
      for (const tid of ownedIds) {
        if (state.draft_units_remaining <= 0) break;
        const territory = state.territories[tid];
        if (!territory) continue;
        if (state.settings.stability_enabled) {
          const cap = getDeployCap(territory.stability, {
            era: state.era,
            turnNumber: state.turn_number,
            economyEnabled: !!state.settings.economy_enabled,
            playerSpecialResource: currentPlayer.special_resource ?? 0,
            worldDeployCapBonus: worldDeployCapBonus(state, territory.world_id),
          });
          const placements = state.draft_placements_this_turn ?? {};
          const alreadyPlaced = placements[tid] ?? 0;
          if (alreadyPlaced >= cap) continue;
          state.draft_placements_this_turn = state.draft_placements_this_turn ?? {};
          state.draft_placements_this_turn[tid] = alreadyPlaced + 1;
        }
        territory.unit_count += 1;
        state.draft_units_remaining -= 1;
        placedAny = true;
      }
    }
    hooks.broadcast();
  }

  // (AI build + research run at the top of the draft phase, before the advance check.)

  // AI parity: Orbital Drop — Phase 2's draft-phase power. Runs BEFORE the
  // export below, which only converts what the powers do not need: a bot that
  // exported first would never hold the 8 He-3 this costs.
  if (areMoonPowersEnabled(state) && canAiUseOrbitalDrop(state, currentPlayer.player_id)) {
    const dropTarget = selectAiOrbitalDropTarget(state, map, currentPlayer.player_id);
    if (dropTarget) {
      const res = executeTechAbility({
        state,
        map,
        playerId: currentPlayer.player_id,
        abilityId: 'orbital_drop',
        territoryId: dropTarget,
      });
      if (res.success) {
        currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), orbital_drop: 1 };
        hooks.broadcast();
      }
    }
  }

  // AI parity: Orbital Muster — the galaxy's draft-phase lane power
  // (abilities/lanePowers.ts). Through executeTechAbility, which checks the
  // gateway, its industry building and the purse and charges the PP, exactly
  // as for a human.
  if (
    aiFiresLanePowers(difficulty)
    && canAiFireLanePower(state, currentPlayer.player_id, 'orbital_muster')
  ) {
    const musterAt = selectAiOrbitalMusterTarget(state, map, currentPlayer.player_id);
    if (musterAt) {
      const res = executeTechAbility({
        state, map, playerId: currentPlayer.player_id, abilityId: 'orbital_muster', territoryId: musterAt,
      });
      if (res.success) {
        currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), orbital_muster: 1 };
        hooks.broadcast();
      }
    }
  }

  // AI parity: Drop Assault — Phase 2b. Declared here and landing at the start
  // of the bot's next turn, through exactly the path a human declaration takes,
  // so the telegraph and the defender's round to answer it are identical.
  if (areMoonPowersEnabled(state) && canAiUseDropAssault(state, currentPlayer.player_id)) {
    const assaultTarget = selectAiDropAssaultTarget(state, currentPlayer.player_id);
    if (assaultTarget) {
      const res = executeTechAbility({
        state,
        map,
        playerId: currentPlayer.player_id,
        abilityId: 'drop_assault',
        territoryId: assaultTarget,
      });
      if (res.success) {
        currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), drop_assault: 1 };
        hooks.broadcast();
      }
    }
  }

  // AI parity: Lunar Export — Phase 1's He-3 sink. Fires only on a full
  // conversion so the bot does not spend its one use per turn on a single
  // point; the stockpile cap means hoarding past 30 is wasted anyway. Under
  // Phase 2 it converts only the surplus over what the bot is saving for its
  // powers (aiMoonPowers.ts); with Phase 2 off the rule is Phase 1's exactly.
  if (shouldAiExportHelium3(state, map, currentPlayer.player_id)) {
    executeTechAbility({
      state,
      map,
      playerId: currentPlayer.player_id,
      abilityId: 'lunar_export',
    });
  }

  // AI parity: Launch Space Station — the third rung of the Moon ladder. The AI
  // researches the ladder (aiBot tech hook) and builds the Launch Pad (aiBot
  // build list); this fires the once-per-game launch as soon as both are in
  // place, so an AI can finish the orbit-access race like a human can.
  // executeTechAbility validates the tech, phase, and Launch Pad ownership.
  // It MUST run while the phase is still draft: the executor rejects launches
  // during the attack phase, and this block previously ran after the phase
  // transition below — every AI launch attempt failed silently, so bots never
  // reached the Moon (0 launches across 120 simulated games; see
  // backend/scripts/simSpaceAgeBalance.ts SIM_LAUNCH_PHASE=attack).
  if (
    state.era === 'space_age'
    && !currentPlayer.space_station_launched
    && (currentPlayer.unlocked_techs?.includes('sa_space_station') ?? false)
  ) {
    const res = executeTechAbility({
      state,
      map,
      playerId: currentPlayer.player_id,
      abilityId: 'launch_space_station',
    });
    if (res.success && res.effect === 'space_station_launched' && res.territoryId) {
      const launchPayload = {
        playerId: currentPlayer.player_id,
        playerName: currentPlayer.username,
        playerColor: currentPlayer.color,
        launchTerritoryId: res.territoryId,
      };
      hooks.emit('game:space_station_launched', launchPayload);
      hooks.spectatorEvent('game:space_station_launched', launchPayload);
    }
  }

  } // resumeAt === 'draft'

  // ── Attack Phase ───────────────────────────────────────────────────────
  if (resumeAt !== 'fortify') {
  state.draft_units_remaining = 0;
  state.phase = 'attack';

  // ACW AI: activate March to the Sea once per game on entering the attack phase
  // so the bot benefits from the same chain bonus dice a human would. The bonus
  // only ever helps, so eager activation is a safe parity baseline.
  if (
    state.settings.tech_trees_enabled &&
    playerHasUnlockedAbility(state, currentPlayer.player_id, 'march_to_sea') &&
    !(currentPlayer.used_game_abilities ?? []).includes('march_to_sea')
  ) {
    currentPlayer.march_to_sea_active = true;
    currentPlayer.march_to_sea_hops_used = 0;
    currentPlayer.march_to_sea_last_capture_id = null;
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), 'march_to_sea'];
  }

  // AI parity for Emergency Seal (Void Custodians): before attacking, close the
  // Nexus lane whose far end holds the biggest rival stack, so the bot answers
  // a landing the way a human would. Reuses canSealLane and the same
  // ability_uses ledger as the human handler.
  {
    // Emergency Seal: the Custodians' faction charge, or the Vault holder's
    // (any faction) — one charge a turn either way, any lane for the Vault.
    const sealFaction = state.settings.factions_enabled && currentPlayer.faction_id
      ? getPlayerFaction(state, currentPlayer)
      : undefined;
    const vaultSeal = playerHoldsVaultSeal(state, currentPlayer.player_id);
    if (
      (sealFaction?.ability_id === EMERGENCY_SEAL_ABILITY_ID || vaultSeal)
      && !(currentPlayer.ability_uses ?? {})[EMERGENCY_SEAL_ABILITY_ID]
    ) {
      const best = chooseEmergencySealLane(state, map, currentPlayer.player_id);
      if (best) {
        const check = canSealLane(state, map, best.from, best.to, currentPlayer.player_id, sealFaction?.ability_id, {
          vaultHolder: vaultSeal,
        });
        if (check.ok && check.laneId) {
          if (!state.lane_blockades) state.lane_blockades = {};
          state.lane_blockades[check.laneId] = {
            owner_id: currentPlayer.player_id,
            turns_remaining: GALAXY_LANE_SEAL_DURATION,
            tick: 'owner_turn',
          };
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), [EMERGENCY_SEAL_ABILITY_ID]: 1 };
          hooks.broadcast();
        }
      }
    }
  }

  // AI parity for the galaxy's attack-phase lane powers (abilities/lanePowers.ts).
  // Lance Battery softens the far gateway of a planned crossing; Seal Breaker
  // opens a shut lane the bot can win across, and Surge Projector a ring gap
  // into a weakly held gateway, each crossing planned first. All go through
  // executeTechAbility, as a human's do.
  if (aiFiresLanePowers(difficulty) && lanePowersEnabled(state)) {
    if (canAiFireLanePower(state, currentPlayer.player_id, 'seal_breaker')) {
      const breach = selectAiSealBreaker(state, map, currentPlayer.player_id);
      if (breach) {
        const res = executeTechAbility({
          state, map, playerId: currentPlayer.player_id, abilityId: 'seal_breaker', territoryId: breach.source,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), seal_breaker: 1 };
          const firstAttack = actions.findIndex((a) => a.type === 'attack');
          const crossing = { type: 'attack' as const, from: breach.source, to: breach.target, units: 3 };
          if (firstAttack < 0) actions.push(crossing);
          else actions.splice(firstAttack, 0, crossing);
          hooks.broadcast();
        }
      }
    }
    // Surge Projector: open a ring gap into a weakly held rival gateway and
    // plan that crossing first. The ability puts the lane on the map copy.
    if (canAiFireLanePower(state, currentPlayer.player_id, 'surge_projector')) {
      const surge = selectAiSurgeProjector(state, map, currentPlayer.player_id);
      if (surge) {
        const res = executeTechAbility({
          state, map, playerId: currentPlayer.player_id, abilityId: 'surge_projector', territoryId: surge.target,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), surge_projector: 1 };
          const firstAttack = actions.findIndex((a) => a.type === 'attack');
          const crossing = { type: 'attack' as const, from: surge.source, to: surge.target, units: 3 };
          if (firstAttack < 0) actions.push(crossing);
          else actions.splice(firstAttack, 0, crossing);
          await hooks.mapChanged();
          hooks.broadcast();
        }
      }
    }
    if (canAiFireLanePower(state, currentPlayer.player_id, 'lance_battery')) {
      const lanceAt = selectAiLanceBatteryTarget(state, map, currentPlayer.player_id, actions);
      if (lanceAt) {
        const res = executeTechAbility({
          state, map, playerId: currentPlayer.player_id, abilityId: 'lance_battery', territoryId: lanceAt,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), lance_battery: 1 };
          const targetOwner = res.previousOwner
            ? state.players.find((p) => p.player_id === res.previousOwner)
            : undefined;
          hooks.strikeVisuals(buildStrikeAnimationPayload({
            abilityId: 'lance_battery',
            attackerId: currentPlayer.player_id,
            attackerName: currentPlayer.username,
            attackerColor: currentPlayer.color,
            territoryId: lanceAt,
            targetOwnerId: res.previousOwner ?? null,
            targetOwnerName: targetOwner?.username ?? null,
          }));
          hooks.broadcast();
        }
      }
    }
  }

  // AI parity for faction unit-reduction strikes (precision_airstrike, longbowmen,
  // chevauchée, privateer, cyber_attack). Used once per turn on the AI's first
  // planned enemy attack target to soften it before assaulting — reuses
  // executeTechAbility so reduction / range / coastal rules match the human path.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    const strikeId = aiFaction?.ability_id;
    const strikeDef = strikeId ? TERRITORY_ABILITY_DEFS[strikeId] : undefined;
    if (
      strikeId && strikeDef && strikeDef.phase === 'attack' && strikeDef.unitReduction != null
      && !(currentPlayer.ability_uses ?? {})[strikeId]
    ) {
      const firstAttack = actions.find(
        (a) => a.type === 'attack' && a.from && a.from !== '__influence__' && a.to
          && state.territories[a.to]?.owner_id != null
          && state.territories[a.to]?.owner_id !== currentPlayer.player_id,
      );
      if (firstAttack?.to) {
        const res = executeTechAbility({
          state,
          map,
          playerId: currentPlayer.player_id,
          abilityId: strikeId,
          territoryId: firstAttack.to,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), [strikeId]: 1 };
        }
      }
    }
  }

  // WW2 Manhattan Project, Phase 1 (ai/aiAtomBomb.ts): under `ww2_bomb_ai`, a
  // bot holding a bomb fires it at the tile worth the most to destroy, through
  // the executor a human's goes through, and walks in when it has a stack
  // beside the tile. Without the setting nothing here runs.
  {
    const strike = selectAiAtomBombStrike(state, map, currentPlayer.player_id);
    if (strike) {
      const res = executeTechAbility({
        state,
        map,
        playerId: currentPlayer.player_id,
        abilityId: 'atom_bomb',
        territoryId: strike.territoryId,
      });
      if (res.success) {
        // Under the atomic arsenal the bomb is once per turn, recorded as the
        // human handler records every turn-scoped ability.
        if (!isGameScopedAbility('atom_bomb', state)) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), atom_bomb: 1 };
        }
        // A carried charge is spent, as the human handler spends it.
        if (currentPlayer.legacy_ability_charges?.atom_bomb) {
          const remaining = { ...currentPlayer.legacy_ability_charges };
          delete remaining.atom_bomb;
          currentPlayer.legacy_ability_charges = remaining;
        }
        const victimId = res.previousOwner ?? null;
        const victim = victimId ? state.players.find((p) => p.player_id === victimId) : undefined;
        if (applyBombElimination(state, currentPlayer.player_id, victimId)) {
          hooks.recordElimination();
          hooks.emit('game:player_eliminated', {
            playerId: victimId,
            eliminatorId: currentPlayer.player_id,
            eliminatorName: currentPlayer.username,
            eliminatedName: victim?.username,
            secretMission: victim?.secret_mission ?? null,
          });
        }
        hooks.strikeVisuals(buildStrikeAnimationPayload({
          abilityId: 'atom_bomb',
          attackerId: currentPlayer.player_id,
          attackerName: currentPlayer.username,
          attackerColor: currentPlayer.color,
          territoryId: strike.territoryId,
          targetOwnerId: victimId,
          targetOwnerName: victim?.username ?? null,
        }));
        hooks.broadcast();
        if (await hooks.victoryCheck()) return 'over';
        if (strike.walkInFrom) {
          actions.unshift({ type: 'attack', from: strike.walkInFrom, to: strike.territoryId });
        }
        await hooks.delay();
      }
    }
  }

  // AI parity: Dyson Beam — Phase 2's attack-phase power. The bot fires it at
  // the largest enemy stack bordering its own ground, which is the one it is
  // about to have to fight; the beam is global, but fuel spent on a stack the
  // bot will never reach is fuel wasted (aiMoonPowers.ts).
  //
  // This is the first tech-unlocked strike ability the AI has ever used — the
  // existing parity blocks cover FACTION abilities only, so an unlocked
  // nuclear_strike or orbital_strike still sits idle in a bot's hands. Widening
  // that is its own change; here it is scoped to the Moon tier so the Phase 2
  // control run stays today's game exactly.
  if (areMoonPowersEnabled(state) && canAiUseDysonBeam(state, currentPlayer.player_id)) {
    const beamTarget = selectAiDysonBeamTarget(state, map, currentPlayer.player_id);
    if (beamTarget) {
      const res = executeTechAbility({
        state,
        map,
        playerId: currentPlayer.player_id,
        abilityId: 'dyson_beam',
        territoryId: beamTarget,
      });
      if (res.success) {
        currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), dyson_beam: 1 };
        const targetOwner = res.previousOwner
          ? state.players.find((p) => p.player_id === res.previousOwner)
          : undefined;
        // Same visuals a human beam gets: a bot firing the era's loudest power
        // should not be silent on everyone else's screen.
        hooks.strikeVisuals(buildStrikeAnimationPayload({
          abilityId: 'dyson_beam',
          attackerId: currentPlayer.player_id,
          attackerName: currentPlayer.username,
          attackerColor: currentPlayer.color,
          territoryId: beamTarget,
          targetOwnerId: res.previousOwner ?? null,
          targetOwnerName: targetOwner?.username ?? null,
        }));
        hooks.broadcast();
      }
    }
  }

  // AI parity: Orbital Blockade — Phase 4. A bot holding lunar ground seals an
  // authored anchor lane when it can spare the He-3, through the same
  // canSealLane the human path uses, so the Launch Pad exclusion and the
  // endpoint rule apply identically.
  {
    const seal = selectAiLaneSeal(state, map, currentPlayer.player_id);
    if (seal) {
      const check = canSealLane(state, map, seal[0], seal[1], currentPlayer.player_id);
      if (check.ok && check.laneId) {
        currentPlayer.helium3 = (currentPlayer.helium3 ?? 0) - laneSealHelium3Cost(state);
        if (!state.lane_blockades) state.lane_blockades = {};
        state.lane_blockades[check.laneId] = {
          owner_id: currentPlayer.player_id,
          turns_remaining: laneSealDuration(state),
          tick: laneSealTick(state),
        };
        hooks.broadcast();
      }
    }
  }

  // AI parity: Unification Drive converts a reachable neutral territory for free.
  // executeTechAbility enforces the influence-range reachability check, so the AI
  // scans neutral territories and takes the first one it can legally unify.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    if (aiFaction?.ability_id === 'unification_drive' && !(currentPlayer.ability_uses ?? {})['unification_drive']) {
      for (const tid of Object.keys(state.territories)) {
        if (state.territories[tid].owner_id != null) continue;
        const res = executeTechAbility({
          state,
          map,
          playerId: currentPlayer.player_id,
          abilityId: 'unification_drive',
          territoryId: tid,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), unification_drive: 1 };
          break;
        }
      }
    }
  }

  hooks.broadcast();

  for (const action of actions) {
    if (action.type !== 'attack' || !action.from || !action.to) continue;

    // ── AI influence action (sentinel from === '__influence__') ──
    if (action.from === '__influence__') {
      if ((state.influence_cooldown_remaining ?? 0) > 0) continue;
      const modifiers = getPlayerEraModifiers(state, currentPlayer.player_id);
      const canInfluence = modifiers.influence_spread || modifiers.carbonari_network;
      if (!canInfluence) continue;

      const target = state.territories[action.to];
      if (!target || target.owner_id === currentPlayer.player_id) continue;
      if (isShieldedFrom(state, currentPlayer.player_id, target.owner_id)) continue;
      // Papal Dispensation parity: the Papal States blocks the first influence
      // attempt against it each turn (consumes the per-turn charge).
      if (target.owner_id && state.settings.factions_enabled) {
        const defender = state.players.find((p) => p.player_id === target.owner_id);
        const defFaction = defender
          ? getPlayerFaction(state, defender)
          : undefined;
        if (defFaction?.ability_id === 'papal_dispensation' && defender && !defender.influence_block_used_this_turn) {
          defender.influence_block_used_this_turn = true;
          hooks.broadcast();
          continue;
        }
      }
      if (target.unit_count > 3) continue;
      const aiTechTree = state.settings.tech_trees_enabled
        ? getEraTechTreeForPlayer(state, currentPlayer.player_id)
        : [];
      const aiHopLimit = getInfluenceHopLimit({
        baseHopLimit: modifiers?.influence_range ?? 1,
        unlockedTechs: currentPlayer.unlocked_techs ?? [],
        techTree: aiTechTree,
        wonderRangeBonus: state.settings.economy_enabled
          ? getWonderInfluenceRange(state, currentPlayer.player_id)
          : 0,
      });
      const aiOwnedIds = Object.entries(state.territories)
        .filter(([, t]) => t.owner_id === currentPlayer.player_id)
        .map(([id]) => id);
      if (!isTerritoryReachableWithinHops({
        map,
        ownedTerritoryIds: aiOwnedIds,
        targetId: action.to,
        hopLimit: aiHopLimit,
      })) continue;

      // Cost: need 3 spare units; deduct from adjacent owned territories
      const adjacency: Record<string, string[]> = {};
      for (const conn of map.connections) {
        if (!adjacency[conn.from]) adjacency[conn.from] = [];
        if (!adjacency[conn.to]) adjacency[conn.to] = [];
        adjacency[conn.from].push(conn.to);
        adjacency[conn.to].push(conn.from);
      }

      // Use the same cost the human path pays so proxy_funding's discount (3 → 2)
      // applies to the AI too, instead of a hardcoded 3.
      const influenceCost = getInfluenceUnitCost(state, currentPlayer.player_id);
      const totalUnits = Object.values(state.territories)
        .filter((t) => t.owner_id === currentPlayer.player_id)
        .reduce((sum, t) => sum + t.unit_count, 0);
      if (totalUnits < influenceCost + 1) continue;

      const adjacentOwned = (adjacency[action.to] ?? [])
        .filter((nid) => state.territories[nid]?.owner_id === currentPlayer.player_id)
        .sort((a, b) => (state.territories[b]?.unit_count ?? 0) - (state.territories[a]?.unit_count ?? 0));
      if (adjacentOwned.length === 0) continue;

      let remaining = influenceCost;
      for (const tid of adjacentOwned) {
        const t = state.territories[tid];
        if (!t) continue;
        const canSpend = Math.max(0, Math.min(remaining, t.unit_count - 1));
        if (canSpend === 0) continue;
        t.unit_count -= canSpend;
        remaining -= canSpend;
        if (remaining <= 0) break;
      }
      if (remaining > 0) continue;

      const previousOwner = target.owner_id;
      target.owner_id = currentPlayer.player_id;
      target.unit_count = 1;
      state.influence_cooldown_remaining = 3;

      // Stability penalty on AI influence capture
      if (state.settings.stability_enabled) {
        onInfluenceStabilityPenalty(state, action.to);
      }

      syncTerritoryCounts(state);

      if (previousOwner) {
        const prevPlayer = state.players.find((p) => p.player_id === previousOwner);
        if (prevPlayer && prevPlayer.territory_count === 0) {
          eliminatePlayer(prevPlayer, currentPlayer.player_id);
          currentPlayer.cards.push(...prevPlayer.cards);
          prevPlayer.cards = [];
          hooks.recordElimination();
          hooks.emit('game:player_eliminated', {
            playerId: previousOwner,
            eliminatorId: currentPlayer.player_id,
            eliminatorName: currentPlayer.username,
            eliminatedName: prevPlayer.username,
            secretMission: prevPlayer.secret_mission ?? null,
          });
        }
      }

      hooks.broadcast();
      if (await hooks.victoryCheck()) return 'over';
      continue;
    }

    await hooks.delay();
    // Hoisted so the grind callback below closes over plain strings: TypeScript
    // cannot carry the narrowing from the `action.type` guard into an async
    // closure.
    const attackFromId: string = action.from;
    const attackToId: string = action.to;
    const from = state.territories[attackFromId];
    const to = state.territories[attackToId];
    if (!from || !to || from.unit_count < 2 || from.owner_id !== currentPlayer.player_id) continue;
    if (to.owner_id === currentPlayer.player_id) continue;
    // No friendly fire, nor attacks across the opening ceasefire (state/teams.ts).
    // executeLandAttack refuses them too, but a sea crossing below would already
    // have fought the defender's fleet.
    if (isShieldedFrom(state, currentPlayer.player_id, to.owner_id)) continue;

    const aiConnection = map.connections.find(
      (c) => (c.from === attackFromId && c.to === attackToId) || (c.from === attackToId && c.to === attackFromId),
    );

    // Orbit/Moon access parity: the AI must satisfy the same access requirement a
    // human does to attack across a moon/orbit connection. Without this, a stale or
    // mis-planned action could let the bot invade worlds humans cannot reach.
    if (connectionRequiresMoonAccess(map, attackFromId, attackToId)) {
      if (!getOrbitAccessResult(state, currentPlayer, map, state.era).allowed) continue;
    }
    // Lane powers: the planner only plans a shut lane when a Seal Breaker was
    // fired from its source; the crossing spends that charge, as a human's does.
    // Guarded on the setting so a game without powers runs exactly as before.
    if (
      lanePowersEnabled(state)
      && aiConnection?.type === 'orbit'
      && isLaneSealedForPlayer(state, attackFromId, attackToId, currentPlayer.player_id)
      && !consumeSealBreaker(currentPlayer, attackFromId)
    ) continue;

    // Naval sea-lane gating: AI must have a fleet to cross. Amphibious-assault
    // parity with the human handler — the AI lands as long as a ship survives
    // the crossing, taking the same surviving-fleet bombardment penalty.
    let aiNavalBombardmentDefenseBonus = 0;
    if (state.settings.naval_enabled && aiConnection?.type === 'sea') {
      if (!from.naval_units || from.naval_units <= 0) continue;
      const aiCrossing = resolveSeaCrossing(from, to);
      if (aiCrossing.navalResult) {
        hooks.emit('game:naval_combat_result', { fromId: attackFromId, toId: attackToId, result: aiCrossing.navalResult });
        hooks.spectatorEvent('game:naval_combat_result', { fromId: attackFromId, toId: attackToId, result: aiCrossing.navalResult });
        hooks.visual(buildNavalMapVisual({
          fromId: attackFromId,
          toId: attackToId,
          attackerId: currentPlayer.player_id,
          attackerLosses: aiCrossing.navalResult.attacker_losses,
          defenderLosses: aiCrossing.navalResult.defender_losses,
          attackerWon: aiCrossing.navalResult.attacker_won,
          state,
        }));
      }
      if (!aiCrossing.canLand) continue;
      aiNavalBombardmentDefenseBonus = aiCrossing.bombardmentDefenseBonus;
    }

    const aiDefenderId = to.owner_id;

    // Truce-break retaliation parity: if a player broke a truce with this AI, the
    // AI's next attack against them gets the stored +1 die — same as the human path.
    let aiTruceRetaliationBonus = 0;
    if (aiDefenderId && currentPlayer.truce_break_retaliations) {
      const retalIdx = currentPlayer.truce_break_retaliations.findIndex(
        (r) => r.against_player_id === aiDefenderId,
      );
      if (retalIdx !== -1) {
        aiTruceRetaliationBonus = currentPlayer.truce_break_retaliations[retalIdx].dice_bonus;
        currentPlayer.truce_break_retaliations.splice(retalIdx, 1);
      }
    }

    // Attack self-buff parity: activate the faction attack buff once per turn
    // (executeLandAttack then consumes it, exactly as the human handler does).
    maybeActivateAiAttackSelfBuff(state, map, currentPlayer);
    const aiMarchToSeaBonus = getMarchToSeaBonus(currentPlayer, attackFromId);

    // Grind this edge until it falls or the turn's exchange budget runs out.
    //
    // The budget counts EXCHANGES, not edges: one executeLandAttack removes at
    // most two defenders, so attacking each planned edge exactly once left any
    // 3+ unit territory uncapturable by the AI at every difficulty. Spending the
    // same number of exchanges on the best target instead is the whole fix; the
    // per-exchange delay() below is unchanged, so turn length is too.
    //
    // Sea lanes are deliberately excluded: the crossing, its fleet losses and
    // its bombardment penalty are once-per-action, and repeating an exchange
    // would silently reuse them.
    const grindOutcome = await runAiAttackExchanges({
      state,
      attackerId: currentPlayer.player_id,
      fromId: attackFromId,
      toId: attackToId,
      budget: aiAttackBudget,
      canGrind: aiAttackGrindEnabled && aiConnection?.type !== 'sea',
      betweenExchanges: hooks.delay,
      exchange: async (exchangeIndex) => {
        // A fresh scripted die per exchange — the queue is consumed, not reused.
        const aiPuzzleDieRoll = state.puzzle_dice_queue?.length ? createPuzzleDieRoll(state) : undefined;

        // Single source of truth for the land exchange — shared with the human
        // handler and the balance sim. Socket-only concerns (callouts, stat
        // recording, elimination broadcast, visuals) stay here, around the call.
        const aiOutcome = executeLandAttack(state, currentPlayer.player_id, attackFromId, attackToId, {
          connection: aiConnection,
          dieRoll: aiPuzzleDieRoll,
          // Same orbit-access rule the human handler applies (moon capture parity).
          neutralOffworldCaptureAllowed: getOrbitAccessResult(state, currentPlayer, map, state.era).allowed,
          extraAttackBonuses: {
            march_to_sea: aiMarchToSeaBonus,
            // Spliced out of the player once; it must not re-apply on every grind
            // exchange against the same target.
            truce_retaliation: exchangeIndex === 0 ? aiTruceRetaliationBonus : 0,
          },
          extraDefenseBonuses: {
            naval_bombardment: aiNavalBombardmentDefenseBonus,
          },
          onCapture: (s, pid) => {
            // One card per turn — gated by state flag (see advanceToNextPlayer reset).
            if (!currentPlayer.card_earned_this_turn) {
              drawCard(s, pid);
              currentPlayer.card_earned_this_turn = true;
            }
          },
        });
        if (!aiOutcome) return 'stop';
        const result = aiOutcome.result;

        attachCombatAbilityCallouts(
          result,
          buildCombatAbilityCallouts({
            state,
            attackerId: currentPlayer.player_id,
            toId: attackToId,
            attackBuffs: aiOutcome.attackBuffs,
            abilityUses: currentPlayer.ability_uses,
            rawAttackerLosses: aiOutcome.rawAttackerLosses,
          }),
        );

        // If resolveCombat returned an error, skip this attack (state was not mutated).
        if (result.error) {
          console.warn?.('AI attempted invalid combat:', result.error, { from: from.unit_count, to: to.unit_count });
          return 'stop';
        }
        hooks.recordCombat(aiDefenderId ?? null, result, {
          isSea: aiConnection?.type === 'sea',
        });
        recordMarchToSeaResult(currentPlayer, aiMarchToSeaBonus > 0, attackToId, result.territory_captured);
        // Elimination broadcast (cards already transferred + is_eliminated set inside executeLandAttack).
        if (aiOutcome.defenderEliminated) {
          const defenderPlayer = state.players.find((p) => p.player_id === aiDefenderId);
          if (defenderPlayer) {
            hooks.recordElimination();
            hooks.emit('game:player_eliminated', {
              playerId: aiDefenderId,
              eliminatorId: currentPlayer.player_id,
              eliminatorName: currentPlayer.username,
              eliminatedName: defenderPlayer.username,
              secretMission: defenderPlayer.secret_mission ?? null,
            });
          }
        }
        syncTerritoryCounts(state);
        hooks.emit('game:combat_result', { fromId: attackFromId, toId: attackToId, result });
        hooks.visual(buildCombatMapVisual({
          fromId: attackFromId,
          toId: attackToId,
          attackerId: currentPlayer.player_id,
          defenderId: aiDefenderId,
          attackerLosses: result.attacker_losses,
          defenderLosses: result.defender_losses,
          territoryCaptured: result.territory_captured,
          state,
        }));
        hooks.broadcast();
        if (result.territory_captured) await hooks.afterCapture();

        if (await hooks.victoryCheck()) return 'abort_turn';
        if (result.territory_captured) {
          const defP = state.players.find((p) => p.player_id === aiDefenderId);
          if (defP?.is_eliminated) appendWinProbabilitySnapshot(state);
        }
        return 'ok';
      },
    });
    if (grindOutcome.aborted) return 'over';
    if (aiAttackGrindEnabled && aiAttackBudget.left <= 0) break;
  }
  } // resumeAt !== 'fortify'

  // ── Fortify Phase ──────────────────────────────────────────────────────
  // A resumed fortify keeps the moves its player already made.
  if (resumeAt !== 'fortify') state.fortify_moves_used = 0;
  state.phase = 'fortify';
  // A Surge Projector lane is an attack-phase lane: it closes now.
  await hooks.surgeLanesClosed();

  // AI parity: Armored Push grants +1 fortify move. Activate it only when the AI
  // has more fortify moves planned than its base limit allows, so the extra move
  // is actually used. Reuses executeTechAbility for human/bot parity.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    if (aiFaction?.ability_id === 'armored_push' && !(currentPlayer.ability_uses ?? {})['armored_push']) {
      const plannedFortifies = actions.filter(
        (a) => a.type === 'fortify' && a.from && a.to && a.units,
      ).length;
      if (plannedFortifies > getFortifyMoveLimit(state, currentPlayer.player_id)) {
        const res = executeTechAbility({ state, map, playerId: currentPlayer.player_id, abilityId: 'armored_push' });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), armored_push: 1 };
        }
      }
    }
  }

  hooks.broadcast();

  const aiFortifyMoveLimit = getFortifyMoveLimit(state, currentPlayer.player_id);
  for (const action of actions) {
    if (action.type !== 'fortify' || !action.from || !action.to || !action.units) continue;
    // Honor the same per-turn fortify move cap humans get (game:fortify), so an AI
    // planner that emits multiple moves can't exceed the era/tech limit.
    if ((state.fortify_moves_used ?? 0) >= aiFortifyMoveLimit) break;
    await hooks.delay();
    const from = state.territories[action.from];
    const to = state.territories[action.to];
    // Orbit/Moon parity: don't let the AI fortify across worlds without access.
    // AI fortify moves are not path-validated, so an arbitrary owned pair lands
    // here — the endpoint test is the only gate on this path, which is why it
    // compares worlds and not just the direct edge.
    if (fortifyEndpointsRequireOrbitAccess(map, state.era, action.from, action.to)
      && !getOrbitAccessResult(state, currentPlayer, map, state.era).allowed) {
      continue;
    }
    if (from && to && from.owner_id === currentPlayer.player_id && to.owner_id === currentPlayer.player_id && from.unit_count > action.units) {
      // Same rule as the human path: a cross-world move is a convoy.
      if (fortifyBecomesConvoy(state, action.from, action.to)) {
        launchConvoy(state, currentPlayer.player_id, action.from, action.to, action.units);
      } else {
        from.unit_count -= action.units;
        to.unit_count += action.units;
      }
      state.fortify_moves_used = (state.fortify_moves_used ?? 0) + 1;
      hooks.visual(buildFortifyMapVisual({
        fromTerritoryId: action.from,
        toTerritoryId: action.to,
        units: action.units,
        playerId: currentPlayer.player_id,
        state,
      }));
    }
    hooks.broadcast();
  }

  return 'done';
}

/**
 * AI parity for attack-phase faction self-buffs (war_elephants / banzai_charge /
 * ambush = +1 attack die; testudo = negate attacker losses). Activates the buff
 * once per turn by reusing executeTechAbility, so the buff is then consumed by the
 * AI attack loop exactly as a human's would be. These buffs only ever help, so
 * eager activation before the first attack is a safe parity baseline.
 */
function maybeActivateAiAttackSelfBuff(state: GameState, map: GameMap, player: PlayerState): void {
  if (!state.settings.factions_enabled || !player.faction_id) return;
  const faction = getPlayerFaction(state, player);
  const abilityId = faction?.ability_id;
  if (!abilityId) return;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def || def.phase !== 'attack') return;
  if (def.selfBuff !== 'extra_attack_die' && def.selfBuff !== 'negate_attacker_losses') return;
  if ((player.ability_uses ?? {})[abilityId]) return;
  const res = executeTechAbility({ state, map, playerId: player.player_id, abilityId });
  if (res.success) {
    player.ability_uses = { ...(player.ability_uses ?? {}), [abilityId]: 1 };
  }
}

/**
 * Hooks for a turn with nobody watching: no pacing, broadcasts, saves or
 * visuals, and a victory check that marks the state game over as the live game
 * does (without finalizing anything). For harnesses and tests.
 *
 * The board changes the live hooks make still happen, from the same engine
 * calls: territories an era unlocks, and the lanes a Launch Pad opens, a
 * capture re-links (jump gates) or the attack phase closes (a Surge Projector).
 * Not the era board transform, which loads the next era's map from the
 * database; a harness leaves `era_advancement_board_transform` off.
 */
export function headlessAiTurnHooks(state: GameState, map: GameMap): AiTurnHooks {
  const none = async (): Promise<void> => {};
  return {
    delay: none,
    victoryCheck: async () => {
      const victory = checkVictory(state, map);
      if (!victory) return false;
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0]!;
      state.winner_ids = victory.winnerIds;
      state.victory_condition = victory.condition;
      return true;
    },
    broadcast: () => {},
    persist: () => {},
    emit: () => {},
    spectatorEvent: () => {},
    visual: () => {},
    strikeVisuals: () => {},
    launchPadLane: async (territoryId) => {
      if (state.territories[territoryId]?.buildings?.includes('launch_pad')) syncLaunchPadLanes(map, state);
    },
    eraBoardChange: async () => {
      unlockTerritoriesForFloor(state, map);
    },
    mapChanged: none,
    afterCapture: async () => {
      syncJumpGateLanes(map, state);
      syncSurgeProjectorLanes(map, state);
    },
    surgeLanesClosed: async () => {
      syncSurgeProjectorLanes(map, state);
    },
    recordCombat: () => {},
    recordElimination: () => {},
  };
}
