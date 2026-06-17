/** Types for the framework-free marketing copy in seoContent.mjs. */

export interface EraEntry {
  label: string;
  years: string;
  blurb: string;
}

export type MarketingBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'eras' }
  | { type: 'links'; links: Array<{ href: string; label: string }> };

export interface MarketingPage {
  path: string;
  file: string;
  title: string;
  description: string;
  h1: string;
  tagline: string;
  jsonLd: boolean;
  blocks: MarketingBlock[];
}

export const SITE_URL: string;
export const OG_IMAGE: string;
export const ERAS: EraEntry[];
export const MARKETING_PAGES: MarketingPage[];

export function blocksToHtml(blocks: MarketingBlock[]): string;
export function getMarketingPage(path: string): MarketingPage | undefined;
