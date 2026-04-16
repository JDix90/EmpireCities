import { query, queryOne } from '../../db/postgres';
import { pgPool } from '../../db/postgres';

// ── Types ──────────────────────────────────────────────────────────────

export interface ChallengeCondition {
  type: 'wins' | 'ranked_games' | 'buildings_built' | 'techs_researched' |
        'territories_conquered' | 'unique_eras_played' | 'win_streak' | 'daily_streak';
}

interface Challenge {
  challenge_id: string;
  month: string;
  title: string;
  description: string | null;
  target_count: number;
  reward_gold: number;
  reward_xp: number;
  condition_json: ChallengeCondition;
}

interface UserProgress {
  challenge_id: string;
  progress: number;
  completed_at: string | null;
}

// ── Get this month's challenges with user progress ──────────────────────

export async function getMonthlyChallenges(userId: string): Promise<Array<{
  challenge_id: string;
  title: string;
  description: string | null;
  target_count: number;
  reward_gold: number;
  reward_xp: number;
  condition_type: string;
  progress: number;
  completed_at: string | null;
}>> {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const challenges = await query<Challenge>(
    `SELECT challenge_id, month, title, description, target_count,
            reward_gold, reward_xp, condition_json
     FROM monthly_challenges
     WHERE month = $1
     ORDER BY reward_gold ASC`,
    [monthStart],
  );

  const progress = await query<UserProgress>(
    `SELECT challenge_id, progress, completed_at
     FROM user_challenge_progress
     WHERE user_id = $1 AND challenge_id = ANY($2)`,
    [userId, challenges.map((c) => c.challenge_id)],
  );
  const progressMap = new Map(progress.map((p) => [p.challenge_id, p]));

  return challenges.map((c) => {
    const p = progressMap.get(c.challenge_id);
    return {
      challenge_id: c.challenge_id,
      title: c.title,
      description: c.description,
      target_count: c.target_count,
      reward_gold: c.reward_gold,
      reward_xp: c.reward_xp,
      condition_type: c.condition_json.type,
      progress: p?.progress ?? 0,
      completed_at: p?.completed_at ?? null,
    };
  });
}

// ── Increment challenge progress after game events ─────────────────────

export interface GameChallengeEvent {
  userId: string;
  won: boolean;
  isRanked: boolean;
  eraId: string;
  buildingsBuilt: number;
  techsResearched: number;
  territoriesConquered: number;
  winStreak: number;
  dailyStreak: number;
}

export async function updateChallengeProgress(event: GameChallengeEvent): Promise<string[]> {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const challenges = await query<Challenge>(
    `SELECT challenge_id, target_count, reward_gold, reward_xp, condition_json
     FROM monthly_challenges
     WHERE month = $1`,
    [monthStart],
  );

  const completed: string[] = [];

  for (const ch of challenges) {
    const condition = ch.condition_json;
    let increment = 0;

    switch (condition.type) {
      case 'wins':
        if (event.won) increment = 1;
        break;
      case 'ranked_games':
        if (event.isRanked) increment = 1;
        break;
      case 'buildings_built':
        increment = event.buildingsBuilt;
        break;
      case 'techs_researched':
        increment = event.techsResearched;
        break;
      case 'territories_conquered':
        increment = event.territoriesConquered;
        break;
      case 'unique_eras_played':
        // Special: count distinct eras this month
        await handleUniqueEras(event.userId, ch, event.eraId, monthStart, completed);
        continue;
      case 'win_streak':
        // Set to current streak (not incremental)
        await handleStreakChallenge(event.userId, ch, event.winStreak, completed);
        continue;
      case 'daily_streak':
        await handleStreakChallenge(event.userId, ch, event.dailyStreak, completed);
        continue;
    }

    if (increment > 0) {
      const newlyCompleted = await incrementProgress(event.userId, ch, increment);
      if (newlyCompleted) completed.push(ch.challenge_id);
    }
  }

  return completed;
}

