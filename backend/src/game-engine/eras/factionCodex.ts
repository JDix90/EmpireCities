/**
 * The public faction codex: the projection of the era definitions that is safe
 * and useful to publish as static, crawlable HTML.
 *
 * `/codex` used to be invisible to search. It is a public route with real
 * content — every faction's name, ability and lore — but it fetched that
 * content client-side, so it served the SPA shell, inherited the shell's
 * homepage canonical, and told Google it was a duplicate of the landing page.
 * It could never rank. Prerendering it needs the faction data available to a
 * plain Node build script, which cannot import this TypeScript.
 *
 * So `scripts/generateFactionCodex.ts` writes this projection to
 * `frontend/src/marketing/factionCodex.generated.mjs`, which both the
 * prerender script and the live React page read. `factionCodexExport.test.ts`
 * fails if the committed file drifts from what this function produces, which
 * is what keeps the published lore honest without a build-time network call.
 *
 * Deliberately a PROJECTION, not the raw `Faction`: `home_region_ids` and
 * `ability_id` are placement and wiring internals with no reader value, and
 * the fields kept here are exactly the ones `FactionLoreModal` renders.
 */
import type { EraId } from '../../types';
import type { Faction } from './types';
import { getEraFactions } from './index';

/**
 * Era ids in the order the codex presents them — the chronological arc.
 * `satisfies` rather than an annotation: it keeps the literal types AND makes
 * a typo'd or retired era id a compile error here instead of an era that
 * silently renders empty.
 */
export const CODEX_ERA_IDS = [
  'ancient',
  'medieval',
  'discovery',
  'ww2',
  'coldwar',
  'modern',
  'acw',
  'risorgimento',
  'space_age',
  'galaxy_age',
] as const satisfies readonly EraId[];

export interface CodexFaction {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  color?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  tech_cost_discount?: number;
  stability_recovery_bonus?: number;
  ability_description?: string;
}

export interface CodexEra {
  era_id: string;
  factions: CodexFaction[];
}

/**
 * Drop undefined keys so the generated file — and the diff when a faction
 * changes — stays readable, and so a round-trip through JSON compares equal.
 */
function project(f: Faction): CodexFaction {
  const out: CodexFaction = {
    faction_id: f.faction_id,
    name: f.name,
    description: f.description,
  };
  if (f.lore !== undefined) out.lore = f.lore;
  if (f.flavor_quote !== undefined) out.flavor_quote = f.flavor_quote;
  if (f.color !== undefined) out.color = f.color;
  if (f.passive_attack_bonus !== undefined) out.passive_attack_bonus = f.passive_attack_bonus;
  if (f.passive_defense_bonus !== undefined) out.passive_defense_bonus = f.passive_defense_bonus;
  if (f.reinforce_bonus !== undefined) out.reinforce_bonus = f.reinforce_bonus;
  if (f.tech_cost_discount !== undefined) out.tech_cost_discount = f.tech_cost_discount;
  if (f.stability_recovery_bonus !== undefined) out.stability_recovery_bonus = f.stability_recovery_bonus;
  if (f.ability_description !== undefined) out.ability_description = f.ability_description;
  return out;
}

/** Every era that has factions, in codex order. Eras with none are omitted. */
export function buildFactionCodex(): CodexEra[] {
  return CODEX_ERA_IDS
    .map((era_id) => ({ era_id, factions: getEraFactions(era_id).map(project) }))
    .filter((era) => era.factions.length > 0);
}


/**
 * Render the generated module. Kept here rather than in the script so the
 * drift test can compare against the exact bytes the writer would produce —
 * a test that regenerated the data by a different route would pass while the
 * committed file was wrong.
 */
export function renderCodexModule(codex: CodexEra[]): string {
  const total = codex.reduce((n, e) => n + e.factions.length, 0);
  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: backend/src/game-engine/eras/*.ts, projected by
 * backend/src/game-engine/eras/factionCodex.ts.
 * Regenerate: pnpm -C backend exec tsx scripts/generateFactionCodex.ts
 *
 * Committed on purpose: the prerender script is plain Node and the build must
 * not depend on the live API. A backend test fails if this drifts from the era
 * definitions, so an edit here would be reverted by the next regeneration.
 */
export const FACTION_CODEX = ${JSON.stringify(codex, null, 2)};

/** Total factions across every era — for copy that quotes a count. */
export const FACTION_COUNT = ${total};
`;
}
