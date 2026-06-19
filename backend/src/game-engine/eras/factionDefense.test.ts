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
