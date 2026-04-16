/**
 * Shared types/constants for frontend + backend. Extend incrementally to reduce drift.
 */

export type GamePhase = 'territory_select' | 'draft' | 'attack' | 'fortify' | 'game_over';

export type ConnectionType = 'land' | 'sea';

export interface MapConnectionEdge {
  from: string;
  to: string;
  type?: ConnectionType;
}

// ── Level / XP utilities ──────────────────────────────────────────────────

/** Level from cumulative XP (matches backend computeLevel). */
export function getLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 250)) + 1;
}

/** Total XP needed to reach a given level. */
export function getXpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 250;
}

/** Progress info for current level. */
export function getLevelProgress(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
} {
  const level = getLevel(xp);
  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const range = nextLevelXp - currentLevelXp;
  const progress = range > 0 ? (xp - currentLevelXp) / range : 0;
  return { level, currentLevelXp, nextLevelXp, progress: Math.min(1, Math.max(0, progress)) };
}

// ── Ranked tier utilities ─────────────────────────────────────────────────

export type RankedTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface TierInfo {
  tier: RankedTier;
  label: string;
  color: string;
  minMu: number;
}

const TIER_THRESHOLDS: TierInfo[] = [
  { tier: 'diamond',  label: 'Diamond',  color: '#B9F2FF', minMu: 1900 },
  { tier: 'platinum', label: 'Platinum', color: '#E5E4E2', minMu: 1700 },
  { tier: 'gold',     label: 'Gold',     color: '#FFD700', minMu: 1500 },
  { tier: 'silver',   label: 'Silver',   color: '#C0C0C0', minMu: 1300 },
  { tier: 'bronze',   label: 'Bronze',   color: '#CD7F32', minMu: 0 },
];

export function getTier(mu: number): TierInfo {
  return TIER_THRESHOLDS.find((t) => mu >= t.minMu) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]!;
}

// ── Cosmetic rarity ───────────────────────────────────────────────────────

export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

export const RARITY_COLORS: Record<CosmeticRarity, string> = {
  common:    '#9CA3AF',
  uncommon:  '#22C55E',
  rare:      '#3B82F6',
  legendary: '#A855F7',
  mythic:    '#F97316',
};

// ── Onboarding quest definitions ──────────────────────────────────────────

export interface QuestDef {
  quest_id: string;
  title: string;
  description: string;
  reward_xp: number;
  reward_gold: number;
}

export const ONBOARDING_QUESTS: QuestDef[] = [
  { quest_id: 'first_win',      title: 'First Victory',      description: 'Win your first game',          reward_xp: 50,  reward_gold: 20 },
  { quest_id: 'first_building',  title: 'Master Builder',     description: 'Build your first building',    reward_xp: 0,   reward_gold: 30 },
  { quest_id: 'first_tech',      title: 'Age of Discovery',   description: 'Research a technology',        reward_xp: 0,   reward_gold: 30 },
  { quest_id: 'first_ranked',    title: 'Ranked Contender',   description: 'Enter a ranked match',         reward_xp: 0,   reward_gold: 50 },
  { quest_id: 'first_friend',    title: 'Allies',             description: 'Add a friend',                 reward_xp: 0,   reward_gold: 25 },
];
