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

// ── Leaderboard helpers ──────────────────────────────────────────────────────

/** Remove a user from every era leaderboard — called on account deletion. */
export async function removeFromAllLeaderboards(userId: string): Promise<void> {
  const eras = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento', 'space_age', 'galaxy_age'];
  await Promise.all(eras.map((era) => redis.zrem(`leaderboard:${era}`, userId)));
}
