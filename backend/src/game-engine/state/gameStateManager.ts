import { v4 as uuidv4 } from 'uuid';
import type {
  GameState, PlayerState, TerritoryState, TerritoryCard,
  GameMap, GameSettings, EraId, DiplomacyEntry, WinProbabilitySnapshot,
  EraModifiers, VictoryConditionKey,
} from '../../types';
import { getEraFactions } from '../eras';
import { calculateReinforcements, getCardSetBonus } from '../combat/combatResolver';
import { getAllowedVictoryConditions, normalizeGameSettings } from './gameSettings';
import { collectProduction } from './economyManager';
import { applyTechPointIncome, getPlayerReinforceBonus } from './techManager';
import { getEraDeck, drawRandomCard, applyEventEffect, tickTemporaryModifiers } from '../events/eventCardManager';
import { getActiveSeasonalDeck } from '../events/seasonalDecks';
import { initializeNavalUnits, collectFleetIncome } from './navalManager';
import { initializeStability, applyStabilityTick } from './stabilityManager';
import { getWonderReinforceBonus, applyWonderProductionIncome } from './wonderManager';
import {
  assignCapitals,
  assignSecretMissions,
  createSeededRng,
  hashStringToSeed,
  isMissionComplete,
} from '../victory/missions';

const ERA_DEFAULTS: Partial<Record<EraId, EraModifiers>> = {
  ancient:      { legion_reroll: true },
  medieval:     {},
  discovery:    { sea_lanes: true },
  ww2:          { wartime_logistics: true },
  coldwar:      { influence_spread: true, influence_range: 1 },
  modern:       { precision_strike: true },
  acw:          { rifle_doctrine: true },
  risorgimento: { carbonari_network: true, influence_range: 1 },
};

/**
 * Initialize a brand-new GameState from a map and player list.
 */
