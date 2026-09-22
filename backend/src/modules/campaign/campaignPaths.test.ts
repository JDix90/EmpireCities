import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CAMPAIGN_PATHS } from './campaignPaths';
import { getFactionById } from '../../game-engine/eras';
import type { EraId } from '../../types';

/**
 * Stage config integrity, unguarded until two bugs shipped in it.
 *
 * createEraGame takes the era from CAMPAIGN_ERAS BY INDEX, not from a stage's
 * own `era` field, and faction lookup is era-scoped. So a stage naming a
 * faction from a different era leaves both sides factionless: no passive, no
 * ability, no home region, silently. The American Revolution stage ran era
 * ww2 while locking 'confederacy' and 'union', which exist only in acw.
 *
 * The era list is duplicated here on purpose: if someone reorders
 * CAMPAIGN_ERAS, this test should fail rather than follow it, because every
 * stage's factions are chosen against a known position.
 */
const CAMPAIGN_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'];
const MAPS_DIR = join(__dirname, '../../../../database/maps');

describe('campaign path config', () => {
  for (const [pathId, path] of Object.entries(CAMPAIGN_PATHS)) {
    describe(pathId, () => {
      it('runs six stages, one per campaign era', () => {
        expect(path.eras).toHaveLength(CAMPAIGN_ERAS.length);
      });

      path.eras.forEach((stage, index) => {
        const era = CAMPAIGN_ERAS[index];

        it(`stage ${index + 1} locks a faction that exists in ${era}`, () => {
          expect({ stage: index + 1, faction: stage.locked_faction, found: !!getFactionById(era, stage.locked_faction) })
            .toEqual({ stage: index + 1, faction: stage.locked_faction, found: true });
        });

        it(`stage ${index + 1} names AI factions that exist in ${era}, with no repeats`, () => {
          const missing = stage.ai_factions.filter((f) => !getFactionById(era, f));
          expect({ stage: index + 1, missing }).toEqual({ stage: index + 1, missing: [] });
          expect({ stage: index + 1, count: stage.ai_factions.length })
            .toEqual({ stage: index + 1, count: new Set(stage.ai_factions).size });
        });

        it(`stage ${index + 1} does not name more AI factions than it has AI seats`, () => {
          expect(stage.ai_factions.length).toBeLessThanOrEqual(stage.ai_count);
        });

        it(`stage ${index + 1} points at a map that ships`, () => {
          expect({ map: stage.map_id, exists: existsSync(join(MAPS_DIR, `${stage.map_id}.json`)) })
            .toEqual({ map: stage.map_id, exists: true });
        });
      });
    });
  }
});
