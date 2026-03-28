import Redis from 'ioredis';
import { config } from '../../config';

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err);
});

export function getRedis(): Redis {
  return redis;
}

export async function connectRedis(): Promise<void> {
  await redis.connect();
  console.log('[Redis] Connected successfully');
}

// ── Session helpers ──────────────────────────────────────────────────────────

export async function setSession(key: string, value: string, ttlSeconds: number): Promise<void> {
  await redis.set(key, value, 'EX', ttlSeconds);
}

export async function getSession(key: string): Promise<string | null> {
  return redis.get(key);
}

export async function deleteSession(key: string): Promise<void> {
  await redis.del(key);
}

// ── Leaderboard helpers ──────────────────────────────────────────────────────

export async function updateLeaderboard(era: string, userId: string, mmr: number): Promise<void> {
  await redis.zadd(`leaderboard:${era}`, mmr, userId);
}

export async function getLeaderboard(era: string, top = 100): Promise<{ userId: string; mmr: number }[]> {
  const results = await redis.zrevrangebyscore(
    `leaderboard:${era}`,
    '+inf',
    '-inf',
    'WITHSCORES',
    'LIMIT',
    0,
    top
  );
  const leaderboard: { userId: string; mmr: number }[] = [];
  for (let i = 0; i < results.length; i += 2) {
    leaderboard.push({ userId: results[i], mmr: parseFloat(results[i + 1]) });
  }
  return leaderboard;
}
