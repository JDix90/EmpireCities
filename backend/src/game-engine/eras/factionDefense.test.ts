import { describe, it, expect } from 'vitest';
import {
  ANCIENT_FACTIONS,
  MEDIEVAL_FACTIONS,
  DISCOVERY_FACTIONS,
  WW2_FACTIONS,
  COLDWAR_FACTIONS,
  MODERN_FACTIONS,
  ACW_FACTIONS,
  RISORGIMENTO_FACTIONS,
  SPACE_AGE_FACTIONS,
  GALAXY_AGE_FACTIONS,
} from './index';

const ALL_FACTIONS = [
  ...ANCIENT_FACTIONS,
  ...MEDIEVAL_FACTIONS,
  ...DISCOVERY_FACTIONS,
  ...WW2_FACTIONS,
  ...COLDWAR_FACTIONS,
  ...MODERN_FACTIONS,
  ...ACW_FACTIONS,
  ...RISORGIMENTO_FACTIONS,
  ...SPACE_AGE_FACTIONS,
  ...GALAXY_AGE_FACTIONS,
];

/**
 * Guard: no faction may grant defensive dice that are active from game start.
 * A passive (always-on) defensive-dice bonus compounds into a near-impregnable
 * defense, so defensive dice must be EARNED (tech / building / wonder / gated
 * ability), never innate. Keep this green — if a new faction needs a defensive
 * identity, gate it instead of using passive_defense_bonus.
 */
describe('no faction grants start-active defensive dice', () => {
  it('every faction has no passive_defense_bonus', () => {
    const offenders = ALL_FACTIONS.filter((f) => (f.passive_defense_bonus ?? 0) > 0).map(
      (f) => `${f.faction_id} (+${f.passive_defense_bonus})`,
    );
    expect(offenders).toEqual([]);
  });
});

const DEFENCE_DICE = /defen[cs]e (die|dice)|defensive (die|dice)/i;

/**
 * The two fields that DO grant defence dice, each conditional on something the
 * attacker chose — an off-Earth world, a lane crossing — rather than on being
 * attacked at all. combatModifiers folds both into the `faction` breakdown.
 */
const CONDITIONAL_DEFENCE_FIELDS = ['offworld_defense_bonus', 'lane_defense_bonus'] as const;

/** The abilities defenderReactions actually resolves INTO defence dice. */
const DICE_GRANTING_REACTIONS = new Set(['great_wall', 'city_of_peace', 'janissaries']);

/**
 * The rule above was enforced in the DATA and nowhere else, so nine factions
 * across six eras advertised a defence die they had never had — some of them
 * for as long as the era existed. A player reads the description, not the
 * field, so an unenforced description is the same bug with a longer fuse.
 *
 * Corrected across #397 (germanic_tribes, china_ww2), #401 (western_power,
 * rogue_state), #402 (china_cw, nato_proxy) and here (ming_china, austria,
 * papal_states, kingdom_naples).
 */
describe('no faction description promises defence dice it cannot deliver', () => {
  it('a description may claim defence dice only with a conditional field behind it', () => {
    const offenders = ALL_FACTIONS
      .filter((f) => DEFENCE_DICE.test(f.description ?? ''))
      .filter((f) => !CONDITIONAL_DEFENCE_FIELDS.some(
        (k) => ((f as unknown as Record<string, number | undefined>)[k] ?? 0) > 0,
      ))
      .map((f) => `${f.faction_id}: ${f.description}`);
    expect(offenders).toEqual([]);
  });

  it('an ability may promise defence dice only if it is a dice-granting reaction', () => {
    const offenders = ALL_FACTIONS
      .filter((f) => DEFENCE_DICE.test(f.ability_description ?? ''))
      .filter((f) => !DICE_GRANTING_REACTIONS.has(f.ability_id ?? ''))
      .map((f) => `${f.faction_id} (${f.ability_id ?? 'no ability'}): ${f.ability_description}`);
    expect(offenders).toEqual([]);
  });
});
