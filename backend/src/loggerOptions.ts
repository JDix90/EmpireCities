/**
 * Fastify's logger, by environment. Production used to run with the logger off,
 * so every `request.log.error` (including the global error handler's, which
 * records each failed request) went nowhere. It now logs warnings and errors to
 * stdout, readable with `docker logs`; routine per-request lines are info-level
 * and stay quiet. Tests keep it off.
 */
export function fastifyLoggerOptions(nodeEnv: string): boolean | { level: 'warn' } {
  if (nodeEnv === 'development') return true;
  if (nodeEnv === 'production') return { level: 'warn' };
  return false;
}
