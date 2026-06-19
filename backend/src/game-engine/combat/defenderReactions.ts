/**
 * Shared defender faction reactions for land combat.
 *
 * Several Group H faction abilities trigger on the DEFENDER's side while it is
 * the ATTACKER's turn. To guarantee human/AI parity these effects must run from
 * both the human `game:attack` handler and the AI attack loop, so they live here
 * as a single source of truth.
 *
 * Two phases (both gated by `defensive_charge_used_this_turn`, reset for every
 * player in `advanceToNextPlayer` — so each opponent's turn the defender gets a
 * fresh "first attack against you" charge):
 *  - Pre-combat charges (greek_fire, great_wall, janissaries): consumed before dice
 *    are rolled. janissaries reaches "3 dice regardless of garrison" via an extra
 *    defense bonus the caller sizes (see executeLandAttack) — it is no longer an
 *    always-on base in combatModifiers.
 *  - Post-combat reactions (parting_shot, nuclear_deterrence, bourbon_resistance,
 *    collective_defense): applied after dice are resolved and base losses applied,
 *    before the capture block runs.
 *
 * collective_defense (NATO): the first attack against you each turn costs the
 * attacker +1 unit (once per turn). This replaced nato_proxy's old always-on
 * `passive_defense_bonus` (+1 defense die), removed to eliminate start-active
 * defensive dice.
 */
import type { CombatResult, GameState, TerritoryState } from '../../types';
import { getPlayerFaction } from '../eras/factionLineage';

function defenderFactionAbility(state: GameState, defenderId: string | null | undefined): string | undefined {
  if (!state.settings.factions_enabled || !defenderId) return undefined;
  const defender = state.players.find((p) => p.player_id === defenderId);
  if (!defender) return undefined;
  return getPlayerFaction(state, defender)?.ability_id;
}

export interface DefenderPreCombatCharges {
  /** Attacker units removed before dice are rolled (greek_fire). */
  greekFirePreDamage: number;
  /** Extra defender dice this attack (great_wall). */
  greatWallDefenseDice: number;
  /** Ottoman janissaries charge available this exchange — the caller sizes the dice
   *  bonus to reach 3 regardless of garrison (3 - min(units, 2)). */
  janissariesActive: boolean;
}

/**
 * Consume the defender's once-per-turn pre-combat charge (greek_fire / great_wall /
 * janissaries) if available, returning the effects to apply. Mutates the defender's
 * `defensive_charge_used_this_turn` flag.
 */
export function consumeDefenderPreCombatCharges(
  state: GameState,
  defenderId: string | null | undefined,
): DefenderPreCombatCharges {
  const result: DefenderPreCombatCharges = {
    greekFirePreDamage: 0,
    greatWallDefenseDice: 0,
    janissariesActive: false,
  };
  const abilityId = defenderFactionAbility(state, defenderId);
  if (abilityId !== 'greek_fire' && abilityId !== 'great_wall' && abilityId !== 'janissaries') {
    return result;
  }

  const defender = state.players.find((p) => p.player_id === defenderId);
  if (!defender || defender.defensive_charge_used_this_turn) return result;

  if (abilityId === 'greek_fire') result.greekFirePreDamage = 1;
  if (abilityId === 'great_wall') result.greatWallDefenseDice = 2;
  if (abilityId === 'janissaries') result.janissariesActive = true;
  defender.defensive_charge_used_this_turn = true;
  return result;
}

/**
 * Apply post-combat defender reactions. Call AFTER base losses are applied to the
 * territories and BEFORE the capture-handling block. Mutates `result` and the
 * territories in place; tracks once-per-game charges on the defender.
 */
export function applyDefenderPostCombatReactions(params: {
  state: GameState;
  defenderId: string | null | undefined;
  fromTerritory: TerritoryState;
  toTerritory: TerritoryState;
  result: CombatResult;
}): void {
  const { state, defenderId, fromTerritory, toTerritory, result } = params;
  const abilityId = defenderFactionAbility(state, defenderId);
  if (!abilityId) return;

  const defender = state.players.find((p) => p.player_id === defenderId);
  if (!defender) return;

  const usedGame = (defender.used_game_abilities ?? []).includes(abilityId);
  const isCapital = defender.capital_territory_id != null
    && toTerritory.territory_id === defender.capital_territory_id;
  const faction = getPlayerFaction(state, defender);
  const isHomeRegion = !!toTerritory.region_id
    && (faction?.home_region_ids ?? []).includes(toTerritory.region_id);

  // parting_shot: the attacker loses 1 extra unit whenever they capture from you.
  if (abilityId === 'parting_shot' && result.territory_captured) {
    const extra = Math.min(1, Math.max(0, fromTerritory.unit_count - 1));
    fromTerritory.unit_count -= extra;
    result.attacker_losses += extra;
  }

  // nuclear_deterrence: the first assault on your capital costs the attacker +3
  // units (a deterrent toll), once per game.
  if (abilityId === 'nuclear_deterrence' && isCapital && !usedGame) {
    const extra = Math.min(3, Math.max(0, fromTerritory.unit_count - 1));
    if (extra > 0) {
      fromTerritory.unit_count -= extra;
      result.attacker_losses += extra;
    }
    defender.used_game_abilities = [...(defender.used_game_abilities ?? []), abilityId];
  }

  // bourbon_resistance: negate the first capture of your capital / home region,
  // once per game. The garrison survives with a single unit.
  if (abilityId === 'bourbon_resistance' && (isCapital || isHomeRegion) && result.territory_captured && !usedGame) {
    result.territory_captured = false;
    toTerritory.unit_count = Math.max(1, toTerritory.unit_count);
    defender.used_game_abilities = [...(defender.used_game_abilities ?? []), abilityId];
  }

  // collective_defense (NATO): the first attack against you each opponent turn costs
  // the attacker +1 unit (once per turn). Replaces the removed always-on
  // passive_defense_bonus with a gated, theme-matching reaction.
  if (abilityId === 'collective_defense' && !defender.defensive_charge_used_this_turn) {
    const extra = Math.min(1, Math.max(0, fromTerritory.unit_count - 1));
    fromTerritory.unit_count -= extra;
    result.attacker_losses += extra;
    defender.defensive_charge_used_this_turn = true;
  }
}
