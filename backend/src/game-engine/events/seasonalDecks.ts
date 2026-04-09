// ============================================================
// Seasonal Era Events — code-configured windows, no DB
// ============================================================

import type { EventCard } from '../../types';

export interface SeasonalPeriod {
  era_id: string;
  name: string;
  description: string;
  /** MM-DD format, inclusive start (e.g. '06-01') */
  start_mmdd: string;
  /** MM-DD format, inclusive end (e.g. '08-31') */
  end_mmdd: string;
  cards: EventCard[];
}

/** Returns true if today's MM-DD falls within [start_mmdd, end_mmdd]. */
export function isSeasonalActive(period: SeasonalPeriod, now: Date): boolean {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${mm}-${dd}`;
  return today >= period.start_mmdd && today <= period.end_mmdd;
}

// ── Season definitions ─────────────────────────────────────────────────────

export const SEASONAL_EVENTS: SeasonalPeriod[] = [
  {
    era_id: 'ancient',
    name: 'Summer of Conquest',
    description: 'The summer campaigning season — armies march further and hit harder.',
    start_mmdd: '06-01',
    end_mmdd: '08-31',
    cards: [
      {
        card_id: 'seasonal_ancient_summer_1',
        title: 'Mongol Horde',
        description:
          'A nomadic horde sweeps from the east — the current player gains +2 bonus units on their largest territory.',
        category: 'global',
        era_id: 'ancient',
        effect: {
          type: 'units_added',
          target: 'player',
          value: 2,
        },
      },
      {
        card_id: 'seasonal_ancient_summer_2',
        title: 'Scorching Heat',
        description:
          'Blistering summer saps defenders — all defending armies lose 1 unit from their largest garrison.',
        category: 'global',
        era_id: 'ancient',
        effect: {
          type: 'units_removed',
          target: 'player',
          value: 1,
        },
        affects_all_players: true,
      },
    ],
  },
  {
    era_id: 'medieval',
    name: 'Crusade Season',
    description:
      'Holy war fever grips the land — faith and steel clash across the Mediterranean.',
    start_mmdd: '12-01',
    end_mmdd: '12-31',
    cards: [
      {
        card_id: 'seasonal_medieval_crusade_1',
        title: 'Call to Crusade',
        description:
          'The Pope calls the faithful — the current player gains +3 reinforcements this turn.',
        category: 'player_targeted',
        era_id: 'medieval',
        effect: {
          type: 'units_added',
          target: 'player',
          value: 3,
        },
      },
      {
        card_id: 'seasonal_medieval_crusade_2',
        title: 'Crusader Zeal',
        description: 'Religious fervor grants +1 attack die for the next 2 turns.',
        category: 'player_targeted',
        era_id: 'medieval',
        effect: {
          type: 'attack_modifier',
          target: 'player',
          value: 1,
          duration_turns: 2,
        },
      },
    ],
  },
  {
    era_id: 'ww2',
    name: 'Winter of Steel',
    description:
      'Eastern Front winter — supply lines freeze and defenders dig in deeply.',
    start_mmdd: '01-01',
    end_mmdd: '02-28',
    cards: [
      {
        card_id: 'seasonal_ww2_winter_1',
        title: 'General Winter',
        description:
          'Frost hampers offensives — all attackers lose 1 die for the next turn.',
        category: 'global',
        era_id: 'ww2',
        effect: {
          type: 'attack_modifier',
          target: 'player',
          value: -1,
          duration_turns: 1,
        },
        affects_all_players: true,
      },
      {
        card_id: 'seasonal_ww2_winter_2',
        title: 'Lend-Lease Convoy',
        description:
          'Allied supply ships arrive — the current player receives +4 units.',
        category: 'player_targeted',
        era_id: 'ww2',
        effect: {
          type: 'units_added',
          target: 'player',
          value: 4,
        },
      },
    ],
  },
];

/**
 * Returns seasonal event cards active today for a given era.
 * If no seasonal window is active, returns an empty array.
 */
export function getActiveSeasonalDeck(era: string, now: Date): EventCard[] {
  return SEASONAL_EVENTS.filter(
    (s) => s.era_id === era && isSeasonalActive(s, now),
  ).flatMap((s) => s.cards);
}

/** Returns all currently active seasonal periods (for the lobby badge endpoint). */
export function getActiveSeasonal(now: Date): Array<{
  era_id: string;
  name: string;
  description: string;
  ends_at: string;
}> {
  return SEASONAL_EVENTS.filter((s) => isSeasonalActive(s, now)).map((s) => ({
    era_id: s.era_id,
    name: s.name,
    description: s.description,
    ends_at: `${now.getFullYear()}-${s.end_mmdd}`,
  }));
}
