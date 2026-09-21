/**
 * The React half of the block renderer.
 *
 * `blocksToHtml` in marketing/seoContent.mjs renders these same blocks to
 * static HTML for crawlers; this renders them for the visitor who arrives and
 * boots the SPA. The two must show the same content — a crawler being served
 * something other than what a person sees is the definition of cloaking, and
 * the repo already has a test asserting the era labels match for exactly that
 * reason.
 *
 * So this lives in one place rather than being copied per page: the failure
 * mode of a second copy is not a bug that shows up in a test run, it is a page
 * that quietly stops matching the HTML it was indexed from.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import type { MarketingBlock } from '../../marketing/seoContent.d.mts';
import { ERA_CODEX_LABELS } from '../../marketing/seoContent.mjs';
import { FACTION_CODEX } from '../../marketing/factionCodex.generated.mjs';

interface CodexFaction {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  ability_description?: string;
}

interface CodexEra {
  era_id: string;
  factions: CodexFaction[];
}

/** One era's roster, or the whole codex when `eraId` is undefined. */
function Factions({ eraId }: { eraId?: string }) {
  const eras: CodexEra[] = eraId
    ? (FACTION_CODEX as CodexEra[]).filter((e) => e.era_id === eraId)
    : (FACTION_CODEX as CodexEra[]);
  return (
    <>
      {eras.map((era) => (
        <React.Fragment key={era.era_id}>
          {/* On an era page the heading would only repeat the page's own h1,
              which is why blocksToHtml omits it there too. */}
          {!eraId && (
            <h2 className="font-display text-lg text-bf-gold mt-6">
              {ERA_CODEX_LABELS[era.era_id] ?? era.era_id}
            </h2>
          )}
          <dl className="space-y-4">
            {era.factions.map((f) => (
              <div key={f.faction_id}>
                <dt className="text-bf-text font-semibold">{f.name}</dt>
                <dd className="text-sm text-bf-muted leading-relaxed space-y-1 mt-1">
                  <p>{f.description}</p>
                  {f.lore && <p>{f.lore}</p>}
                  {f.ability_description && (
                    <p>
                      <span className="text-bf-text font-semibold">Ability:</span>{' '}
                      {f.ability_description}
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </React.Fragment>
      ))}
    </>
  );
}

export function MarketingBlockView({ block }: { block: MarketingBlock }) {
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
    case 'factions':
      return <Factions eraId={block.era_id} />;
    default:
      // `eras` and `faq` belong to pages with their own bespoke components
      // (ErasPage, HowToPlayPage), which render them with more than a list.
      return null;
  }
}

export function MarketingBlocks({ blocks }: { blocks: MarketingBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <MarketingBlockView key={`${block.type}-${i}`} block={block} />
      ))}
    </>
  );
}

export default MarketingBlocks;
