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
