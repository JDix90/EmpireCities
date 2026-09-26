import React from 'react';
import type { CatalogSection } from './storeCatalog';

/** What is earned in play, as a wall of compact cards, with how much of it the player has. */
export default function EarnedWall({
  section,
  canTryOn,
  children,
}: {
  section: CatalogSection;
  /** Say that a tile tries its item on (not for guests). */
  canTryOn: boolean;
  children: React.ReactNode;
}) {
  const headingId = `store-section-${section.id}`;
  const earned = section.items.filter((i) => i.owned).length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="font-display text-xl font-semibold text-[#f1ede2] sm:text-2xl">
            {section.title}
          </h2>
          <p className="text-xs text-bf-muted sm:text-[13px]">
            {section.subtitle}
            {canTryOn && ' Choose one to try it on.'}
          </p>
        </div>
        <span className="rounded-full border border-bf-border bg-[#151a26] px-3 py-1.5 text-xs text-bf-text sm:text-[13px]">
          {earned} of {section.items.length} earned
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
        {children}
      </div>
    </section>
  );
}
