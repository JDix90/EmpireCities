/**
 * Playing to the ending (ai_ending_play_enabled): how close each player is to
 * winning this game, and what that means for a bot's attacks.
 *
 * Today no bot reads how the game is won: a bot two tiles short of the 65%
 * line plays the turn like any other, and nobody checks a rival about to
 * cross it. With the flag on:
 *
 *   race     a bot within a few tiles of its own win, or anyone in the last
 *            rounds before the cap (where most territory wins), values every
 *            capture and presses as in a decided game;
 *   contain  when a rival is past the alert line and clearly ahead of the
 *            field, a bot ranks attacks on that rival above the rest, and
 *            fights among the chasers below, by its level's `leaderPressure`
 *            (ai/aiProfiles.ts). It chooses among attacks worth starting
 *            anyway; it never makes one worth starting.
 *
 * Closeness reads only what every player can see: territory held against the
 * threshold or domination, rival capitals held in a capital game, and the
 * tiebreak at the round cap. Never secret missions, and never whether a seat
 * is human: the leader is pressed because it is about to win, whoever it is.
 */
import type { GameState } from '../../types';
import { getAllowedVictoryConditions } from '../state/gameSettings';
import { isFriendlyOwner, isTeamGame } from '../state/teams';
import { aiProfile, type AiLevel } from './aiProfiles';

/** A rival is pressed once it holds this share of what it needs to win… */
export const LEADER_ALERT = 0.5;
/** …and leads everyone else, this bot included, by this much of it. */
export const LEADER_MARGIN = 0.1;
/** It is pressed hardest from this share on. */
export const LEADER_FULL = 0.9;
/**
 * While a leader is pressed, attacking another rival costs this share of the
 * press: a war between the chasers is what lets a leader run away. ⚠ balance
 */
export const CHASER_TRUCE = 0.5;
/** A bot races once it is this many territories or fewer from its own win. */
export const RACE_WINDOW = 6;
/** The last rounds before the cap, when the most territory wins and everyone races. */
export const CAP_WINDOW = 3;
/** The race's bonus per capture at full urgency, on the planner's 3·P − 1 scale. ⚠ balance */
export const RACE_BONUS = 1.5;

interface Standing {
  playerId: string;
  /** How close to winning, from 0 to 1. */
  closeness: number;
}

/** Territories a player must hold to win on territory: the threshold, or the whole board. */
function territoryGoal(state: GameState): number | null {
  const allowed = getAllowedVictoryConditions(state.settings);
  const total = Object.keys(state.territories).length;
  if (allowed.includes('threshold') && state.settings.victory_threshold != null) {
    return Math.ceil((total * state.settings.victory_threshold) / 100);
  }
  return allowed.includes('domination') ? total : null;
}

/** Rounds left before the cap decides the game, or null without one. */
function roundsLeft(state: GameState): number | null {
  const max = state.settings.max_turns;
  return typeof max === 'number' && max > 0 ? max - state.turn_number + 1 : null;
}

/**
 * Every active player's closeness to winning: the best of territory held
 * against the goal, rival capitals held (when its own is held) in a capital
 * game, and, in the last rounds, leading the cap's tiebreak.
 */
export function winStandings(state: GameState): Standing[] {
  const active = state.players.filter((p) => !p.is_eliminated);
  const goal = territoryGoal(state);
  const capitals = getAllowedVictoryConditions(state.settings).includes('capital')
    && active.every((p) => !!p.capital_territory_id);
  const left = roundsLeft(state);

  let tiebreakLeader: string | null = null;
  if (left != null && left <= CAP_WINDOW) {
    const units = new Map<string, number>();
    for (const t of Object.values(state.territories)) {
      if (t.owner_id) units.set(t.owner_id, (units.get(t.owner_id) ?? 0) + t.unit_count);
    }
    tiebreakLeader = [...active].sort((a, b) =>
      (b.territory_count ?? 0) - (a.territory_count ?? 0)
      || (units.get(b.player_id) ?? 0) - (units.get(a.player_id) ?? 0))[0]?.player_id ?? null;
  }

  return active.map((p) => {
    let closeness = goal ? Math.min(1, (p.territory_count ?? 0) / goal) : 0;
    if (capitals && state.territories[p.capital_territory_id!]?.owner_id === p.player_id) {
      const rivals = active.filter((o) => o.player_id !== p.player_id);
      const held = rivals.filter((o) => state.territories[o.capital_territory_id!]?.owner_id === p.player_id).length;
      if (rivals.length > 0) closeness = Math.max(closeness, held / rivals.length);
    }
    if (p.player_id === tiebreakLeader && left != null) {
      closeness = Math.max(closeness, 1 - (left - 1) / (CAP_WINDOW + 1));
    }
    return { playerId: p.player_id, closeness };
  });
}

