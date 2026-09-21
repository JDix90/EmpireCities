/** Types for the curated map pages in mapPages.mjs. */
import type { CatalogMap } from './mapCatalog.generated.d.mts';
import type { MarketingBlock, MarketingPage } from './seoContent.d.mts';

export interface MapPageCopy {
  title: string;
  description: string;
  h1: string;
  /** The hand-written read of how this board plays. */
  hook: string;
}

export type MapPage = CatalogMap & MapPageCopy;

export const MAP_PAGE_COPY: Record<string, MapPageCopy>;
export const MAP_PAGES: MapPage[];
export function mapPageBlocks(map: MapPage): MarketingBlock[];
export function buildMapMarketingPages(): MarketingPage[];
