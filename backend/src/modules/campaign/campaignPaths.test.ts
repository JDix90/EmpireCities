import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  CAMPAIGN_PATHS,
  allCampaignStages,
  describeLineChoice,
  getPathEraConfig,
  resolveLineId,
} from './campaignPaths';
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
  it('marks exactly one path as the one to start with', () => {
    expect(Object.values(CAMPAIGN_PATHS).filter((p) => p.recommended_start).map((p) => p.path_id)).toHaveLength(1);
  });

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

      // Every stage a player can be dealt, each side's included: `path.eras`
      // alone is the default side's.
      const stages = allCampaignStages()
        .filter((s) => s.path.path_id === pathId)
        .map((s) => ({ ...s, label: s.line_id ? `${s.index + 1} (${s.line_id})` : `${s.index + 1}` }));
      stages.forEach(({ stage, index, label }) => {
        const era = CAMPAIGN_ERAS[index];

        it(`stage ${label} locks a faction that exists in ${era}`, () => {
          expect({ stage: index + 1, faction: stage.locked_faction, found: !!getFactionById(era, stage.locked_faction) })
            .toEqual({ stage: index + 1, faction: stage.locked_faction, found: true });
        });

        it(`stage ${label} names AI factions that exist in ${era}, with no repeats`, () => {
          const missing = stage.ai_factions.filter((f) => !getFactionById(era, f));
          expect({ stage: index + 1, missing }).toEqual({ stage: index + 1, missing: [] });
          expect({ stage: index + 1, count: stage.ai_factions.length })
            .toEqual({ stage: index + 1, count: new Set(stage.ai_factions).size });
        });

        // A seat with no faction named is not filled at random: it plays with
        // no faction at all, and the board has no power to name it for.
        it(`stage ${label} names a faction for every AI seat`, () => {
          expect({ stage: index + 1, factions: stage.ai_factions.length })
            .toEqual({ stage: index + 1, factions: stage.ai_count });
        });

        it(`stage ${label} cannot be won by the opening deal`, () => {
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

        it(`stage ${label} declares a threshold only where one is read`, () => {
          const declaresThreshold = stage.victory_threshold != null;
          expect({ stage: index + 1, declaresThreshold })
            .toEqual({ stage: index + 1, declaresThreshold: stage.allowed_victory_conditions.includes('threshold') });
        });

        it(`stage ${label} sets a turn clock the engine will keep`, () => {
          if (stage.max_turns == null) return;
          expect({ stage: index + 1, clock: stage.max_turns, integer: Number.isInteger(stage.max_turns) })
            .toEqual({ stage: index + 1, clock: stage.max_turns, integer: true });
          expect(stage.max_turns).toBeGreaterThanOrEqual(MIN_ACCEPTED_MAX_TURNS);
        });

        it(`stage ${label} does not pay the signature carry for losing`, () => {
          const paid = stage.carry_on_loss[path.signature_carry_key] ?? 0;
          expect({ stage: index + 1, carry: path.signature_carry_key, paid })
            .toEqual({ stage: index + 1, carry: path.signature_carry_key, paid: 0 });
        });

        it(`stage ${label} points at a map that ships`, () => {
          expect({ map: stage.map_id, exists: existsSync(join(MAPS_DIR, `${stage.map_id}.json`)) })
            .toEqual({ map: stage.map_id, exists: true });
        });

        // A stage that states its objective is won by it and by nothing else:
        // with a second condition a bot, which holds no mission there, would
        // still be racing the player to that one.
        it(`stage ${label} states an objective the board can carry`, () => {
          if (!stage.mission) {
            expect(stage.title).toBeUndefined();
            return;
          }
          expect(stage.title).toBeTruthy();
          expect(stage.allowed_victory_conditions).toEqual(['secret_mission']);
          // Without a clock the bots, holding no mission, could not win at all.
          expect(stage.max_turns).toBeGreaterThanOrEqual(MIN_ACCEPTED_MAX_TURNS);
          const map = JSON.parse(readFileSync(join(MAPS_DIR, `${stage.map_id}.json`), 'utf-8')) as {
            territories: Array<{ territory_id: string; region_id: string; unlock_era_index?: number }>;
          };
          const inPlay = map.territories.filter((t) => !t.unlock_era_index);
          const m = stage.mission;
          if (m.kind === 'control_regions') {
            const empty = m.region_ids.filter((r) => !inPlay.some((t) => t.region_id === r));
            expect({ stage: label, empty }).toEqual({ stage: label, empty: [] });
          } else if (m.kind === 'capture_territories') {
            const missing = m.territory_ids.filter((id) => !inPlay.some((t) => t.territory_id === id));
            expect({ stage: label, missing }).toEqual({ stage: label, missing: [] });
          } else {
            expect(stage.ai_factions).toContain(m.faction_id);
          }
        });
      });
    });
  }
});

