import { query } from '../../db/postgres';

const FRIEND_STREAK_WINDOW_HOURS = 72;

export interface FriendStreakBonusEntry {
  friendId: string;
  friendName: string;
  streak: number;
  bonusMultiplier: number;
}

export interface FriendStreakBonusSummary {
  multiplier: number;
  streak: number;
  friends: FriendStreakBonusEntry[];
}

export function getFriendStreakMultiplier(streak: number): number {
  if (streak >= 20) return 1.3;
  if (streak >= 10) return 1.2;
  if (streak >= 5) return 1.1;
  if (streak >= 2) return 1.05;
  return 1;
}

export async function updateFriendStreaks(
  playerIds: string[],
  turnCount: number,
): Promise<Record<string, FriendStreakBonusSummary>> {
  if (turnCount < 3 || playerIds.length < 2) return {};

  const friendships = await query<{
    id: string;
    user_id_a: string;
    user_id_b: string;
    last_game_together: string | null;
    friend_streak: number;
    user_a_name: string;
    user_b_name: string;
  }>(
    `SELECT f.id, f.user_id_a, f.user_id_b, f.last_game_together, f.friend_streak,
            ua.username AS user_a_name, ub.username AS user_b_name
     FROM friendships f
     JOIN users ua ON ua.user_id = f.user_id_a
     JOIN users ub ON ub.user_id = f.user_id_b
     WHERE f.status = 'accepted'
       AND f.user_id_a = ANY($1)
       AND f.user_id_b = ANY($1)`,
    [playerIds],
  );

  if (friendships.length === 0) return {};

  const summaries: Record<string, FriendStreakBonusSummary> = {};
  const now = Date.now();
  const staleCutoff = FRIEND_STREAK_WINDOW_HOURS * 60 * 60 * 1000;

  for (const friendship of friendships) {
    const lastPlayedAt = friendship.last_game_together ? new Date(friendship.last_game_together).getTime() : 0;
    const nextStreak = lastPlayedAt > 0 && now - lastPlayedAt <= staleCutoff
      ? friendship.friend_streak + 1
      : 1;

    await query(
      `UPDATE friendships
       SET friend_streak = $1,
           last_game_together = NOW()
       WHERE id = $2`,
      [nextStreak, friendship.id],
    );

    const multiplier = getFriendStreakMultiplier(nextStreak);
    if (multiplier <= 1) continue;

    const pairEntries: Array<[string, FriendStreakBonusEntry]> = [
      [
        friendship.user_id_a,
        {
          friendId: friendship.user_id_b,
          friendName: friendship.user_b_name,
          streak: nextStreak,
          bonusMultiplier: multiplier,
        },
      ],
      [
        friendship.user_id_b,
        {
          friendId: friendship.user_id_a,
          friendName: friendship.user_a_name,
          streak: nextStreak,
          bonusMultiplier: multiplier,
        },
      ],
    ];

    for (const [userId, entry] of pairEntries) {
      const existing = summaries[userId];
      if (!existing || entry.bonusMultiplier > existing.multiplier) {
        summaries[userId] = {
          multiplier: entry.bonusMultiplier,
          streak: entry.streak,
          friends: [entry],
        };
        continue;
      }

      if (entry.bonusMultiplier === existing.multiplier) {
        existing.streak = Math.max(existing.streak, entry.streak);
        existing.friends = [...existing.friends, entry];
      }
    }
  }

  return summaries;
}

export async function expireStaleFriendStreaks(): Promise<void> {
  await query(
    `UPDATE friendships
     SET friend_streak = 0
     WHERE last_game_together IS NOT NULL
       AND last_game_together < NOW() - INTERVAL '72 hours'
       AND friend_streak <> 0`,
  );
}