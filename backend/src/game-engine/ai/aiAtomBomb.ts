/**
 * WW2 Manhattan Project, Phase 1 (docs/WW2_MANHATTAN_PROJECT.md §3): the bots
 * and the bomb.
 *
 * Before this, no AI path ever fired `atom_bomb`, and the research scorer
 * (selectAiTechResearch) values attack, defence, income and reinforcement
 * numbers, so a node whose only payload is an ability was bought last if at
 * all. Under `settings.ww2_bomb_ai`:
 *
 *   research  hard and expert bots walk the bomb's prerequisite chain, the way
 *             the Space Age bots walk the lunar ladder, and keep their points
 *             for the next node on it when it is a few turns of income away;
 *   firing    a bot holding a bomb fires it in the attack phase at the enemy
 *             tile worth the most to destroy — its units, its buildings, a
 *             capital — when that is worth a once-per-game weapon;
 *   taking    when the bot has a stack next to the bombed tile, the walk-in is
 *             put at the head of its attack plan.
 *
 * These functions CHOOSE. `executeTechAbility` resolves the detonation and
 * re-checks it, as it does for a human.
 */

import type { AiDifficulty, GameMap, GameState, PlayerState } from '../../types';
import type { TechNode } from '../eras/types';
import { getEffectiveTechCost, getEraTechTreeForPlayer, getPlayerTechPointIncome } from '../state/techManager';
import { BUILDING_TECH_INCOME } from '../state/economyManager';
import { eliminatePlayer } from '../state/elimination';
import { isShieldedFrom } from '../state/teams';
import { activeTruceBetween } from '../state/truces';
import { playerHasUnlockedAbility } from '../abilities/techAbilities';

export const ATOM_BOMB = 'atom_bomb';

/**
 * What a once-per-game detonation must destroy before a bot spends it: units on
 * the tile, plus two per building razed, plus the walk-in and capital bonuses.
 * ⚠ balance — set by the harness (scripts/simWw2Balance.ts).
 */
export const AI_BOMB_MIN_VALUE = 8;

/** Turns of tech income a bot will save for the next node on the bomb's path. */
export const AI_BOMB_SAVE_TURNS = 3;

/** Units a stack next to the bombed tile needs for the bot to walk in. */
export const AI_BOMB_WALK_IN_UNITS = 3;

/** True when this game's bots play the bomb. */
export function aiBombEnabled(state: Pick<GameState, 'settings'>): boolean {
  return state.settings?.ww2_bomb_ai === true;
}

/** Hard and expert bots pursue the bomb; medium buys it when it is the cheapest node left, as before. */
export function aiPursuesBomb(state: GameState, difficulty: AiDifficulty): boolean {
  return aiBombEnabled(state)
    && state.settings.tech_trees_enabled === true
    && (difficulty === 'hard' || difficulty === 'expert');
}

/**
 * A rough per-turn tech income: the base 1 per 5 territories (with the
 * economy), the tree's and the faction's flat income, and the tech buildings at
 * full yield. Only used to judge whether a node is "a few turns away".
 */
export function estimateTechIncome(state: GameState, playerId: string): number {
  let owned = 0;
  let fromBuildings = 0;
  for (const t of Object.values(state.territories)) {
    if (t.owner_id !== playerId) continue;
    owned += 1;
    for (const b of t.buildings ?? []) fromBuildings += BUILDING_TECH_INCOME[b] ?? 0;
  }
  const base = state.settings.economy_enabled ? Math.max(1, Math.floor(owned / 5)) + fromBuildings : 0;
  return base + getPlayerTechPointIncome(state, playerId);
}

export interface BombResearchPick {
  /** The node to research now, when the bot can pay for it. */
  techId: string | null;
  /** True when the bot should keep its points for the next node on the path. */
  save: boolean;
}

/**
 * The next step on the bomb's path for this bot, or null when it is not
 * pursuing the bomb (wrong difficulty, setting off, no bomb in its tree, or the
 * bomb already researched).
 */
