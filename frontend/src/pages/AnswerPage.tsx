/**
 * Renders the question-shaped answer pages at /answers and /answers/:slug.
 *
 * Content comes from `marketing/seoContent.mjs` — the same module
 * `scripts/prerender-marketing.mjs` reads at build time to write the crawlable
 * HTML. One source, so the page a crawler is served and the page a human sees
 * after React boots cannot drift apart. Adding a page means adding an entry to
 * MARKETING_PAGES; this component needs no change.
 */
import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { getMarketingPage } from '../marketing/seoContent.mjs';
import type { MarketingBlock, MarketingPage } from '../marketing/seoContent.d.mts';

function useDocumentMeta(title: string, description: string): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const tag = document.querySelector('meta[name="description"]');
    const previousDescription = tag?.getAttribute('content') ?? null;
    if (tag) tag.setAttribute('content', description);
    return () => {
      document.title = previousTitle;
      if (tag && previousDescription !== null) tag.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}

function Block({ block }: { block: MarketingBlock }) {
  switch (block.type) {
    case 'h2':
      return <h2 className="font-display text-lg text-bf-gold mt-6">{block.text}</h2>;
    case 'p':
      return <p className="text-sm text-bf-muted leading-relaxed">{block.text}</p>;
    case 'answer':
      return (
        <p className="text-bf-text leading-relaxed border-l-[3px] border-bf-gold pl-4">
          <span className="font-semibold">Short answer:</span> {block.text}
        </p>
      );
    case 'facts':
      return (
        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-sm">
          {block.facts.map((fact) => (
            <React.Fragment key={fact.k}>
              <dt className="text-bf-muted mt-2 sm:mt-0">{fact.k}</dt>
              <dd className="text-bf-text mb-2 sm:mb-0">{fact.v}</dd>
            </React.Fragment>
          ))}
        </dl>
      );
    case 'links':
      return (
        <nav className="flex gap-4 flex-wrap text-sm pt-2">
          {block.links.map((link) => (
            <Link key={link.href} to={link.href} className="text-bf-gold hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      );
    default:
      // `eras` and `faq` blocks belong to pages with their own bespoke React
      // components; an answer page never uses them.
      return null;
  }
}

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
        {page.blocks.map((block, i) => (
          <Block key={`${block.type}-${i}`} block={block} />
        ))}
      </article>
    </SubpageShell>
  );
}
