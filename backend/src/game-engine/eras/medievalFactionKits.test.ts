import { describe, it, expect } from 'vitest';
import { MEDIEVAL_FACTIONS } from './medieval';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';
import { consumeDefenderPreCombatCharges } from '../combat/defenderReactions';
import type { GameState, PlayerState } from '../../types';

/**
 * Every medieval faction has to do something in a game with the optional
 * systems switched off.
 *
 * `normalizeGameSettings` defaults tech trees, economy and stability to false,
 * and a campaign stage never turns any of them on. The Abbasid Caliphate
 * shipped with its entire kit behind that gate — House of Wisdom discounted
 * research nobody was doing, `reinforce_bonus` was an explicit zero, and the
 * "+2 tech points" its own description advertised was not in the data at all.
 * Measured on the engine over 900 games it won 3-4% of them against a 17% fair
 * share and was eliminated in 89%. The Mongol Khanate had no `ability_id` at
 * all, so a human saw no button and the AI parity block had nothing to fire.
 *
 * Base-game levers, i.e. the ones combat and the draft read with every optional
 * system off: passive_attack_bonus, reinforce_bonus, an ability whose handler
 * is a defender reaction, and an ability whose TERRITORY_ABILITY_DEFS entry
 * does not charge tech points.
 */

/** Ability ids resolved by defenderReactions rather than executeTechAbility. */
const DEFENDER_REACTION_ABILITIES = new Set([
  'greek_fire', 'great_wall', 'city_of_peace', 'janissaries',
  'parting_shot', 'nuclear_deterrence', 'bourbon_resistance', 'collective_defense',
]);

function worksWithoutTech(abilityId: string | undefined): boolean {
  if (!abilityId) return false;
  if (DEFENDER_REACTION_ABILITIES.has(abilityId)) return true;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def) return false;
  // A tech cost cannot be paid when no tech points are generated.
  if ((def.techCost ?? 0) > 0) return false;
  // Effects denominated in tech points are inert with the tech tree off.
  return abilityId !== 'house_of_wisdom' && abilityId !== 'silk_road';
}

describe('medieval faction kits', () => {
  for (const f of MEDIEVAL_FACTIONS) {
    it(`${f.faction_id} does something with tech, economy and stability off`, () => {
      const levers = {
        attack: (f.passive_attack_bonus ?? 0) > 0,
        reinforce: (f.reinforce_bonus ?? 0) > 0,
        ability: worksWithoutTech(f.ability_id),
      };
      expect({ faction: f.faction_id, ...levers, any: Object.values(levers).some(Boolean) })
        .toEqual({ faction: f.faction_id, ...levers, any: true });
    });

    it(`${f.faction_id} declares an ability the engine can resolve`, () => {
      if (!f.ability_id) return;
      const resolvable = DEFENDER_REACTION_ABILITIES.has(f.ability_id)
        || TERRITORY_ABILITY_DEFS[f.ability_id] != null;
      expect({ faction: f.faction_id, ability: f.ability_id, resolvable })
        .toEqual({ faction: f.faction_id, ability: f.ability_id, resolvable: true });
    });

    it(`${f.faction_id} carries an ability at all`, () => {
      // The Mongols shipped without one for the life of the era.
      expect({ faction: f.faction_id, ability: f.ability_id ?? null })
        .not.toEqual({ faction: f.faction_id, ability: null });
    });
  }

  it('no medieval description promises tech points the faction does not generate', () => {
    const liars = MEDIEVAL_FACTIONS
      .filter((f) => /tech point/i.test(f.description) && (f.tech_point_income ?? 0) === 0)
      .map((f) => f.faction_id);
    expect(liars).toEqual([]);
  });

  it('no medieval description promises defence dice, which no faction may have innately', () => {
    // factionDefense.test.ts forbids passive_defense_bonus game-wide, so a
    // description advertising one can only ever be false. The Holy Roman
    // Empire's did, for the life of the era.
    const liars = MEDIEVAL_FACTIONS
      .filter((f) => /defen[cs]e (die|dice)/i.test(f.description))
      .map((f) => f.faction_id);
    expect(liars).toEqual([]);
  });

  it('the Abbasid charge is gated per turn, not innate', () => {
    const caliphate = MEDIEVAL_FACTIONS.find((f) => f.faction_id === 'caliphate')!;
    expect(caliphate.passive_defense_bonus ?? 0).toBe(0);

    const defender = {
      player_id: 'd', faction_id: 'caliphate', defensive_charge_used_this_turn: false,
    } as unknown as PlayerState;
    const state = {
      era: 'medieval',
      settings: { factions_enabled: true },
      players: [defender],
    } as unknown as GameState;

    expect(consumeDefenderPreCombatCharges(state, 'd').preCombatDefenseDice).toBe(2);
    expect(consumeDefenderPreCombatCharges(state, 'd').preCombatDefenseDice).toBe(0);
  });
});
