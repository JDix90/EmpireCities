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

// ── Automated monthly challenge generation ─────────────────────────────

const MONTH_ABBREVS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Epoch for difficulty cycling: January 2026 = month 0
const EPOCH_YEAR = 2026;
const EPOCH_MONTH = 0; // 0-indexed (January)
const DIFFICULTY_CYCLE = 6;

interface ChallengeTemplate {
  title: string;
  descriptionTemplate: string; // {target} is replaced with the actual number
}

const CHALLENGE_TEMPLATES: Record<ChallengeCondition['type'], ChallengeTemplate[]> = {
  wins: [
    { title: 'Victor\'s March',       descriptionTemplate: 'Win {target} games this month' },
    { title: 'Five Victories',        descriptionTemplate: 'Achieve {target} victories' },
    { title: 'Conqueror\'s Path',     descriptionTemplate: 'Claim {target} wins across any mode' },
    { title: 'Triumphant',            descriptionTemplate: 'Emerge victorious in {target} battles' },
    { title: 'Supreme Commander',     descriptionTemplate: 'Win {target} games to prove your skill' },
    { title: 'War Champion',          descriptionTemplate: 'Lead your forces to {target} victories' },
  ],
  ranked_games: [
    { title: 'Ranked Warrior',        descriptionTemplate: 'Play {target} ranked games' },
    { title: 'Ranked Veteran',        descriptionTemplate: 'Complete {target} ranked matches' },
    { title: 'Ladder Climber',        descriptionTemplate: 'Enter {target} ranked battles' },
    { title: 'Competitive Spirit',    descriptionTemplate: 'Compete in {target} ranked games' },
    { title: 'Arena Contender',       descriptionTemplate: 'Participate in {target} ranked matches' },
    { title: 'Rating Seeker',         descriptionTemplate: 'Queue up for {target} ranked games' },
  ],
  buildings_built: [
    { title: 'Master Builder',        descriptionTemplate: 'Build {target} structures across all games' },
    { title: 'Architect',             descriptionTemplate: 'Construct {target} buildings' },
    { title: 'City Planner',          descriptionTemplate: 'Erect {target} structures in your territories' },
    { title: 'Grand Architect',       descriptionTemplate: 'Raise {target} buildings across your empire' },
    { title: 'Foundation Layer',      descriptionTemplate: 'Build {target} structures this month' },
    { title: 'Monument Maker',        descriptionTemplate: 'Construct {target} buildings in any game' },
  ],
  techs_researched: [
    { title: 'Scholar',               descriptionTemplate: 'Research {target} technologies' },
    { title: 'Renaissance Mind',      descriptionTemplate: 'Discover {target} technologies this month' },
    { title: 'Enlightened',           descriptionTemplate: 'Unlock {target} tech advances' },
    { title: 'Knowledge Seeker',      descriptionTemplate: 'Research {target} technologies across games' },
    { title: 'Innovator',             descriptionTemplate: 'Advance {target} technologies' },
    { title: 'Sage of Eras',          descriptionTemplate: 'Complete {target} research projects' },
  ],
  territories_conquered: [
    { title: 'Territorial Ambition',  descriptionTemplate: 'Conquer {target} territories in any game mode' },
    { title: 'Empire Builder',        descriptionTemplate: 'Conquer {target} territories' },
    { title: 'Land Grab',             descriptionTemplate: 'Seize {target} territories this month' },
    { title: 'Expansionist',          descriptionTemplate: 'Capture {target} territories across all games' },
    { title: 'Border Pusher',         descriptionTemplate: 'Take control of {target} territories' },
    { title: 'Manifest Destiny',      descriptionTemplate: 'Claim {target} territories for your empire' },
  ],
  unique_eras_played: [
    { title: 'Time Traveler',         descriptionTemplate: 'Play games in at least {target} different eras' },
    { title: 'Temporal Explorer',     descriptionTemplate: 'Experience {target} different eras' },
    { title: 'Era Hopper',            descriptionTemplate: 'Complete games across {target} distinct eras' },
    { title: 'Through the Ages',      descriptionTemplate: 'Play in {target} or more different eras' },
    { title: 'Epoch Walker',          descriptionTemplate: 'Visit {target} unique eras this month' },
    { title: 'History Buff',          descriptionTemplate: 'Explore {target} different eras of history' },
  ],
  win_streak: [
    { title: 'Hot Streak',            descriptionTemplate: 'Achieve a {target}-game win streak' },
    { title: 'On Fire',               descriptionTemplate: 'Win {target} games in a row' },
    { title: 'Unstoppable',           descriptionTemplate: 'Build a win streak of {target}' },
    { title: 'Dominant Force',        descriptionTemplate: 'Reach a {target}-game winning streak' },
    { title: 'Unbroken',              descriptionTemplate: 'Win {target} consecutive games' },
    { title: 'Streak Master',         descriptionTemplate: 'Maintain a {target}-game win streak' },
  ],
  daily_streak: [
    { title: 'Dedicated Commander',   descriptionTemplate: 'Log in for {target} consecutive days' },
    { title: 'Faithful General',      descriptionTemplate: 'Maintain a {target}-day login streak' },
    { title: 'Daily Devotion',        descriptionTemplate: 'Achieve a {target}-day daily streak' },
    { title: 'Persistent Ruler',      descriptionTemplate: 'Keep your streak alive for {target} days' },
    { title: 'Iron Discipline',       descriptionTemplate: 'Play for {target} consecutive days' },
    { title: 'Steadfast Leader',      descriptionTemplate: 'Log in {target} days in a row' },
  ],
};

