import React from 'react';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import { ERAS, getMarketingPage, type MarketingBlock } from '../marketing/seoContent.mjs';

/*
 * Public marketing page for the era roster. Reads its copy from the shared
 * framework-free `seoContent.mjs` so the live SPA page and the build-time
 * prerendered (crawlable, no-JS) HTML stay in sync. See scripts/prerender-marketing.mjs.
 */

const PAGE = getMarketingPage('/eras')!;

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
    case 'eras':
      return (
        <ol key={i} className="space-y-3">
          {ERAS.map((era, idx) => (
            <li
              key={era.label}
              className="border border-bf-border rounded-xl bg-bf-surface px-5 py-4"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-display text-lg text-bf-text">
                  {idx + 1}. {era.label}
                </span>
                <span className="text-xs text-bf-muted">{era.years}</span>
              </div>
              <p className="text-sm text-bf-muted leading-relaxed mt-1">{era.blurb}</p>
            </li>
          ))}
        </ol>
      );
    case 'links':
      return (
        <div key={i} className="flex flex-wrap gap-3 pt-2">
          {block.links.map((link) => (
            <Link
              key={link.href}
              to={link.href}
              className="text-bf-gold hover:underline text-sm"
            >
              {link.label}
            </Link>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export default function ErasPage() {
  return (
    <SubpageShell
      title="ERAS"
      icon={Layers}
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
