import React from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import { getMarketingPage, type MarketingBlock } from '../marketing/seoContent.mjs';

/*
 * Public "About" page. Reads its copy from the shared, framework-free
 * `seoContent.mjs` so the live SPA page and the build-time prerendered
 * (crawlable, no-JS) HTML stay in sync — the story reaches users AND crawlers,
 * with no risk of cloaking. See scripts/prerender-marketing.mjs.
 */

const PAGE = getMarketingPage('/about')!;

function renderBlock(block: MarketingBlock, i: number) {
  switch (block.type) {
    case 'h2':
      return (
        <h2 key={i} className="font-display text-xl text-bf-gold pt-2">
          {block.text}
        </h2>
      );
    case 'p':
      return (
        <p key={i} className="text-bf-muted leading-relaxed">
          {block.text}
        </p>
      );
    case 'links':
      return (
        <div key={i} className="flex flex-wrap gap-3 pt-2">
          {block.links.map((link) => (
            <Link key={link.href} to={link.href} className="text-bf-gold hover:underline text-sm">
              {link.label}
            </Link>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export default function AboutPage() {
  return (
    <SubpageShell
      title="ABOUT"
      icon={Heart}
      backHref="/"
      backLabel="Home"
      maxWidth="2xl"
      contentClassName="space-y-5 pb-12"
    >
      <p className="text-bf-muted italic">{PAGE.tagline}</p>
      {PAGE.blocks.map(renderBlock)}
    </SubpageShell>
  );
}
