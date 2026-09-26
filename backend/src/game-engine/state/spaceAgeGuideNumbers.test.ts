import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HELIUM3_PER_POLE,
  HELIUM3_PER_TILE,
  HELIUM3_STOCKPILE_CAP,
  LUNAR_EXPORT_MAX,
} from './helium3';
import { SPACE_AGE_LANE_SEAL_DURATION, SPACE_AGE_LANE_SEAL_HELIUM3_COST } from './moonAccess';
import { TRIBUTE_MIN_MOON_TILES, TRIBUTE_TECH_POINTS } from './moonTribute';
import {
  DROP_ASSAULT_HELIUM3_COST,
  DROP_ASSAULT_MOON_TILES,
  DROP_ASSAULT_UNITS,
} from '../abilities/dropAssault';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';
import { SPACE_AGE_FACTIONS } from '../eras/spaceage';

/**
 * "How the Space Age works" (frontend/src/utils/spaceAgeGuide.ts) quotes the
 * Moon Race's numbers to players: what He-3 pays, what each orbital power
 * costs, how long a blockade holds. They live in that file's SPACE_AGE_RULES
 * block, and this reads the block out of the frontend source and holds every
 * entry to the constant the engine actually uses — so a rebalance that forgets
 * the guide fails on the same commit instead of shipping copy that lies about
 * fuel. Same approach as factionKit.test.ts's check on the ability buttons.
 */
function guideNumbers(): Record<string, number> {
  const source = readFileSync(
    join(__dirname, '../../../../frontend/src/utils/spaceAgeGuide.ts'), 'utf-8',
  );
  const start = source.indexOf('export const SPACE_AGE_RULES = {');
  const end = source.indexOf('} as const;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = source.slice(start, end);
  return Object.fromEntries(
    [...block.matchAll(/^\s+([a-zA-Z0-9]+): (\d+),$/gm)].map((m) => [m[1]!, Number(m[2])]),
  );
}

describe('the Space Age guide quotes the engine\'s own numbers', () => {
  const pioneers = SPACE_AGE_FACTIONS.find((f) => f.faction_id === 'lunar_pioneers');

  const engine: Record<string, number | undefined> = {
    helium3PerTile: HELIUM3_PER_TILE,
    helium3PerPole: HELIUM3_PER_POLE,
    helium3Cap: HELIUM3_STOCKPILE_CAP,
    lunarExportMax: LUNAR_EXPORT_MAX,
    orbitalDropUnits: TERRITORY_ABILITY_DEFS.orbital_drop?.ownPlacement?.units,
    orbitalDropMoonTiles: TERRITORY_ABILITY_DEFS.orbital_drop?.requiresMoonTiles,
    orbitalDropHelium3: TERRITORY_ABILITY_DEFS.orbital_drop?.helium3Cost,
    dropAssaultUnits: DROP_ASSAULT_UNITS,
    dropAssaultMoonTiles: DROP_ASSAULT_MOON_TILES,
    dropAssaultHelium3: DROP_ASSAULT_HELIUM3_COST,
    dysonBeamUnits: TERRITORY_ABILITY_DEFS.dyson_beam?.unitReduction,
    dysonBeamMoonTiles: TERRITORY_ABILITY_DEFS.dyson_beam?.requiresMoonTiles,
    dysonBeamHelium3: TERRITORY_ABILITY_DEFS.dyson_beam?.helium3Cost,
    blockadeHelium3: SPACE_AGE_LANE_SEAL_HELIUM3_COST,
    blockadeRounds: SPACE_AGE_LANE_SEAL_DURATION,
    pioneerDefenceDice: pioneers?.offworld_defense_bonus,
    pioneerSupplyDropUnits: TERRITORY_ABILITY_DEFS.lunar_supply_drop?.ownPlacement?.units,
    tributeMoonTiles: TRIBUTE_MIN_MOON_TILES,
    tributeTechPoints: TRIBUTE_TECH_POINTS,
  };

  it('has an engine constant behind every number it quotes', () => {
    // A new entry in the guide's block with nothing to check it against is
    // exactly how the copy would start drifting again.
    expect(Object.keys(guideNumbers()).sort()).toEqual(Object.keys(engine).sort());
  });

  it('agrees with every one of them', () => {
    const quoted = guideNumbers();
    for (const [key, value] of Object.entries(engine)) {
      expect(value, key).toBeTypeOf('number');
      expect(quoted[key], key).toBe(value);
    }
  });
});
