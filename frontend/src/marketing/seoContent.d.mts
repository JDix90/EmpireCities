/** Types for the framework-free marketing copy in seoContent.mjs. */

export interface EraEntry {
  label: string;
  years: string;
  blurb: string;
}

export interface FaqEntry {
  q: string;
  a: string;
}

export interface FactEntry {
  k: string;
  v: string;
}

export type MarketingBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'answer'; text: string }
  | { type: 'facts'; facts: FactEntry[] }
  | { type: 'eras' }
  /** Unscoped is the whole codex (/codex); `era_id` is one era's roster (/eras/:slug). */
  | { type: 'factions'; era_id?: string }
  | { type: 'faq' }
  | { type: 'links'; links: Array<{ href: string; label: string }> };

export interface MarketingPage {
  /** The url. The prerender script derives the output file from it. */
  path: string;
  title: string;
  description: string;
  h1: string;
  tagline: string;
  jsonLd: boolean;
  /** Emit the site-wide FAQ as FAQPage structured data. */
  faq?: boolean;
  /** This page's own questions, emitted as its FAQPage structured data. */
  qa?: FaqEntry[];
  blocks: MarketingBlock[];
}

export const SITE_URL: string;
export const OG_IMAGE: string;
export const ERAS: EraEntry[];
export const ERA_CODEX_LABELS: Record<string, string>;
export const FAQ: FaqEntry[];
export const SOCIAL_LINKS: string[];
export const MARKETING_PAGES: MarketingPage[];

export function blocksToHtml(blocks: MarketingBlock[]): string;
export function getMarketingPage(path: string): MarketingPage | undefined;