export function initializeGameState(
  gameId: string,
  era: EraId,
  map: GameMap,
  players: Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>[],
  settings: GameSettings
): GameState {
  const settingsNorm = normalizeGameSettings(settings);
  const territories: Record<string, TerritoryState> = {};

  // Build territory state — all unowned initially
  for (const t of map.territories) {
    territories[t.territory_id] = {
      territory_id: t.territory_id,
      owner_id: null,
      unit_count: 0,
      unit_type: 'infantry',
    };
  }

  // Assign factions to players (unique picks, resolve conflicts with dice roll) when enabled
  if (settingsNorm.factions_enabled) {
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
        // Dice roll: pick one at random
        const winnerIdx = indices[Math.floor(Math.random() * indices.length)];
        players[winnerIdx].faction_id = factionId;
        assignedFactions.add(factionId);
        // The rest go to unassigned pool
        indices.forEach((idx) => {
          if (idx !== winnerIdx) unassignedPlayers.push(idx);
        });
      }
    });

    // Assign remaining players to random available factions
    const availableFactions = eraFactions.map(f => f.faction_id).filter(f => !assignedFactions.has(f));
    // Shuffle for fairness
    for (let i = availableFactions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableFactions[i], availableFactions[j]] = [availableFactions[j], availableFactions[i]];
    }
    unassignedPlayers.forEach((idx, i) => {
      players[idx].faction_id = availableFactions[i] ?? null;
      if (availableFactions[i]) assignedFactions.add(availableFactions[i]);
    });
  }

  // Distribute territories — skip when territory_selection enabled (players pick manually)
  const territoryIds = Object.keys(territories);
  if (settingsNorm.territory_selection) {
    // All territories stay neutral; players will pick during 'territory_select' phase
  } else if (settingsNorm.factions_enabled) {
    distributeTerritoriesGeographic(territories, map, players, era, settingsNorm.initial_unit_count);
  } else {
    const shuffled = shuffleArray([...territoryIds]);
    shuffled.forEach((tid, idx) => {
      const playerIndex = idx % players.length;
      territories[tid].owner_id = players[playerIndex].player_id;
      territories[tid].unit_count = settingsNorm.initial_unit_count;
    });
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

  const playerStates: PlayerState[] = players.map((p) => ({
    ...p,
    territory_count: Object.values(territories).filter((t) => t.owner_id === p.player_id).length,
    cards: [],
    capital_territory_id: null,
    secret_mission: null,
    // Economy / tech initial values
    tech_points: settingsNorm.tech_trees_enabled ? 0 : undefined,
    special_resource: (settingsNorm.tech_trees_enabled || settingsNorm.economy_enabled) ? 0 : undefined,
    unlocked_techs: [],
    ability_uses: {},
  }));

  // Initialize buildings array on territories when economy is enabled
  if (settingsNorm.economy_enabled) {
    for (const t of Object.values(territories)) {
      t.buildings = [];
    }
  }

  const firstPlayer = playerStates[0];
  const isTerritorySelect = !!settingsNorm.territory_selection;
  const continentBonus = isTerritorySelect ? 0 : calculateContinentBonusesForPlayer(territories, map, firstPlayer.player_id);
  const initialDraft = isTerritorySelect ? 0 : calculateReinforcements(
    firstPlayer.territory_count,
    continentBonus,
    playerStates.length,
  );

  const state: GameState = {
    game_id: gameId,
    era,
    map_id: map.map_id,
    phase: isTerritorySelect ? 'territory_select' : 'draft',
    current_player_index: 0,
    turn_number: 1,
    players: playerStates,
    territories,
    card_deck: cardDeck,
    card_set_redemption_count: 0,
    diplomacy,
    settings: settingsNorm,
    draft_units_remaining: initialDraft,
    turn_started_at: Date.now(),
    win_probability_history: [],
    era_modifiers: { ...(ERA_DEFAULTS[era] ?? {}) },
    fortify_moves_used: 0,
    influence_cooldown_remaining: 0,
    blitzkrieg_attacked: false,
  };

  const allowed = getAllowedVictoryConditions(settingsNorm);
  if (allowed.includes('capital')) {
    assignCapitals(state);
  }
  if (allowed.includes('secret_mission')) {
    const seed = hashStringToSeed(`${gameId}:secret_missions`);
    assignSecretMissions(state, map, createSeededRng(seed));
  }

  // Initialize naval units on coastal territories when naval warfare is enabled
  if (settingsNorm.naval_enabled) {
    initializeNavalUnits(state, map);
  }

  // Initialize stability values when stability feature is enabled
  if (settingsNorm.stability_enabled) {
    initializeStability(state);
  }

  // Inject seasonal event cards into the game-start deck
  if (settingsNorm.events_enabled) {
    const seasonal = getActiveSeasonalDeck(era, new Date());
    if (seasonal.length > 0) {
      // Seasonal cards are stored on the game state and merged into the era deck when drawing each round.
      state.seasonal_event_cards = seasonal;
    }
  }

  // Apply campaign prestige bonus: +1 attack for first 3 turns
  if (settingsNorm.is_campaign && (settingsNorm.campaign_prestige_bonus ?? 0) > 0) {
    const prestige = settingsNorm.campaign_prestige_bonus!;
    const firstHuman = state.players.find((p) => !p.is_ai);
    if (firstHuman) {
      firstHuman.temporary_modifiers = firstHuman.temporary_modifiers ?? [];
      firstHuman.temporary_modifiers.push({
        type: 'attack_modifier',
        value: Math.min(prestige, 3), // cap at +3
        turns_remaining: 3,
      });
    }
  }

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
  }
  // Patch missing per-turn fields on GameState
  if (state.fortify_moves_used === undefined) state.fortify_moves_used = 0;
  if (state.influence_cooldown_remaining === undefined) state.influence_cooldown_remaining = 0;
  if (state.blitzkrieg_attacked === undefined) state.blitzkrieg_attacked = false;
  // Patch era_modifiers to ensure new eras have defaults applied
  if (!state.era_modifiers && state.era) {
    state.era_modifiers = { ...(ERA_DEFAULTS[state.era] ?? {}) };
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
  playerId: string
): number {
  let bonus = 0;
  for (const region of map.regions) {
    const regionTerritories = map.territories.filter((t) => t.region_id === region.region_id);
    const ownsAll = regionTerritories.every(
      (t) => territories[t.territory_id]?.owner_id === playerId
    );
    if (ownsAll) bonus += region.bonus;
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
  }
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
    const regionTerritories = map.territories.filter((t) => t.region_id === region.region_id);
    const ownsAll = regionTerritories.every(
      (t) => state.territories[t.territory_id]?.owner_id === playerId
    );
    if (ownsAll) bonus += region.bonus;
  }
  return bonus;
}

/**
 * Advance to the next player's turn.
 * Skips eliminated players and wraps around.
 */
