import React, { useState } from 'react';
import { BookOpen } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import FactionLoreModal, { type FactionLoreInfo } from '../components/game/FactionLoreModal';
import { FACTION_CODEX } from '../marketing/factionCodex.generated.mjs';

/**
 * /codex — every faction, grouped by era.
 *
 * Reads the generated codex rather than fetching, for two reasons:
 *
 *  - PARITY. This page is prerendered into static HTML at build time
 *    (frontend/scripts/prerender-marketing.mjs) so it can actually be indexed;
 *    it previously served the SPA shell and inherited its homepage canonical,
 *    which told Google it was a duplicate of the landing page. Rendering the
 *    live page from the same data is what keeps what a crawler is served and
 *    what a visitor sees identical — the same reason the FAQ on /how-to-play
 *    comes out of seoContent.mjs.
 *  - COST. It used to fire ten API calls on mount, one per era, for data that
 *    is static and known at build time.
 *
 * The generated module is committed and a backend test fails if it drifts from
 * the era definitions, so this cannot silently show stale factions.
 */
export default function CodexPage() {
  const [selected, setSelected] = useState<FactionLoreInfo | null>(null);

  return (
    <SubpageShell title="FACTION CODEX" icon={BookOpen} maxWidth="4xl" contentClassName="space-y-8">
      <p className="text-bf-muted text-sm -mt-2">Browse all factions across every era.</p>
      <p className="text-bf-muted/70 text-xs -mt-6 flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-bf-gold/70 inline-block" />
        The colored dot shows each faction&apos;s identity color on the map.
      </p>

      {FACTION_CODEX.map((era) => (
        <section key={era.era_id} className="mb-10">
          <h2 className="font-display text-xl text-bf-text mb-4 flex items-center gap-2">
            {ERA_LABELS[era.era_id] ?? era.era_id}
            {era.era_id === 'galaxy_age' && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-bf-gold/40 text-bf-gold/80">
                Coming soon
              </span>
            )}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {era.factions.map((f) => (
              <button
                key={f.faction_id}
                onClick={() => setSelected(f)}
                className="text-left p-3 rounded-lg bg-bf-surface border border-bf-border
                           hover:border-bf-gold/40 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  {f.color && (
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: f.color }} />
                  )}
                  <p className="font-medium text-bf-text text-sm truncate">{f.name}</p>
                </div>
                <p className="text-bf-muted text-xs line-clamp-2">{f.description}</p>
              </button>
            ))}
          </div>
        </section>
      ))}

      {selected && <FactionLoreModal faction={selected} onClose={() => setSelected(null)} />}
    </SubpageShell>
  );
}
