/**
 * The live React page for the generated content families: /game-maps,
 * /game-maps/:slug and /eras/:slug.
 *
 * One component for all of them, resolving its content from seoContent.mjs by
 * pathname — the same module the build prerenders the crawlable HTML from, so
 * the page a crawler is served and the page a visitor sees after React boots
 * cannot drift apart. Adding a map or an era needs no change here.
 *
 * The section chrome (heading strip, icon, back link) is the only thing that
 * differs between families, so it comes in as props.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import MarketingBlocks from '../components/marketing/MarketingBlocks';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useNoindex } from '../hooks/useNoindex';
import { getMarketingPage } from '../marketing/seoContent.mjs';
import type { MarketingPage } from '../marketing/seoContent.d.mts';

export interface SeoContentPageProps {
  /** The strip above the title, e.g. "MAPS". */
  section: string;
  icon: LucideIcon;
  /** Where the back link goes, and what it says. */
  backHref: string;
  backLabel: string;
  /** Shown when the path resolves to nothing — an unknown map or era slug. */
  missingTitle: string;
  missingBody: string;
}

export default function SeoContentPage({
  section, icon, backHref, backLabel, missingTitle, missingBody,
}: SeoContentPageProps) {
  const { pathname } = useLocation();
  // Trailing slashes reach the router intact, and /game-maps/rome/ is the same
  // page as /game-maps/rome — resolving both avoids a false not-found (and the
  // noindex that would come with it) on a URL someone typed by hand.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const page = getMarketingPage(normalized) as MarketingPage | undefined;

  useDocumentMeta(page?.title ?? missingTitle, page?.description);

  // An unknown slug renders "not found" copy under an HTTP 200, which a crawler
  // reads as a soft 404. Called before the early return below.
  useNoindex(!page);

  if (!page) {
    return (
      <SubpageShell
        titleAs="div"
        title={section}
        icon={icon}
        maxWidth="2xl"
        backHref={backHref}
        backLabel={backLabel}
        headerLeft={<BrandWordmark to="/" className="text-xl" />}
        contentClassName="space-y-4 pb-12"
      >
        <h1 className="font-display text-2xl text-bf-gold">{missingTitle}</h1>
        <p className="text-sm text-bf-muted">{missingBody}</p>
        <Link to={backHref} className="inline-block text-bf-gold hover:underline">
          {backLabel} →
        </Link>
      </SubpageShell>
    );
  }

  return (
    <SubpageShell
      titleAs="div"
      title={section}
      icon={icon}
      maxWidth="2xl"
      backHref={backHref}
      backLabel={backLabel}
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
