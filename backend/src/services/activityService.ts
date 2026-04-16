import { query } from '../db/postgres';

export type ActivityEventType =
  | 'game_won'
  | 'level_up'
  | 'achievement_unlocked'
  | 'tier_promoted'
  | 'season_reward'
  | 'challenge_completed'
  | 'game_shared';

export async function recordActivity(
  userId: string,
  eventType: ActivityEventType,
  eventData: Record<string, unknown>,
): Promise<void> {
  await query(
    `INSERT INTO user_activity_feed (user_id, event_type, event_data)
     VALUES ($1, $2, $3)`,
    [userId, eventType, JSON.stringify(eventData)],
  );
}

export async function getFriendActivity(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<Array<{
  id: string;
  user_id: string;
  username: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}>> {
  return query(
    `SELECT af.id, af.user_id, u.username, af.event_type, af.event_data, af.created_at
     FROM user_activity_feed af
     JOIN users u ON u.user_id = af.user_id
     WHERE af.user_id IN (
       SELECT CASE WHEN f.user_id_a = $1 THEN f.user_id_b ELSE f.user_id_a END
       FROM friends f
       WHERE (f.user_id_a = $1 OR f.user_id_b = $1) AND f.status = 'accepted'
     )
     ORDER BY af.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
}

export async function getOwnActivity(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<Array<{
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}>> {
  return query(
    `SELECT id, event_type, event_data, created_at
     FROM user_activity_feed
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
}
