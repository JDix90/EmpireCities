/**
 * A test game on a map: the author against bots, started at once, private.
 *
 * The server lets an unpublished map into a game only for its author and
 * only once it passes the publish checks (checkMapPlayable); the editor's
 * Map health panel shows the same list, so a refusal here names something
 * the author can already see.
 */

import { api } from '../services/api';
import { withRequiredEraSystems } from './eraSystemDefaults';
import { QUICK_MATCH_VICTORY_PLANS } from './quickMatchPrefs';

/** Rules eras an Earth map can be played under. */
export const TEST_PLAY_ERAS = ['ancient', 'medieval', 'discovery', 'risorgimento', 'acw', 'ww2', 'coldwar', 'modern'] as const;
export type TestPlayEra = (typeof TEST_PLAY_ERAS)[number];

export const TEST_PLAY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type TestPlayDifficulty = (typeof TEST_PLAY_DIFFICULTIES)[number];

export interface TestPlayOptions {
  mapId: string;
  era: TestPlayEra;
  /** Bot opponents, 1–5. */
  opponents: number;
  difficulty: TestPlayDifficulty;
}

export const TEST_PLAY_DEFAULTS: Omit<TestPlayOptions, 'mapId'> = {
  era: 'modern',
  opponents: 3,
  difficulty: 'medium',
};

/** The rules era to offer first: the map's own tag when it is a playable era, else Modern. */
export function defaultTestPlayEra(eraTheme: string | null | undefined): TestPlayEra {
  return (TEST_PLAY_ERAS as readonly string[]).includes(eraTheme ?? '') ? (eraTheme as TestPlayEra) : 'modern';
}

export function clampOpponents(n: number): number {
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** Creates and auto-starts the game; resolves to its id. Throws the API error. */
export async function startTestGame(options: TestPlayOptions): Promise<string> {
  const opponents = clampOpponents(options.opponents);
  const plan = QUICK_MATCH_VICTORY_PLANS.majority;
  const res = await api.post<{ game_id: string }>('/games', {
    era_id: options.era,
    map_id: options.mapId,
    // Auto-start needs every other seat AI-filled, so the table is the bots plus one.
    max_players: opponents + 1,
    ai_count: opponents,
    ai_difficulty: options.difficulty,
    auto_start: true,
    is_private: true,
    settings: withRequiredEraSystems(options.era, {
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      allowed_victory_conditions: [...plan.allowed_victory_conditions],
      ...(plan.victory_threshold != null ? { victory_threshold: plan.victory_threshold } : {}),
      max_turns: plan.max_turns,
    }),
  });
  return res.data.game_id;
}
