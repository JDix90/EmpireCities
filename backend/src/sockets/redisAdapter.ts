import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { config } from '../config';

/**
 * Builds a Socket.io Redis adapter using two dedicated ioredis connections.
 *
 * Two separate connections are required: the adapter library puts the sub
 * client into subscribe mode, which blocks it from issuing any other commands.
 * Reusing the application's shared Redis singleton would deadlock.
 *
 * With a single backend instance the adapter is transparent — it forwards
 * events through Redis pub/sub but they loop straight back to the same
 * process. With multiple instances, `io.to(room).emit(...)` from instance A
 * reaches players connected to instance B automatically.
 */
export function buildRedisAdapter() {
  const opts = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
  };

  const pubClient = new Redis(opts);
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => {
    console.error('[RedisAdapter/pub] Connection error:', err);
  });
  subClient.on('error', (err) => {
    console.error('[RedisAdapter/sub] Connection error:', err);
  });

  return createAdapter(pubClient, subClient);
}
