/**
 * Every achievement there is. Each one is defined in
 * database/migrations/051_achievement_definitions.sql and granted somewhere in
 * the code; achievementDefinitions.test.ts holds both to this list, so an
 * achievement cannot again be shown to players with nothing that awards it.
 */
export const ACHIEVEMENT_IDS = [
  'first_blood',
  'conqueror',
  'diplomat',
  'card_shark',
  'blitzkrieg',
  'ancient_master',
  'medieval_lord',
  'age_of_sail',
  'iron_cross',
  'cold_warrior',
  'map_maker',
  'popular_creator',
  'veteran',
  'strategist',
  'fog_master',
  'tutorial_complete',
  'comeback_king',
  'perfect_defense',
  'speed_demon',
  'underdog',
  'first_ranked_win',
  'ten_streak',
  'iron_brigade',
  'ranked_warlord',
  'immortal_streak',
  'perfect_campaign',
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];
