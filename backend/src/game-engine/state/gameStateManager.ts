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
  medieval:     { castle_fortification: true },
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

  // Assign factions to players (round-robin from available era factions) when enabled
  if (settingsNorm.factions_enabled) {
    const eraFactions = getEraFactions(era);
    players.forEach((p, idx) => {
      if (!p.faction_id) {
        p.faction_id = eraFactions[idx % eraFactions.length]?.faction_id ?? null;
      }
    });
  }

  // Distribute territories — geographic clustering when factions_enabled, otherwise random
  const territoryIds = Object.keys(territories);
  if (settingsNorm.factions_enabled) {
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
  const continentBonus = calculateContinentBonusesForPlayer(territories, map, firstPlayer.player_id);
  const initialDraft = calculateReinforcements(
    firstPlayer.territory_count,
    continentBonus,
    playerStates.length,
  );

  const state: GameState = {
    game_id: gameId,
    era,
    map_id: map.map_id,
    phase: 'draft',
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
    influence_used_this_turn: false,
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
  if (state.influence_used_this_turn === undefined) state.influence_used_this_turn = false;
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
      const effectResult = applyEventEffect(state, state.active_event.effect);
      state.active_event_result = effectResult;
      // Leave active_event set so the socket layer can broadcast it, then clear it there
    }
  }

  // Reset per-turn ability flags
  state.fortify_moves_used = 0;
  state.influence_used_this_turn = false;
  state.blitzkrieg_attacked = false;
  // Reset per-player per-turn ability use counts
  for (const player of state.players) {
    player.ability_uses = {};
    player.territories_captured_this_turn = 0;
  }

  // Decrement truce timers
  for (const entry of state.diplomacy) {
    if (entry.status === 'truce' && entry.truce_turns_remaining > 0) {
      entry.truce_turns_remaining--;
      if (entry.truce_turns_remaining === 0) {
        entry.status = 'neutral';
      }
    }
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
 * Algorithm:
 * 1. Each player has a faction (via player.faction_id); look up that faction's
 *    home_region_ids from ERA_FACTIONS.
 * 2. BFS-expand from home territories outward, assigning each wave to the
 *    nearest-home-region player.  Ties broken by player index.
 * 3. Any leftover territories are distributed round-robin.
 */
function distributeTerritoriesGeographic(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  players: Omit<PlayerState, 'territory_count' | 'cards' | 'capital_territory_id' | 'secret_mission'>[],
  era: EraId,
  initialUnitCount: number
): void {
  const factions = getEraFactions(era);

  // Build adjacency map
  const adjacency: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adjacency[conn.from]) adjacency[conn.from] = [];
    if (!adjacency[conn.to]) adjacency[conn.to] = [];
    adjacency[conn.from].push(conn.to);
    adjacency[conn.to].push(conn.from);
  }

  // For each player, find their home territories from their faction
  const playerHomeIds: string[][] = players.map((p) => {
    if (!p.faction_id) return [];
    const faction = factions.find((f) => f.faction_id === p.faction_id);
    if (!faction) return [];
    return map.territories
      .filter((t) => faction.home_region_ids.includes(t.region_id))
      .map((t) => t.territory_id);
  });

  // Assign home territories with round-robin draft when multiple factions share a region.
  // Group all home claims by region, then interleave assignments so each player gets an
  // equal slice before anyone takes a second territory from the same contested region.
  const regionClaimers = new Map<string, number[]>(); // region_id → [player indices]
  for (let pi = 0; pi < players.length; pi++) {
    const faction = factions.find((f) => f.faction_id === players[pi].faction_id);
    if (!faction) continue;
    for (const regionId of faction.home_region_ids) {
      if (!regionClaimers.has(regionId)) regionClaimers.set(regionId, []);
      regionClaimers.get(regionId)!.push(pi);
    }
  }
  const assigned = new Map<string, string>(); // territory_id → player_id
  for (const [regionId, piList] of regionClaimers.entries()) {
    const regionTerritories = map.territories
      .filter((t) => t.region_id === regionId)
      .map((t) => t.territory_id);
    regionTerritories.forEach((tid, i) => {
      const pi = piList[i % piList.length];
      if (!assigned.has(tid)) {
        assigned.set(tid, players[pi].player_id);
      }
    });
  }

  // True simultaneous multi-source BFS: maintain per-player frontier queues and expand
  // one wave at a time. All players' claims for a wave are collected before any are applied,
  // so no player has a positional advantage from iteration order.
  const unassigned = new Set(Object.keys(territories).filter((tid) => !assigned.has(tid)));
  if (unassigned.size > 0) {
    const frontiers: Set<string>[] = players.map((_p, pi) => new Set(playerHomeIds[pi]));
    while (unassigned.size > 0) {
      // Collect all claims for this wave without assigning yet
      const waveClaims = new Map<string, number>(); // territory_id → first claiming player index
      for (let pi = 0; pi < players.length; pi++) {
        for (const tid of frontiers[pi]) {
          for (const nid of (adjacency[tid] ?? [])) {
            if (unassigned.has(nid) && !waveClaims.has(nid)) {
              waveClaims.set(nid, pi);
            }
          }
        }
      }
      if (waveClaims.size === 0) break;
      // Apply all wave claims and advance frontiers
      const nextFrontiers: string[][] = players.map(() => []);
      for (const [nid, pi] of waveClaims.entries()) {
        assigned.set(nid, players[pi].player_id);
        unassigned.delete(nid);
        nextFrontiers[pi].push(nid);
      }
      for (let pi = 0; pi < players.length; pi++) {
        frontiers[pi] = new Set(nextFrontiers[pi]);
      }
    }
  }

  // Round-robin any truly isolated leftover territories
  const remaining = [...unassigned];
  remaining.forEach((tid, idx) => {
    assigned.set(tid, players[idx % players.length].player_id);
  });

  // Apply assignments to territories
  for (const [tid, playerId] of assigned.entries()) {
    territories[tid].owner_id = playerId;
    territories[tid].unit_count = initialUnitCount;
  }
}