export function advanceToNextPlayer(state: GameState, map?: GameMap): void {
  const total = state.players.length;
  let next = (state.current_player_index + 1) % total;
  let attempts = 0;
  while (state.players[next].is_eliminated && attempts < total) {
    next = (next + 1) % total;
    attempts++;
  }
  if (next <= state.current_player_index) {
    state.turn_number++;

    // Decrement truce timers once per round (not per player turn)
    for (const entry of state.diplomacy) {
      if (entry.status === 'truce' && entry.truce_turns_remaining > 0) {
        entry.truce_turns_remaining--;
        if (entry.truce_turns_remaining === 0) {
          entry.status = 'neutral';
        }
      }
    }

    // Draw an event card at the start of each new round
    if (state.settings.events_enabled) {
      const deck = [...getEraDeck(state.era), ...(state.seasonal_event_cards ?? [])];
      const card = drawRandomCard(deck);
      if (card) {
        if (card.choices && card.choices.length > 0) {
          // Card requires a choice — store it for the next player to resolve
          state.active_event = card;
        } else if (card.effect) {
          // Instant effect — apply immediately (current player context will be the next player)
          state.active_event = card; // temporarily set so applyEventEffect uses correct player
        }
      }
    }
  }
  state.current_player_index = next;
  state.phase = 'draft';
  state.turn_started_at = Date.now();

  const nextPlayer = state.players[next];
  if (map) {
    const bonus = calculateContinentBonusesForPlayer(state.territories, map, nextPlayer.player_id);
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

  appendWinProbabilitySnapshot(state);

  // Collect production income and tech point income for the next player
  if (state.settings.economy_enabled) {
    collectProduction(state, nextPlayer.player_id);
    applyWonderProductionIncome(state, nextPlayer.player_id);
  }
  if (state.settings.tech_trees_enabled) {
    applyTechPointIncome(state, nextPlayer.player_id);
  }

  // Collect fleet income from ports / naval bases
  if (state.settings.naval_enabled) {
    collectFleetIncome(state, nextPlayer.player_id);
  }

  // Apply stability recovery tick
  if (state.settings.stability_enabled) {
    applyStabilityTick(state, nextPlayer.player_id);
  }

  // Tick temporary modifiers from event cards
  if (state.settings.events_enabled) {
    tickTemporaryModifiers(state, nextPlayer.player_id);
    // Apply instant event cards now (current_player_index is set to next player)
    if (state.active_event && (!state.active_event.choices || state.active_event.choices.length === 0) && state.active_event.effect) {
      const effectResult = applyEventEffect(state, state.active_event.effect, state.active_event.affects_all_players);
      state.active_event_result = effectResult;
      // Leave active_event set so the socket layer can broadcast it, then clear it there
    }
  }

  // Reset per-turn ability flags
  state.fortify_moves_used = 0;
  if ((state.influence_cooldown_remaining ?? 0) > 0) state.influence_cooldown_remaining!--;
  state.blitzkrieg_attacked = false;
  // Reset per-player per-turn ability use counts
  for (const player of state.players) {
    player.ability_uses = {};
    player.territories_captured_this_turn = 0;
  }
}

/**
 * Auto-place remaining draft units when the turn timer expires.
 * Distributes units round-robin across the player's territories in sorted `territory_id` order.
 * Returns the number of units placed (0 if nothing to do).
 */
export function autoPlaceDraftUnits(state: GameState): number {
  if (state.phase !== 'draft' || state.draft_units_remaining <= 0) return 0;

  const playerId = state.players[state.current_player_index]?.player_id;
  if (!playerId) return 0;

  const ownedIds = Object.keys(state.territories)
    .filter((tid) => state.territories[tid].owner_id === playerId)
    .sort();
  if (ownedIds.length === 0) return 0;

  let placed = 0;
  let idx = 0;
  while (state.draft_units_remaining > 0) {
    state.territories[ownedIds[idx % ownedIds.length]].unit_count += 1;
    state.draft_units_remaining -= 1;
    placed++;
    idx++;
  }
  return placed;
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
  const bonus = calculateContinentBonusesForPlayer(state.territories, map, p.player_id);
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
  const activePlayers = state.players.filter((p) => !p.is_eliminated);
  if (activePlayers.length === 1) return { winnerIds: [activePlayers[0].player_id], condition: 'last_standing' };

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
      const need = Math.ceil(totalTerritories * (settings.victory_threshold / 100));
      if (player.territory_count >= need) condition = 'threshold';
    }

    if (condition == null && allowed.includes('capital')) {
      if (playerSatisfiesCapitalVictory(state, player.player_id)) condition = 'capital';
    }

    if (condition == null && allowed.includes('secret_mission') && player.secret_mission) {
      if (player.secret_mission.kind !== 'alliance' && isMissionComplete(state, map, player)) condition = 'secret_mission';
    }

    if (condition != null) winners.push({ winnerIds: [player.player_id], condition });
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
  if (state.card_deck.length === 0) return;
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

  // Remove cards from hand
  player.cards = player.cards.filter((c) => !cardIds.includes(c.card_id));

  const bonus = getCardSetBonus(state.card_set_redemption_count);
  state.card_set_redemption_count++;
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

function buildCardDeck(territoryIds: string[]): TerritoryCard[] {
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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
      const candidates = waveClaims.get(territoryId) ?? [];
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

  for (const [territoryId, playerId] of assigned.entries()) {
    territories[territoryId].owner_id = playerId;
    territories[territoryId].unit_count = initialUnitCount;
  }
}

