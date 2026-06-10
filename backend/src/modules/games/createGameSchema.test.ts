import { describe, it, expect } from 'vitest';
import { CreateGameSchema } from './games.routes';

/**
 * Regression guard: zod object schemas STRIP unknown keys, so any settings
 * field a lobby sends that is missing from the whitelist silently vanishes
 * before normalizeGameSettings ever sees it. That is how Quick Match's
 * 150-turn cap was disabled without any error.
 */
describe('CreateGameSchema settings whitelist', () => {
  const quickMatchPayload = {
    era_id: 'ancient',
    map_id: 'era_ancient',
    max_players: 4,
    ai_count: 3,
    ai_difficulty: 'medium',
    auto_start: true,
    settings: {
      turn_timer_seconds: 300,
      allowed_victory_conditions: ['domination'],
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      max_turns: 150,
    },
  };

  it('keeps max_turns from the Quick Match payload', () => {
    const parsed = CreateGameSchema.safeParse(quickMatchPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.settings.max_turns).toBe(150);
    }
  });

  it('rejects an out-of-range turn cap instead of silently dropping it', () => {
    const bad = {
      ...quickMatchPayload,
      settings: { ...quickMatchPayload.settings, max_turns: 5 },
    };
    expect(CreateGameSchema.safeParse(bad).success).toBe(false);
  });
});
