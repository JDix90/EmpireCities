import { inferWorldId } from '@borderfall/shared';
import type { GameMap, GameState, PlayerState } from '../../types';
import { orbitLaneId } from '../state/moonAccess';

/**
 * Era signature payoffs — the one-shot reward granted on arriving in an era,
 * dispatched by the `signature_id` declared on the game's spine step (same
 * idiom as faction `ability_id`s).
 *
 * Effects are MAP-INDEPENDENT by default: most are computed from `state` alone
 * (owned territories, players, gold), so a signature never needs adjacency.
 * `pathfinder_gate` is the one exception — the payoff it exists for is measured
 * in hyperspace lanes, which only the map knows — so the advance path threads an
 * optional `map` through and the effect no-ops without one (bare test states,
 * and the era-balance harness).
 *
 * Two delivery shapes:
 *  - INSTANT — applied immediately in `grantEraSignature` (gold, reinforcement
 *    wave, sabotage, a pending pre-attack strike).
 *  - CHARGE — `attack_die_bonus` held in `era_signature_charges` and spent one
 *    charge per attack by `consumeSignatureAttackBonus` (the Levy model).
 */
export interface EraSignatureDefinition {
  signature_id: string;
  name: string;
  /** One-line payoff summary, surfaced in the advance preview / panel. */
  description: string;
  /** Bonus attack dice granted while a charge is held; one charge burns per attack. */
  attack_die_bonus?: number;
}

export const ERA_SIGNATURES: Record<string, EraSignatureDefinition> = {
  levy_of_knights: {
    signature_id: 'levy_of_knights',
    name: 'Levy of Knights',
    description: '+1 attack die on your next attack.',
    attack_die_bonus: 1,
  },
  age_of_sail: {
    signature_id: 'age_of_sail',
    name: 'Age of Sail',
    description: 'A trade windfall, plus +1 attack die on each of your next 2 attacks.',
    attack_die_bonus: 1,
  },
  mobilization: {
    signature_id: 'mobilization',
    name: 'Mobilization',
    description: 'An immediate wave of reinforcements across your territories.',
  },
  intelligence_coup: {
    signature_id: 'intelligence_coup',
    name: 'Intelligence Coup',
    description: 'Destabilize the strongest enemy territory (or seize a covert combat edge).',
    attack_die_bonus: 1,
  },
  precision_strike: {
    signature_id: 'precision_strike',
    name: 'Precision Strike',
    description: 'Your next attack eliminates 2 defenders before the battle begins.',
  },
  orbital_window: {
    signature_id: 'orbital_window',
    name: 'Orbital Window',
    description: 'An orbital drop reinforces your strongest holdings.',
  },
  pathfinder_gate: {
    signature_id: 'pathfinder_gate',
    name: 'Pathfinder Gate',
    description: 'The hyperspace lanes to worlds you have not reached are yours alone for two rounds.',
  },
};

/**
 * Rounds a Pathfinder Gate seal stands. Two: it is a head start, not a moat —
 * long enough to plant a flag on the far world before anyone else arrives, short
 * enough that the second player through is racing rather than locked out. (The
 * Emergency Seal, the era's other timed seal, lasts one.)
 */
export const PATHFINDER_GATE_ROUNDS = 2;

/** Gold granted per owned territory by the Age of Sail trade windfall. */
const AGE_OF_SAIL_GOLD_PER_TERRITORY = 2;
/** Stability removed from the strongest enemy territory by Intelligence Coup. */
const INTELLIGENCE_COUP_SABOTAGE = 15;

function ownedTerritoryIds(state: GameState, playerId: string): string[] {
  return Object.keys(state.territories)
    .filter((tid) => state.territories[tid]?.owner_id === playerId)
    .sort();
}

function grantAttackCharges(player: PlayerState, signatureId: string, count: number): void {
  player.era_signature_charges = player.era_signature_charges ?? {};
  player.era_signature_charges[signatureId] = (player.era_signature_charges[signatureId] ?? 0) + count;
}

/** Round-robin extra units across a player's owned territories (instant reinforcement). */
function addUnitsRoundRobin(state: GameState, playerId: string, count: number): void {
  const owned = ownedTerritoryIds(state, playerId);
  if (owned.length === 0 || count <= 0) return;
  for (let i = 0; i < count; i++) {
    const t = state.territories[owned[i % owned.length]];
    t.unit_count += 1;
  }
}