// Min/max values for target_count, reward_gold, reward_xp per condition type
// Index 0 = tier 0 (easiest), index 1 = tier 5 (hardest)
interface ScalingRange {
  targetMin: number;
  targetMax: number;
  goldMin: number;
  goldMax: number;
  xpMin: number;
  xpMax: number;
}

const SCALING: Record<ChallengeCondition['type'], ScalingRange> = {
  wins:                  { targetMin: 3,  targetMax: 15, goldMin: 50,  goldMax: 300, xpMin: 100, xpMax: 600 },
  ranked_games:          { targetMin: 2,  targetMax: 8,  goldMin: 50,  goldMax: 200, xpMin: 100, xpMax: 400 },
  buildings_built:       { targetMin: 8,  targetMax: 40, goldMin: 40,  goldMax: 200, xpMin: 80,  xpMax: 400 },
  techs_researched:      { targetMin: 4,  targetMax: 15, goldMin: 40,  goldMax: 200, xpMin: 80,  xpMax: 400 },
  territories_conquered: { targetMin: 20, targetMax: 80, goldMin: 50,  goldMax: 250, xpMin: 100, xpMax: 500 },
  unique_eras_played:    { targetMin: 2,  targetMax: 5,  goldMin: 60,  goldMax: 150, xpMin: 120, xpMax: 300 },
  win_streak:            { targetMin: 2,  targetMax: 7,  goldMin: 40,  goldMax: 200, xpMin: 80,  xpMax: 400 },
  daily_streak:          { targetMin: 5,  targetMax: 21, goldMin: 50,  goldMax: 300, xpMin: 100, xpMax: 600 },
};

/** Linearly interpolate between min and max, rounded to nearest multiple of `step`. */
function lerp(min: number, max: number, t: number, step: number): number {
  const raw = min + (max - min) * t;
  return Math.round(raw / step) * step;
}