async function incrementProgress(
  userId: string,
  challenge: Challenge,
  increment: number,
): Promise<boolean> {
  // Check if already completed
  const existing = await queryOne<{ progress: number; completed_at: string | null }>(
    `SELECT progress, completed_at FROM user_challenge_progress
     WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challenge.challenge_id],
  );

  if (existing?.completed_at) return false; // Already done

  const newProgress = Math.min((existing?.progress ?? 0) + increment, challenge.target_count);

  await query(
    `INSERT INTO user_challenge_progress (user_id, challenge_id, progress, completed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, challenge_id)
     DO UPDATE SET progress = $3, completed_at = $4`,
    [
      userId,
      challenge.challenge_id,
      newProgress,
      newProgress >= challenge.target_count ? new Date().toISOString() : null,
    ],
  );

  if (newProgress >= challenge.target_count && !(existing?.completed_at)) {
    // Award rewards
    await awardChallengeRewards(userId, challenge);
    return true;
  }

  return false;
}

async function handleUniqueEras(
  userId: string,
  challenge: Challenge,
  eraId: string,
  monthStart: string,
  completed: string[],
): Promise<void> {
  // Count distinct eras played this month from game_players + games
  const result = await queryOne<{ era_count: string }>(
    `SELECT COUNT(DISTINCT g.era_id) AS era_count
     FROM game_players gp
     JOIN games g ON g.game_id = gp.game_id
     WHERE gp.user_id = $1
       AND g.status = 'completed'
       AND g.created_at >= $2`,
    [userId, monthStart],
  );
  const eraCount = parseInt(result?.era_count ?? '0', 10);

  const existing = await queryOne<{ completed_at: string | null }>(
    `SELECT completed_at FROM user_challenge_progress
     WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challenge.challenge_id],
  );
  if (existing?.completed_at) return;

  const isComplete = eraCount >= challenge.target_count;

  await query(
    `INSERT INTO user_challenge_progress (user_id, challenge_id, progress, completed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, challenge_id)
     DO UPDATE SET progress = $3, completed_at = $4`,
    [
      userId,
      challenge.challenge_id,
      Math.min(eraCount, challenge.target_count),
      isComplete ? new Date().toISOString() : null,
    ],
  );

  if (isComplete && !existing?.completed_at) {
    await awardChallengeRewards(userId, challenge);
    completed.push(challenge.challenge_id);
  }
}

async function handleStreakChallenge(
  userId: string,
  challenge: Challenge,
  currentStreak: number,
  completed: string[],
): Promise<void> {
  const existing = await queryOne<{ progress: number; completed_at: string | null }>(
    `SELECT progress, completed_at FROM user_challenge_progress
     WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challenge.challenge_id],
  );
  if (existing?.completed_at) return;

  // Streak challenges: progress = max streak achieved
  const newProgress = Math.max(existing?.progress ?? 0, currentStreak);
  const isComplete = newProgress >= challenge.target_count;

  await query(
    `INSERT INTO user_challenge_progress (user_id, challenge_id, progress, completed_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, challenge_id)
     DO UPDATE SET progress = $3, completed_at = $4`,
    [
      userId,
      challenge.challenge_id,
      Math.min(newProgress, challenge.target_count),
      isComplete ? new Date().toISOString() : null,
    ],
  );

  if (isComplete && !existing?.completed_at) {
    await awardChallengeRewards(userId, challenge);
    completed.push(challenge.challenge_id);
  }
}

async function awardChallengeRewards(userId: string, challenge: Challenge): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    if (challenge.reward_gold > 0) {
      await client.query(
        'UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2',
        [challenge.reward_gold, userId],
      );
      await client.query(
        'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
        [userId, challenge.reward_gold, `Challenge: ${challenge.challenge_id}`],
      );
    }

    if (challenge.reward_xp > 0) {
      await client.query(
        'UPDATE users SET xp = xp + $1 WHERE user_id = $2',
        [challenge.reward_xp, userId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[Challenge] Failed to award rewards for ${challenge.challenge_id}:`, err);
  } finally {
    client.release();
  }
}

// ── Claim completed challenge (explicit claim action) ──────────────────

export async function claimChallenge(userId: string, challengeId: string): Promise<boolean> {
  const row = await queryOne<{ completed_at: string | null; progress: number }>(
    `SELECT completed_at, progress FROM user_challenge_progress
     WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challengeId],
  );
  // Already completed = rewards already given inline
  return row?.completed_at != null;
}
