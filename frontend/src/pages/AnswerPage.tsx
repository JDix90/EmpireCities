/**
 * Renders the question-shaped answer pages at /answers and /answers/:slug.
 *
 * Content comes from `marketing/seoContent.mjs` — the same module
 * `scripts/prerender-marketing.mjs` reads at build time to write the crawlable
 * HTML. One source, so the page a crawler is served and the page a human sees
 * after React boots cannot drift apart. Adding a page means adding an entry to
 * MARKETING_PAGES; this component needs no change.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import MarketingBlocks from '../components/marketing/MarketingBlocks';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useNoindex } from '../hooks/useNoindex';
import { getMarketingPage } from '../marketing/seoContent.mjs';
import type { MarketingPage } from '../marketing/seoContent.d.mts';

export default function AnswerPage() {
  const { pathname } = useLocation();
  // Tolerate a trailing slash: /answers/ and /answers are the same page, and a
  // crawler or a pasted link will produce both.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const page = getMarketingPage(normalized) as MarketingPage | undefined;

  useDocumentMeta(
    page?.title ?? 'Borderfall — Questions, answered',
    page?.description ?? 'Direct answers to common questions about Borderfall.',
  );

  // An unknown slug renders "No such question" under an HTTP 200, which a
  // crawler reads as a soft 404. Called before the early return below.
  useNoindex(!page);

  if (!page) {
    return (
      <SubpageShell
        titleAs="div"
        title="ANSWERS"
        icon={HelpCircle}
        maxWidth="2xl"
        backHref="/answers"
        backLabel="Answers"
        headerLeft={<BrandWordmark to="/" className="text-xl" />}
        contentClassName="space-y-4 pb-12"
      >
        <h1 className="font-display text-2xl text-bf-gold">No such question</h1>
        <p className="text-sm text-bf-muted">That answer page doesn&rsquo;t exist.</p>
        <Link to="/answers" className="inline-block text-bf-gold hover:underline">
          Browse the questions →
        </Link>
      </SubpageShell>
    );
  }

  return (
    <SubpageShell
      titleAs="div"
      title="ANSWERS"
      icon={HelpCircle}
      maxWidth="2xl"
      backHref="/"
      backLabel="Borderfall"
      headerLeft={<BrandWordmark to="/" className="text-xl" />}
      contentClassName="space-y-4 pb-12"
    >
      <article className="space-y-4">
        <h1 className="font-display text-2xl sm:text-3xl text-bf-gold leading-tight">{page.h1}</h1>
        {page.tagline && <p className="text-bf-muted italic">{page.tagline}</p>}
        <MarketingBlocks blocks={page.blocks} />
      </article>
    </SubpageShell>
  );
}
