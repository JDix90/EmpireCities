import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANDING_ERAS } from './landingEras';
import { GALAXY_MAX_PLAYERS, GALAXY_MIN_PLAYERS, GALAXY_SCHISM_PLAYERS } from '../utils/lobbyEraMapCompatibility';
import { startingBoardTerritoryCount } from '../utils/startingBoard';

/**
 * The landing cards' numbers are typed by hand next to maps that change
 * underneath them. The Galactic Age card said 12 territories long after the
 * board became four 16-tile worlds, and its seat range has moved with the
 * rule (exactly four, then two to four once Colonies arrived, then eight too
 * with the Schism — GALAXY_MIN_PLAYERS / GALAXY_MAX_PLAYERS /
 * GALAXY_SCHISM_PLAYERS); Ancient and Medieval kept their old
 * counts after territories on them were unlocked.
 *
 * A card counts the territories in play when a game starts. Tiles tagged
 * `unlock_era_index > 0` are held back until era advancement reaches them
 * (gameStateManager skips them at init; see territoryUnlockEra), and era
 * advancement is off by default, so they are not counted — except on the
 * standalone Space Age, which deals its frontiers from turn one. The same
 * rule (utils/startingBoard.ts) sizes the lobby and Map Hub previews, so a
 * card and the room it leads to agree.
 */
function territoriesInPlayAtStart(mapId: string): number {
  const map = JSON.parse(
    readFileSync(join(__dirname, `../../../database/maps/${mapId}.json`), 'utf8'),
  ) as { map_id: string; territories: Array<{ unlock_era_index?: number }> };
  return startingBoardTerritoryCount(map);
}

describe('landing era cards', () => {
  it.each(LANDING_ERAS.map((e) => [e.id, e] as const))(
    '%s quotes the territories in play at the start of a game',
    (_id, era) => {
      expect(era.territoryCount).toBe(territoriesInPlayAtStart(era.mapId));
    },
  );

  it('quotes the Galactic Age seat count as it is enforced', () => {
    const galaxy = LANDING_ERAS.find((e) => e.id === 'galaxy_age');
    expect(galaxy).toBeDefined();
    expect(galaxy!.playersRange).toBe(`${GALAXY_MIN_PLAYERS}–${GALAXY_MAX_PLAYERS} or ${GALAXY_SCHISM_PLAYERS}`);
  });
});