/** Get challenge parameters for a condition type at a given difficulty tier (0–5). */
export function getChallengeParams(
  type: ChallengeCondition['type'],
  tier: number,
): { target_count: number; reward_gold: number; reward_xp: number } {
  const s = SCALING[type];
  const t = Math.min(tier, DIFFICULTY_CYCLE - 1) / (DIFFICULTY_CYCLE - 1);
  return {
    target_count: lerp(s.targetMin, s.targetMax, t, 1),
    reward_gold:  lerp(s.goldMin, s.goldMax, t, 5),
    reward_xp:    lerp(s.xpMin, s.xpMax, t, 10),
  };
}

/** Compute the month index (months since epoch) for deterministic generation. */
function getMonthIndex(year: number, month: number): number {
  return (year - EPOCH_YEAR) * 12 + (month - EPOCH_MONTH);
}

/**
 * Generate challenge rows for a given year and 0-indexed month.
 * Pure function — returns the rows to insert without touching the DB.
 */
export function buildChallengeRows(
  year: number,
  month: number,
): Array<{
  challenge_id: string;
  month: string;
  title: string;
  description: string;
  target_count: number;
  reward_gold: number;
  reward_xp: number;
  condition_json: string;
}> {
  const monthIdx = getMonthIndex(year, month);
  const tier = monthIdx % DIFFICULTY_CYCLE;
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const prefix = `${MONTH_ABBREVS[month]}${String(year).slice(2)}`;

  const CONDITION_TYPES: ChallengeCondition['type'][] = [
    'wins', 'ranked_games', 'buildings_built', 'techs_researched',
    'territories_conquered', 'unique_eras_played', 'win_streak', 'daily_streak',
  ];

  return CONDITION_TYPES.map((type) => {
    const templates = CHALLENGE_TEMPLATES[type];
    const template = templates[monthIdx % templates.length];
    const params = getChallengeParams(type, tier);

    return {
      challenge_id: `${prefix}_${type}`,
      month: monthStr,
      title: template.title,
      description: template.descriptionTemplate.replace('{target}', String(params.target_count)),
      target_count: params.target_count,
      reward_gold: params.reward_gold,
      reward_xp: params.reward_xp,
      condition_json: JSON.stringify({ type }),
    };
  });
}

/**
 * Ensure challenges exist for the current month.
 * If none exist, generate and insert them. Idempotent via ON CONFLICT.
 */
export async function ensureMonthlyChallenges(): Promise<void> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const existing = await queryOne<{ cnt: string }>(
    'SELECT COUNT(*) AS cnt FROM monthly_challenges WHERE month = $1',
    [monthStart],
  );
  if (parseInt(existing?.cnt ?? '0', 10) > 0) return;

  const rows = buildChallengeRows(year, month);

  const valuePlaceholders = rows.map(
    (_, i) => `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`,
  ).join(', ');

  const params = rows.flatMap((r) => [
    r.challenge_id, r.month, r.title, r.description,
    r.target_count, r.reward_gold, r.reward_xp, r.condition_json,
  ]);

  await query(
    `INSERT INTO monthly_challenges (challenge_id, month, title, description, target_count, reward_gold, reward_xp, condition_json)
     VALUES ${valuePlaceholders}
     ON CONFLICT (challenge_id) DO NOTHING`,
    params,
  );

  console.log(`[Challenges] Generated ${rows.length} challenges for ${monthStart}`);
}

// ── Challenge sweep (same pattern as seasonService) ────────────────────

let challengeInterval: ReturnType<typeof setInterval> | null = null;

export function startChallengeSweep(): void {
  if (challengeInterval) return;
  // Check every hour (same cadence as season sweep)
  challengeInterval = setInterval(async () => {
    try {
      await ensureMonthlyChallenges();
    } catch (err) {
      console.error('[Challenges] Sweep error:', err);
    }
  }, 60 * 60 * 1000);
  challengeInterval.unref();

  // Run immediately on startup
  ensureMonthlyChallenges().catch((err) =>
    console.error('[Challenges] Initial check error:', err),
  );
}

export function stopChallengeSweep(): void {
  if (challengeInterval) {
    clearInterval(challengeInterval);
    challengeInterval = null;
  }
}
