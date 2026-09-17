/**
 * The committed faction codex must match the era definitions it was generated
 * from.
 *
 * `frontend/src/marketing/factionCodex.generated.mjs` is published as static,
 * crawlable HTML on /codex. Nothing at runtime reads the backend to build that
 * page — the prerender script is plain Node and the build must not depend on
 * the live API — so a faction edit that forgets to re-run the generator would
 * ship lore that contradicts the game, indefinitely and invisibly.
 *
 * Comparing the rendered BYTES rather than re-deriving the data is deliberate:
 * a test that rebuilt the file by its own route could pass while the committed
 * file was wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFactionCodex, renderCodexModule, CODEX_ERA_IDS } from './factionCodex';
import { CODEX_OUTPUT_PATH } from '../../../scripts/generateFactionCodex';

describe('faction codex export', () => {
  it('matches the committed generated file', () => {
    const committed = readFileSync(CODEX_OUTPUT_PATH, 'utf8');
    const expected = renderCodexModule(buildFactionCodex());
    expect(
      committed === expected
        ? true
        : 'stale — run: pnpm -C backend exec tsx scripts/generateFactionCodex.ts',
    ).toBe(true);
  });

  it('publishes every era that has factions, in chronological order', () => {
    const codex = buildFactionCodex();
    const order = codex.map((e) => e.era_id);
    // A subsequence of the canonical order: eras with no factions drop out,
    // but the ones that remain never reshuffle.
    expect(order).toEqual(CODEX_ERA_IDS.filter((id) => order.includes(id)));
    expect(codex.length).toBeGreaterThan(0);
  });

  it('gives every faction the fields the public page renders', () => {
    for (const era of buildFactionCodex()) {
      for (const f of era.factions) {
        expect(f.faction_id, `${era.era_id} faction_id`).toBeTruthy();
        expect(f.name, `${era.era_id}/${f.faction_id} name`).toBeTruthy();
        // The description is the crawlable sentence under each faction name.
        // A blank one publishes a bare list of proper nouns.
        expect(f.description.length, `${era.era_id}/${f.faction_id} description`).toBeGreaterThan(20);
      }
    }
  });

  it('leaves placement and wiring internals out of the published projection', () => {
    // home_region_ids and ability_id are engine internals with no reader value.
    // They are also the fields most likely to change for balance reasons, which
    // would otherwise churn a published page for nothing.
    const raw = JSON.stringify(buildFactionCodex());
    expect(raw).not.toContain('home_region_ids');
    expect(raw).not.toContain('ability_id');
  });
});
