/**
 * Standalone logger for code that runs outside Fastify request context.
 * Uses the same pino instance that ships with Fastify (no extra dependency).
 *
 * Inside route handlers, prefer `request.log` instead.
 */
import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
});
