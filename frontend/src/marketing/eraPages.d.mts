/** Types for the era detail pages in eraPages.mjs. */
import type { CatalogMap } from './mapCatalog.generated.d.mts';
import type { CodexFaction } from './factionCodex.generated.d.mts';
import type { MarketingBlock, MarketingPage } from './seoContent.d.mts';

export interface EraPageCopy {
  /** Must match the era's entry in the ERAS arc; contentFamilies.test.ts asserts it. */
  years: string;
  title: string;
  description: string;
  h1: string;
  hook: string;
}

export type EraPage = EraPageCopy & {
  era_id: string;
  factions: CodexFaction[];
  /** The era's default board, or undefined if it has none. */
  board?: CatalogMap;
};

export const ERA_PAGE_COPY: Record<string, EraPageCopy>;
export const ERA_PAGES: EraPage[];
export function eraPageBlocks(era: EraPage): MarketingBlock[];
export function buildEraMarketingPages(): MarketingPage[];