export interface EndingPlan {
  /** The rival to press, when one is close to winning and closer than anyone. */
  leaderId: string | null;
  /** The press on that rival, on the planner's scale: the level's weight times how close it is. */
  leaderBonus: number;
  /** The bonus every capture earns while this bot races its own ending. */
  raceBonus: number;
  /** True while racing: the turn presses as in a decided game. */
  racing: boolean;
}

const NONE: EndingPlan = { leaderId: null, leaderBonus: 0, raceBonus: 0, racing: false };

/** What the ending means for `playerId`'s attacks this turn. */
export function endingPlan(state: GameState, playerId: string, difficulty: AiLevel): EndingPlan {
  const profile = aiProfile(difficulty);
  if (profile.passive || isTeamGame(state)) return NONE;
  const standings = winStandings(state);
  const mine = standings.find((s) => s.playerId === playerId);
  if (!mine) return NONE;

  // Contain: the player closest to winning, once past the alert line and
  // clearly ahead of the field, this bot included.
  let leaderId: string | null = null;
  let leaderBonus = 0;
  if (profile.leaderPressure > 0) {
    const ranked = [...standings].sort((a, b) => b.closeness - a.closeness);
    const top = ranked[0];
    const next = ranked[1]?.closeness ?? 0;
    if (
      top
      && top.playerId !== playerId
      && !isFriendlyOwner(state, playerId, top.playerId)
      && top.closeness >= LEADER_ALERT
      && top.closeness - next >= LEADER_MARGIN
    ) {
      const urgency = Math.min(1, (top.closeness - LEADER_ALERT) / (LEADER_FULL - LEADER_ALERT));
      leaderId = top.playerId;
      leaderBonus = profile.leaderPressure * Math.max(urgency, 0.25);
    }
  }

  // Race: a few territories from its own line, or the last rounds before the cap.
  let raceUrgency = 0;
  if (profile.racesEnding) {
    const goal = territoryGoal(state);
    const held = state.players.find((p) => p.player_id === playerId)?.territory_count ?? 0;
    if (goal != null && goal - held <= RACE_WINDOW) {
      raceUrgency = 1 - Math.max(0, goal - held - 1) / RACE_WINDOW;
    }
    const left = roundsLeft(state);
    if (left != null && left <= CAP_WINDOW) {
      raceUrgency = Math.max(raceUrgency, 1 - (left - 1) / (CAP_WINDOW + 1));
    }
  }

  return {
    leaderId,
    leaderBonus,
    raceBonus: RACE_BONUS * raceUrgency,
    racing: raceUrgency > 0,
  };
}

/**
 * The ending's weight on attacking `targetId`, on the planner's 3·P − 1 scale,
 * in two parts. `value` is the race: a capture this bot needs is worth more,
 * so it may start a fight it would otherwise pass up. `rank` is the press on
 * the leader: it chooses among fights worth starting anyway, and never makes
 * a hopeless attack on a big stack worth starting because of who owns it.
 */
export function endingAttackBonus(
  state: GameState,
  plan: EndingPlan,
  targetId: string,
): { value: number; rank: number } {
  const owner = state.territories[targetId]?.owner_id ?? null;
  let rank = 0;
  if (plan.leaderId && owner) {
    rank = owner === plan.leaderId ? plan.leaderBonus : -CHASER_TRUCE * plan.leaderBonus;
  }
  return { value: plan.raceBonus, rank };
}
