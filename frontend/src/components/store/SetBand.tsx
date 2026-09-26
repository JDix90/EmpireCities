import React from 'react';
import CosmeticGlyph from '../cosmetics/CosmeticGlyph';
import { bandStyle } from './storeStyles';
import type { CatalogSection } from './storeCatalog';

/**
 * A band of the store: an era set on its own backdrop, with how much of it the
 * player has collected, or the plain band of everything else for sale. Wide:
 * the title beside four cards. Phone: the title over a row of cards to swipe.
 * Give each card `STORE_BAND_CARD` so the row lays out on every width.
 */
export default function SetBand({ section, children }: { section: CatalogSection; children: React.ReactNode }) {
  const style = bandStyle(section.setId);
  const headingId = `store-section-${section.id}`;
  const collected = section.kind === 'set' ? section.collected : undefined;
  return (
    <section
      aria-labelledby={headingId}
      data-testid="store-band"
      className="relative overflow-hidden rounded-2xl border p-4 sm:p-6"
      style={{ borderColor: style.edge, background: style.backdrop }}
    >
      <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6">
        <header className="relative flex flex-wrap items-end justify-between gap-x-4 gap-y-3 lg:flex-col lg:flex-nowrap lg:items-start lg:justify-start">
          <div className="relative z-10 flex flex-col gap-1">
            {section.era && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] sm:text-[11px]" style={{ color: style.accent }}>
                {section.era}
              </span>
            )}
            <h2 id={headingId} className="font-display text-2xl font-bold leading-tight text-[#f5f0e1] lg:text-3xl">
              {section.title}
            </h2>
            <p className="text-xs leading-relaxed text-[#aab3c3] sm:text-[13px]">{section.subtitle}</p>
          </div>
          {collected && collected.total > 0 && (
            <div className="relative z-10 flex flex-col items-start gap-1.5 sm:items-end lg:mt-2 lg:items-start">
              <span className="flex gap-1.5" aria-hidden>
                {Array.from({ length: collected.total }, (_, i) => (
                  <span
                    key={i}
                    className="block h-1.5 w-6 rounded-full lg:w-8"
                    style={i < collected.owned
                      ? { background: style.accent, boxShadow: `0 0 10px ${style.accent}` }
                      : { background: 'rgba(255, 255, 255, 0.12)' }}
                  />
                ))}
              </span>
              <span className="text-xs text-bf-text">
                {collected.owned} of {collected.total} collected
              </span>
            </div>
          )}
          {style.emblem && (
            <CosmeticGlyph
              glyph={style.emblem}
              color={style.accent}
              strokeWidth={0.6}
              className="store-float pointer-events-none absolute -bottom-20 -left-8 hidden h-48 w-48 opacity-[0.16] lg:block"
            />
          )}
        </header>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-3.5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
          {children}
        </div>
      </div>
    </section>
  );
}

/** A card's width in a band: a fixed width to swipe through on phones, the grid's column above. */
export const STORE_BAND_CARD = 'w-[168px] shrink-0 snap-start sm:w-auto';
