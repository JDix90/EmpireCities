/**
 * An achievement is unlocked by its id, and players know it by the name in its
 * definition: First Steps, Unstoppable, Grand Strategist. The game-over screen
 * and the share card title-cased the id instead ("Tutorial Complete", "Ten
 * Streak", "Strategist"), and the activity feed showed every unlock as
 * `Unlocked "achievement"`. The names come from GET /users/achievements, once.
 */
import { useEffect, useState } from 'react';
import { api } from '../services/api';

export type AchievementNames = Record<string, string>;

let namesRequest: Promise<AchievementNames> | null = null;

/** Every achievement's name by id. Fetched once; a failed fetch is tried again next time. */
export function loadAchievementNames(): Promise<AchievementNames> {
  namesRequest ??= api
    .get<Array<{ achievement_id: string; name: string }>>('/users/achievements')
    .then((res) => Object.fromEntries((res.data ?? []).map((a) => [a.achievement_id, a.name])))
    .catch(() => {
      namesRequest = null;
      return {};
    });
  return namesRequest;
}

/** The achievement's name, or its id in title case until (or unless) the names load. */
export function achievementName(id: string, names: AchievementNames): string {
  return names[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The names, loaded when `enabled` (an empty map until they arrive). */
export function useAchievementNames(enabled = true): AchievementNames {
  const [names, setNames] = useState<AchievementNames>({});
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadAchievementNames().then((loaded) => {
      if (live) setNames(loaded);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return names;
}

/** For tests: forget the fetched names. */
export function resetAchievementNamesForTests(): void {
  namesRequest = null;
}