describe('campaign lines', () => {
  const path = CAMPAIGN_PATHS.blood_empire;
  const lines = path.lines!;

  it('gives every side a stage for each era from the choice to the end', () => {
    expect(lines.options.map((o) => o.line_id)).toContain(lines.default_line);
    expect(new Set(lines.options.map((o) => o.line_id)).size).toBe(lines.options.length);
    for (const option of lines.options) {
      const indexes = Object.keys(option.eras).map(Number).sort();
      const expected = CAMPAIGN_ERAS.map((_, i) => i).filter((i) => i >= lines.choose_at);
      expect({ line: option.line_id, indexes }).toEqual({ line: option.line_id, indexes: expected });
    }
  });

  it('keeps `eras` a whole path: the default side\'s stages from the choice on', () => {
    const fallback = lines.options.find((o) => o.line_id === lines.default_line)!;
    for (let i = lines.choose_at; i < CAMPAIGN_ERAS.length; i++) {
      expect(path.eras[i]).toBe(fallback.eras[i]);
    }
  });

  it('plays the side stored, the default with none stored or one it does not know', () => {
    expect(getPathEraConfig('blood_empire', 3, 'soviets')?.locked_faction).toBe('soviet_union');
    expect(getPathEraConfig('blood_empire', 4, 'soviets')?.locked_faction).toBe('ussr');
    expect(getPathEraConfig('blood_empire', 5, 'soviets')?.locked_faction).toBe('eastern_bloc');
    expect(getPathEraConfig('blood_empire', 3, 'allies')?.locked_faction).toBe('usa');
    expect(getPathEraConfig('blood_empire', 3)?.locked_faction).toBe('usa');
    expect(getPathEraConfig('blood_empire', 3, 'axis')?.locked_faction).toBe('usa');
    // Before the choice there is one stage, whatever is stored.
    expect(getPathEraConfig('blood_empire', 0, 'soviets')).toBe(path.eras[0]);
    expect(resolveLineId('blood_empire', 'soviets')).toBe('soviets');
    expect(resolveLineId('blood_empire', undefined)).toBe('allies');
    // A path with no sides has none to resolve.
    expect(resolveLineId('last_defenders', 'soviets')).toBeNull();
    expect(getPathEraConfig('last_defenders', 3, 'soviets')).toBe(CAMPAIGN_PATHS.last_defenders.eras[3]);
  });

  it('describes the choice: both sides, and which is taken', () => {
    const open = describeLineChoice('blood_empire', undefined)!;
    expect(open.choose_at).toBe(3);
    expect(open.chosen).toBeNull();
    expect(open.options.map((o) => [o.line_id, o.faction_id])).toEqual([['allies', 'usa'], ['soviets', 'soviet_union']]);
    expect(open.options.every((o) => o.title && o.pitch && o.name)).toBe(true);
    expect(describeLineChoice('blood_empire', 'soviets')!.chosen).toBe('soviets');
    expect(describeLineChoice('revolutionary_flame', 'soviets')).toBeNull();
  });

  it('never seats the player as the power that started the war', () => {
    for (const option of lines.options) {
      expect(['germany', 'japan']).not.toContain(option.eras[3]!.locked_faction);
    }
  });
});