/** Subtract stability from the single highest-stability enemy territory. Returns true if applied. */
function sabotageTopEnemyTerritory(state: GameState, playerId: string, amount: number): boolean {
  let target: { id: string; stability: number } | null = null;
  for (const [tid, t] of Object.entries(state.territories)) {
    if (!t.owner_id || t.owner_id === playerId || t.stability == null) continue;
    if (!target || t.stability > target.stability) target = { id: tid, stability: t.stability };
  }
  if (!target) return false;
  const t = state.territories[target.id];
  t.stability = Math.max(0, (t.stability ?? 0) - amount);
  return true;
}

/**
 * Apply an era signature on arrival. Instant effects mutate `state`; charge
 * effects accumulate in `era_signature_charges`. Unknown ids no-op so a spine
 * may reference a signature before its effect ships.
 */
export function grantEraSignature(
  state: GameState,
  player: PlayerState,
  signatureId: string,
  map?: GameMap,
): void {
  if (!ERA_SIGNATURES[signatureId]) return;
  const id = player.player_id;
  switch (signatureId) {
    case 'levy_of_knights':
      grantAttackCharges(player, signatureId, 1);
      break;
    case 'age_of_sail': {
      const windfall = AGE_OF_SAIL_GOLD_PER_TERRITORY * ownedTerritoryIds(state, id).length;
      player.special_resource = (player.special_resource ?? 0) + windfall;
      grantAttackCharges(player, signatureId, 2);
      break;
    }
    case 'mobilization': {
      const count = Math.max(2, Math.floor(ownedTerritoryIds(state, id).length / 3));
      addUnitsRoundRobin(state, id, count);
      break;
    }
    case 'intelligence_coup': {
      // Sabotage when stability is in play; otherwise a covert combat edge so
      // the signature always pays off.
      const sabotaged = state.settings.stability_enabled
        && sabotageTopEnemyTerritory(state, id, INTELLIGENCE_COUP_SABOTAGE);
      if (!sabotaged) grantAttackCharges(player, signatureId, 1);
      break;
    }
    case 'precision_strike':
      // Reuses the air-strike one-shot consumed by the next land attack.
      player.pending_pre_attack_damage = (player.pending_pre_attack_damage ?? 0) + 2;
      break;
    case 'orbital_window': {
      const count = Math.max(3, Math.floor(ownedTerritoryIds(state, id).length / 2));
      addUnitsRoundRobin(state, id, count);
      break;
    }
    case 'pathfinder_gate': {
      // The first player through the gate gets a head start measured in lanes,
      // not units: every hyperspace lane running from a tile they hold to a world
      // they have NOT reached is theirs alone for two rounds. That is the whole
      // frontier at the moment of arrival — the far worlds unlock on this same
      // advance, so nobody holds anything on them — and nothing behind it: a lane
      // back to a world they already stand on is not a frontier and stays open,
      // so the seal can never be used to wall off a war already in progress.
      //
      // Reuses the Emergency Seal ledger (`lane_blockades`), so every crossing
      // check — attack, fortify, the fortify BFS, the client mirror — already
      // honours it. No-op without a map, and on a board with no lanes.
      if (!map) break;
      const reached = new Set<string>();
      for (const t of Object.values(state.territories)) {
        if (t.owner_id === id && t.world_id) reached.add(t.world_id);
      }
      const worldOfTile = new Map(map.territories.map((t) => [t.territory_id, inferWorldId(t)]));
      const blockades = state.lane_blockades ?? {};
      let sealed = 0;
      for (const c of map.connections) {
        if (c.type !== 'orbit') continue;
        const near = [c.from, c.to].find((tid) => state.territories[tid]?.owner_id === id);
        if (!near) continue;
        const farWorld = worldOfTile.get(near === c.from ? c.to : c.from);
        if (!farWorld || reached.has(farWorld)) continue;
        blockades[orbitLaneId(c.from, c.to)] = {
          owner_id: id,
          turns_remaining: PATHFINDER_GATE_ROUNDS,
          // A Galactic Age seal: it ages as its owner's turn begins, not at the
          // round wrap, so each rival faces it for the same two rounds.
          tick: 'owner_turn',
        };
        sealed++;
      }
      if (sealed > 0) state.lane_blockades = blockades;
      break;
    }
  }
}

/**
 * Consume at most one held attack-die signature charge for a committed land
 * attack and return the bonus dice it grants (0 when none held). Mirrors the
 * legacy medieval behavior: one charge per attack.
 */
export function consumeSignatureAttackBonus(player: PlayerState): number {
  const charges = player.era_signature_charges;
  if (!charges) return 0;
  for (const [signatureId, count] of Object.entries(charges)) {
    if (count <= 0) continue;
    const bonus = ERA_SIGNATURES[signatureId]?.attack_die_bonus;
    if (!bonus) continue;
    charges[signatureId] = count - 1;
    return bonus;
  }
  return 0;
}
