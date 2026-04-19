// ============================================================
// Era definitions barrel export
// ============================================================

export type { Faction, TechNode, EraWonder } from './types';

export { ANCIENT_FACTIONS, ANCIENT_TECH_TREE, ANCIENT_WONDER } from './ancient';
export { MEDIEVAL_FACTIONS, MEDIEVAL_TECH_TREE, MEDIEVAL_WONDER } from './medieval';
export { DISCOVERY_FACTIONS, DISCOVERY_TECH_TREE, DISCOVERY_WONDER } from './discovery';
export { WW2_FACTIONS, WW2_TECH_TREE, WW2_WONDER } from './ww2';
export { COLDWAR_FACTIONS, COLDWAR_TECH_TREE, COLDWAR_WONDER } from './coldwar';
export { MODERN_FACTIONS, MODERN_TECH_TREE, MODERN_WONDER } from './modern';
export { ACW_FACTIONS, ACW_TECH_TREE, ACW_WONDER } from './acw';
export { RISORGIMENTO_FACTIONS, RISORGIMENTO_TECH_TREE, RISORGIMENTO_WONDER } from './risorgimento';
export { SPACE_AGE_FACTIONS, SPACE_AGE_TECH_TREE, SPACE_AGE_WONDER } from './spaceage';

import type { Faction, TechNode, EraWonder } from './types';
import type { EraId } from '../../types';
import { ANCIENT_FACTIONS, ANCIENT_TECH_TREE, ANCIENT_WONDER } from './ancient';
import { MEDIEVAL_FACTIONS, MEDIEVAL_TECH_TREE, MEDIEVAL_WONDER } from './medieval';
import { DISCOVERY_FACTIONS, DISCOVERY_TECH_TREE, DISCOVERY_WONDER } from './discovery';
import { WW2_FACTIONS, WW2_TECH_TREE, WW2_WONDER } from './ww2';
import { COLDWAR_FACTIONS, COLDWAR_TECH_TREE, COLDWAR_WONDER } from './coldwar';
import { MODERN_FACTIONS, MODERN_TECH_TREE, MODERN_WONDER } from './modern';
import { ACW_FACTIONS, ACW_TECH_TREE, ACW_WONDER } from './acw';
import { RISORGIMENTO_FACTIONS, RISORGIMENTO_TECH_TREE, RISORGIMENTO_WONDER } from './risorgimento';
import { SPACE_AGE_FACTIONS, SPACE_AGE_TECH_TREE, SPACE_AGE_WONDER } from './spaceage';

const ERA_FACTIONS: Partial<Record<EraId, Faction[]>> = {
  ancient:      ANCIENT_FACTIONS,
  medieval:     MEDIEVAL_FACTIONS,
  discovery:    DISCOVERY_FACTIONS,
  ww2:          WW2_FACTIONS,
  coldwar:      COLDWAR_FACTIONS,
  modern:       MODERN_FACTIONS,
  acw:          ACW_FACTIONS,
  risorgimento: RISORGIMENTO_FACTIONS,
  space_age:    SPACE_AGE_FACTIONS,
};

const ERA_TECH_TREES: Partial<Record<EraId, TechNode[]>> = {
  ancient:      ANCIENT_TECH_TREE,
  medieval:     MEDIEVAL_TECH_TREE,
  discovery:    DISCOVERY_TECH_TREE,
  ww2:          WW2_TECH_TREE,
  coldwar:      COLDWAR_TECH_TREE,
  modern:       MODERN_TECH_TREE,
  acw:          ACW_TECH_TREE,
  risorgimento: RISORGIMENTO_TECH_TREE,
  space_age:    SPACE_AGE_TECH_TREE,
};

const ERA_WONDERS: Partial<Record<EraId, EraWonder>> = {
  ancient:      ANCIENT_WONDER,
  medieval:     MEDIEVAL_WONDER,
  discovery:    DISCOVERY_WONDER,
  ww2:          WW2_WONDER,
  coldwar:      COLDWAR_WONDER,
  modern:       MODERN_WONDER,
  acw:          ACW_WONDER,
  risorgimento: RISORGIMENTO_WONDER,
  space_age:    SPACE_AGE_WONDER,
};

export function getEraFactions(era: EraId): Faction[] {
  return ERA_FACTIONS[era] ?? [];
}

export function getEraTechTree(era: EraId): TechNode[] {
  return ERA_TECH_TREES[era] ?? [];
}

export function getEraWonder(era: EraId): EraWonder | undefined {
  return ERA_WONDERS[era];
}

export function getFactionById(era: EraId, factionId: string): Faction | undefined {
  return (ERA_FACTIONS[era] ?? []).find((f) => f.faction_id === factionId);
}

export function getTechNodeById(era: EraId, techId: string): TechNode | undefined {
  return (ERA_TECH_TREES[era] ?? []).find((n) => n.tech_id === techId);
}
