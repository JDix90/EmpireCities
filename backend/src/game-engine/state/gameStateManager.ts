import { v4 as uuidv4 } from 'uuid';
import type {
  GameState, PlayerState, TerritoryState, TerritoryCard,
  GameMap, GameSettings, EraId, DiplomacyEntry, WinProbabilitySnapshot,
} from '../../types';
import { calculateReinforcements, getCardSetBonus } from '../combat/combatResolver';

/**
 * Initialize a brand-new GameState from a map and player list.
 */
export function initializeGameState(
  gameId: string,
  era: EraId,
  map: GameMap,
  players: Omit<PlayerState, 'territory_count' | 'cards'>[],
  settings: GameSettings
): GameState {
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

  // Randomly distribute territories among players
  const territoryIds = Object.keys(territories);
  const shuffled = shuffleArray([...territoryIds]);
  shuffled.forEach((tid, idx) => {
    const playerIndex = idx % players.length;
    territories[tid].owner_id = players[playerIndex].player_id;
    territories[tid].unit_count = settings.initial_unit_count;
  });

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
  }));

  const firstPlayer = playerStates[0];
  const continentBonus = calculateContinentBonusesForPlayer(territories, map, firstPlayer.player_id);
  const initialDraft = calculateReinforcements(firstPlayer.territory_count, continentBonus);

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
    settings,
    draft_units_remaining: initialDraft,
    turn_started_at: Date.now(),
    win_probability_history: [],
  };
  appendWinProbabilitySnapshot(state);
  return state;
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
  }
  state.current_player_index = next;
  state.phase = 'draft';
  state.turn_started_at = Date.now();

  if (map) {
    const nextPlayer = state.players[next];
    const bonus = calculateContinentBonusesForPlayer(state.territories, map, nextPlayer.player_id);
    state.draft_units_remaining = calculateReinforcements(nextPlayer.territory_count, bonus);
  }

  appendWinProbabilitySnapshot(state);

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
 * Check if the game has a winner based on the configured victory condition.
 */
export function checkVictory(state: GameState): string | null {
  const activePlayers = state.players.filter((p) => !p.is_eliminated);
  if (activePlayers.length === 1) return activePlayers[0].player_id;

  // Domination: if one player owns every territory, they win
  const totalTerritories = Object.keys(state.territories).length;
  for (const player of activePlayers) {
    if (player.territory_count >= totalTerritories) return player.player_id;
  }

  if (state.settings.victory_type === 'threshold' && state.settings.victory_threshold) {
    const threshold = Math.ceil(totalTerritories * (state.settings.victory_threshold / 100));
    for (const player of activePlayers) {
      if (player.territory_count >= threshold) return player.player_id;
    }
  }

  return null;
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

function isValidCardSet(symbols: string[]): boolean {
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
