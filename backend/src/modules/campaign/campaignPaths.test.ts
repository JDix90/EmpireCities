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

/**
 * Territory share every seat holds at the deal, plus the room a seat needs to
 * cross the line before the opposition has taken a turn. A threshold stage set
 * at or near the opening share is decided by the deal: measured on the engine,
 * the four stages that sat at 25-40% ended on turn 2 with a ~0% player win
 * rate, because a threshold victory is a race every seat is already running.
 */
const OPENING_SHARE_MARGIN = 10;

/** `normalizeGameSettings` drops a `max_turns` below this to null — no clock. */
const MIN_ACCEPTED_MAX_TURNS = 10;

describe('campaign path config', () => {
  for (const [pathId, path] of Object.entries(CAMPAIGN_PATHS)) {
    describe(pathId, () => {
      it('runs six stages, one per campaign era', () => {
        expect(path.eras).toHaveLength(CAMPAIGN_ERAS.length);
      });

      it('opens holding its signature carry when stage one takes a deficit', () => {
        const opensWithDeficit = (path.eras[0]?.starting_unit_modifier ?? 0) < 0;
        const seeded = (path.initial_carry[path.signature_carry_key] ?? 0) > 0;
        expect({ path: pathId, opensWithDeficit, seeded })
          .toEqual({ path: pathId, opensWithDeficit, seeded: opensWithDeficit || seeded });
      });

      it('does not open above its own carry ceiling', () => {
        const seeded = path.initial_carry[path.signature_carry_key] ?? 0;
        expect(seeded).toBeLessThanOrEqual(path.signature_carry_max);
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

        it(`stage ${index + 1} cannot be won by the opening deal`, () => {
          if (!stage.allowed_victory_conditions.includes('threshold')) return;
          const openingShare = Math.ceil(100 / (stage.ai_count + 1));
          expect({
            stage: index + 1,
            threshold: stage.victory_threshold,
            floor: openingShare + OPENING_SHARE_MARGIN,
          }).toEqual({
            stage: index + 1,
            threshold: stage.victory_threshold,
            floor: openingShare + OPENING_SHARE_MARGIN,
          });
          expect(stage.victory_threshold ?? 0).toBeGreaterThan(openingShare + OPENING_SHARE_MARGIN);
        });

        it(`stage ${index + 1} declares a threshold only where one is read`, () => {
          const declaresThreshold = stage.victory_threshold != null;
          expect({ stage: index + 1, declaresThreshold })
            .toEqual({ stage: index + 1, declaresThreshold: stage.allowed_victory_conditions.includes('threshold') });
        });

        it(`stage ${index + 1} sets a turn clock the engine will keep`, () => {
          if (stage.max_turns == null) return;
          expect({ stage: index + 1, clock: stage.max_turns, integer: Number.isInteger(stage.max_turns) })
            .toEqual({ stage: index + 1, clock: stage.max_turns, integer: true });
          expect(stage.max_turns).toBeGreaterThanOrEqual(MIN_ACCEPTED_MAX_TURNS);
        });

        it(`stage ${index + 1} does not pay the signature carry for losing`, () => {
          const paid = stage.carry_on_loss[path.signature_carry_key] ?? 0;
          expect({ stage: index + 1, carry: path.signature_carry_key, paid })
            .toEqual({ stage: index + 1, carry: path.signature_carry_key, paid: 0 });
        });

        it(`stage ${index + 1} points at a map that ships`, () => {
          expect({ map: stage.map_id, exists: existsSync(join(MAPS_DIR, `${stage.map_id}.json`)) })
            .toEqual({ map: stage.map_id, exists: true });
        });
      });
    });
  }
});
