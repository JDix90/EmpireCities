import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getEraFactions } from './index';
import type { EraId } from '../../types';

const ERAS: EraId[] = [
  'ancient', 'medieval', 'discovery', 'ww2', 'coldwar',
  'modern', 'acw', 'risorgimento', 'space_age', 'galaxy_age',
];

const CATALOG = join(__dirname, '../../../../docs/LORE_AND_MAPS_CATALOG.md');

/**
 * docs/LORE_AND_MAPS_CATALOG.md calls itself "player-facing and design-facing"
 * and says its strings are transcribed from the codebase. Nothing kept them
 * transcribed, so sixteen entries across eight factions had drifted — some of
 * them describing mechanics that were removed eras ago.
 *
 * It mattered because the drift was not random. The catalog carried FIVE
 * defence-die claims the code had never had (hre, byzantine, ww2 uk,
 * confederacy, carthage) and advertised named abilities for four factions that
 * have no `ability_id` at all: Naval Supremacy, Conquistador, Commonwealth and
 * Southern Defense are buttons nobody has ever been able to press.
 *
 * Matching is scoped to the era section a line sits in. "Soviet Union",
 * "United States" and "United Kingdom" each name two different factions in two
 * different eras, and a name-only match silently rewrites the wrong one — which
 * is exactly what happened while fixing this by hand, clobbering ww2's Soviet
 * Union with the Cold War entry.
 */
describe('lore catalog matches the faction data', () => {
  const doc = readFileSync(CATALOG, 'utf8');

  const byEra = new Map<string, Map<string, { d: string; a: string | null }>>();
  for (const era of ERAS) {
    byEra.set(era, new Map(getEraFactions(era).map((f) => [
      f.name, { d: f.description, a: f.ability_description ?? null },
    ])));
  }

  /** Every `- **Name** — *description*[ — Ability: *…*]` line, with its era. */
  const entries: { era: string; name: string; d: string; a: string | null }[] = [];
  let era: string | null = null;
  for (const line of doc.split('\n')) {
    const header = /^### `(\w+)`$/.exec(line.trim());
    if (header) { era = header[1]!; continue; }
    const row = /^- \*\*(.+?)\*\* — \*(.*?)\*(?: — Ability: \*(.*?)\*)?$/.exec(line);
    if (row && era && byEra.has(era)) {
      entries.push({ era, name: row[1]!, d: row[2]!, a: row[3] ?? null });
    }
  }

  it('finds the faction entries it is meant to guard', () => {
    // A parser that silently matches nothing would make every assertion below
    // pass while the catalog rotted.
    expect(entries.length).toBeGreaterThanOrEqual(50);
  });

  it('every catalog entry names a faction that exists in that era', () => {
    const unknown = entries
      .filter((e) => !byEra.get(e.era)!.has(e.name))
      .map((e) => `${e.era}/${e.name}`);
    expect(unknown).toEqual([]);
  });

  it('no description or ability line has drifted from the code', () => {
    const drift: string[] = [];
    for (const e of entries) {
      const c = byEra.get(e.era)!.get(e.name);
      if (!c) continue;
      if (e.d !== c.d) drift.push(`${e.era}/${e.name} description:\n  doc : ${e.d}\n  code: ${c.d}`);
      if (e.a !== c.a) drift.push(`${e.era}/${e.name} ability:\n  doc : ${e.a}\n  code: ${c.a}`);
    }
    expect(drift).toEqual([]);
  });
});
