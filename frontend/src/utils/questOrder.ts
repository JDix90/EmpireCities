import { ONBOARDING_QUESTS, type QuestDef } from '@borderfall/shared';

/**
 * Which Getting Started quest the lobby shows (lobby_cleanup_enabled), now
 * that they complete in any order. The banner used to show the next one in
 * the server's fixed chain, so a Quick Match player sat at "Build your first
 * building" in a mode with no buildings, and a guest was shown quests only an
 * account can do. This orders them by what the player can do where they are,
 * and says where when it is not obvious.
 */

/** An account's order: what any game gives, then other people, then the systems a Full Game adds, ranked last (it needs an opponent waiting). */
const ACCOUNT_ORDER = ['first_win', 'first_friend', 'first_async', 'first_building', 'first_tech', 'first_ranked'];
/** A guest cannot add friends, start a game with another player or play ranked: those need an account. */
const GUEST_ORDER = ['first_win', 'first_building', 'first_tech'];

/** Where to do a quest the lobby's main buttons do not lead to. */
export const QUEST_WHERE: Record<string, string> = {
  first_building: 'Buildings come with Economy: start a Full Game, or switch Economy on in a custom game.',
  first_tech: 'Research comes with tech trees: start a Full Game, or switch Tech Trees on in a custom game.',
  first_ranked: 'Ranked is on the lobby’s Ranked tab, one on one against another player.',
};

export interface QuestPick {
  quest: QuestDef;
  /** 1-based position among the quests this player can do. */
  position: number;
  total: number;
  where?: string;
}

/** The next quest to show, or null when every quest this player can do is done. */
export function nextQuest(
  progress: ReadonlyArray<{ quest_id: string; completed_at: string | null }>,
  isGuest: boolean,
): QuestPick | null {
  const done = new Set(progress.filter((q) => q.completed_at).map((q) => q.quest_id));
  const order = (isGuest ? GUEST_ORDER : ACCOUNT_ORDER).filter((id) => ONBOARDING_QUESTS.some((q) => q.quest_id === id));
  const nextId = order.find((id) => !done.has(id));
  if (!nextId) return null;
  const quest = ONBOARDING_QUESTS.find((q) => q.quest_id === nextId)!;
  return {
    quest,
    position: order.filter((id) => done.has(id)).length + 1,
    total: order.length,
    where: QUEST_WHERE[nextId],
  };
}

/**
 * Roughly how soon a player who plays against the bots earns each achievement
 * (database/migrations 014, 051, 052): the tutorial and a first win, then a
 * win in each era's rules and the in-game feats, then the long ones, and last
 * those that need other people, ranked play or a published map. The catalog
 * comes sorted by name, and an achievement's XP is no measure of how hard it
 * is ("Diplomat", a truce with every other human player, pays the least).
 */
const ACHIEVEMENT_EASE = [
  'tutorial_complete',
  'first_blood',
  'ancient_master',
  'medieval_lord',
  'age_of_sail',
  'iron_cross',
  'cold_warrior',
  'iron_brigade',
  'fog_master',
  'card_shark',
  'speed_demon',
  'conqueror',
  'comeback_king',
  'blitzkrieg',
  'perfect_defense',
  'veteran',
  'ten_streak',
  'immortal_streak',
  'map_maker',
  'diplomat',
  'first_ranked_win',
  'underdog',
  'strategist',
  'popular_creator',
  'ranked_warlord',
];

/**
 * The locked achievements the profile names (lobby_cleanup_enabled): one with
 * a progress bar already moving first, then by ACHIEVEMENT_EASE, then any the
 * list does not know by XP and the catalog's order. Every one read "???
 * Locked — keep playing to reveal", which gave no goal at all.
 */
export function nextAchievementIds(
  catalog: ReadonlyArray<{ achievement_id: string; xp_reward: number }>,
  unlocked: ReadonlySet<string>,
  progress: Readonly<Record<string, { current: number; target: number }>>,
  count = 3,
): Set<string> {
  const ratio = (id: string) => {
    const p = progress[id];
    // A bar at 0 is no head start: "0 / 25 wins in a row" ranked the hardest first.
    return p && p.target > 0 && p.current > 0 ? Math.min(1, p.current / p.target) : -1;
  };
  const ease = (id: string) => {
    const i = ACHIEVEMENT_EASE.indexOf(id);
    return i === -1 ? ACHIEVEMENT_EASE.length : i;
  };
  return new Set(
    catalog
      .map((a, index) => ({ a, index }))
      .filter(({ a }) => !unlocked.has(a.achievement_id))
      .sort((x, y) =>
        ratio(y.a.achievement_id) - ratio(x.a.achievement_id)
        || ease(x.a.achievement_id) - ease(y.a.achievement_id)
        || x.a.xp_reward - y.a.xp_reward
        || x.index - y.index)
      .slice(0, count)
      .map(({ a }) => a.achievement_id),
  );
}