export function selectAiBombResearch(
  state: GameState,
  playerId: string,
  difficulty: AiDifficulty,
): BombResearchPick | null {
  if (!aiPursuesBomb(state, difficulty)) return null;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return null;
  const tree = getEraTechTreeForPlayer(state, playerId);
  const top = tree.find((n) => n.unlocks_ability === ATOM_BOMB);
  if (!top) return null;
  const unlocked = new Set(player.unlocked_techs ?? []);
  if (unlocked.has(top.tech_id)) return null;

  // From the bomb down its prerequisites to the first node the bot can start.
  let next: TechNode | undefined = top;
  const walked = new Set<string>();
  while (next?.prerequisite && !unlocked.has(next.prerequisite) && !walked.has(next.tech_id)) {
    walked.add(next.tech_id);
    const prerequisite: string = next.prerequisite;
    next = tree.find((n) => n.tech_id === prerequisite);
  }
  if (!next) return null;

  const cost = getEffectiveTechCost(state, player, next);
  const points = player.tech_points ?? 0;
  if (points >= cost) return { techId: next.tech_id, save: false };
  return { techId: null, save: cost - points <= estimateTechIncome(state, playerId) * AI_BOMB_SAVE_TURNS };
}

/** Does this player hold a bomb it can fire: the unlocking tech or a carried charge, not yet spent? */
export function aiHoldsBomb(state: GameState, player: PlayerState): boolean {
  if (!state.settings.tech_trees_enabled) return false;
  const carried = (player.legacy_ability_charges?.[ATOM_BOMB] ?? 0) > 0;
  if (!carried && !playerHasUnlockedAbility(state, player.player_id, ATOM_BOMB)) return false;
  return !(player.used_game_abilities ?? []).includes(ATOM_BOMB);
}

export interface BombStrike {
  territoryId: string;
  /** The bot's own tile next to the target with a stack to walk in with, if any. */
  walkInFrom: string | null;
  /** What the detonation is worth, in the units of AI_BOMB_MIN_VALUE. */
  value: number;
}

/** Neighbours a walk-in can come from: land edges only, so no fleet is needed. */
function landNeighbours(map: GameMap, territoryId: string): string[] {
  const out: string[] = [];
  for (const c of map.connections ?? []) {
    if (c.type === 'sea') continue;
    if (c.from === territoryId) out.push(c.to);
    else if (c.to === territoryId) out.push(c.from);
  }
  return out;
}

/** The detonation's value on one tile, and the stack that would walk in. */
function scoreTarget(state: GameState, map: GameMap, playerId: string, territoryId: string): BombStrike {
  const t = state.territories[territoryId]!;
  let walkInFrom: string | null = null;
  let walkUnits = 0;
  for (const n of landNeighbours(map, territoryId).sort()) {
    const mine = state.territories[n];
    if (mine?.owner_id === playerId && mine.unit_count >= AI_BOMB_WALK_IN_UNITS && mine.unit_count > walkUnits) {
      walkInFrom = n;
      walkUnits = mine.unit_count;
    }
  }
  const owner = state.players.find((p) => p.player_id === t.owner_id);
  const buildings = (t.buildings ?? []).length;
  const value = t.unit_count
    + 2 * buildings
    + (walkInFrom ? 2 : 0)
    + (owner?.capital_territory_id === territoryId ? 3 : 0);
  return { territoryId, walkInFrom, value };
}

/**
 * The tile this bot should bomb now, or null. Enemy ground only: never a truce
 * partner's or a shielded seat's. A once-per-game bomb waits for a target worth
 * AI_BOMB_MIN_VALUE, except on a capped game's last turn, when it is now or never.
 */
export function selectAiAtomBombStrike(state: GameState, map: GameMap, playerId: string): BombStrike | null {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player || !aiBombEnabled(state) || !aiHoldsBomb(state, player)) return null;
  let best: BombStrike | null = null;
  for (const id of Object.keys(state.territories).sort()) {
    const owner = state.territories[id]!.owner_id;
    if (!owner || owner === playerId) continue;
    if (isShieldedFrom(state, playerId, owner) || activeTruceBetween(state, playerId, owner)) continue;
    const strike = scoreTarget(state, map, playerId, id);
    if (!best || strike.value > best.value) best = strike;
  }
  if (!best) return null;
  const lastTurn = state.settings.max_turns != null && state.turn_number >= state.settings.max_turns;
  return best.value >= AI_BOMB_MIN_VALUE || lastTurn ? best : null;
}

/**
 * After a detonation: a seat the bomb left with no territory is out, and its
 * cards pass to the bomber, as a capture's do. Returns true when it eliminated
 * someone. The socket's human handler does the same around its own broadcast.
 */
export function applyBombElimination(state: GameState, bomberId: string, previousOwner: string | null | undefined): boolean {
  if (!previousOwner) return false;
  const victim = state.players.find((p) => p.player_id === previousOwner);
  const bomber = state.players.find((p) => p.player_id === bomberId);
  if (!victim || !bomber || victim.is_eliminated || victim.territory_count > 0) return false;
  eliminatePlayer(victim, bomberId);
  bomber.cards.push(...victim.cards);
  victim.cards = [];
  return true;
}
