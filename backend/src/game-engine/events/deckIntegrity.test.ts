import { describe, it, expect } from 'vitest';
import { ancientEvents } from './decks/ancient';
import { medievalEvents } from './decks/medieval';
import { discoveryEvents } from './decks/discovery';
import { ww2Events } from './decks/ww2';
import { coldwarEvents } from './decks/coldwar';
import { modernEvents } from './decks/modern';
import { acwEvents } from './decks/acw';
import { risorgimentoEvents } from './decks/risorgimento';
import { spaceageEvents } from './decks/spaceage';
import { galaxyageEvents } from './decks/galaxyage';
import type { EventCard } from '../../types';

/**
 * Deck hygiene, unguarded until three collisions shipped.
 *
 * A second authoring pass padded several decks, and three of the new cards
 * reused an existing card's id with a different title and a different effect:
 * ga_lane_surge, acw_draft_riots and modern_economic_boom each named two
 * cards. resolveEventChoice matches the player's choice against
 * `active_event.card_id`, so a stale card of the same id resolves against the
 * wrong one, and anything counting cards by id silently merges the pair.
 */
const DECKS: Record<string, EventCard[]> = {
  ancient: ancientEvents,
  medieval: medievalEvents,
  discovery: discoveryEvents,
  ww2: ww2Events,
  coldwar: coldwarEvents,
  modern: modernEvents,
  acw: acwEvents,
  risorgimento: risorgimentoEvents,
  space_age: spaceageEvents,
  galaxy_age: galaxyageEvents,
};

const ALL = Object.values(DECKS).flat();

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

describe('event deck integrity', () => {
  it('gives every card a unique id across every deck', () => {
    expect(duplicates(ALL.map((c) => c.card_id))).toEqual([]);
  });

  it('gives every card a unique title within its own deck', () => {
    for (const [era, deck] of Object.entries(DECKS)) {
      expect({ era, dupes: duplicates(deck.map((c) => c.title)) }).toEqual({ era, dupes: [] });
    }
  });

  it('stamps every card with the era whose deck holds it', () => {
    for (const [era, deck] of Object.entries(DECKS)) {
      for (const card of deck) expect({ id: card.card_id, era: card.era_id }).toEqual({ id: card.card_id, era });
    }
  });
});
