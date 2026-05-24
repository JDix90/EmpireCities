import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';

/**
 * Stable, user-safe messages for HTTP status codes we surface verbatim.
 * In production we never echo the original Fastify/library/zod message text
 * because those can leak schema shape, file paths, library versions, or
 * partial credentials (e.g. db driver errors that include the query).
 */
const CLIENT_STATUS_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable entity',
  429: 'Too many requests',
};

function defaultClientMessage(statusCode: number): string {
  return CLIENT_STATUS_MESSAGES[statusCode] ?? 'Request failed';
}

/**
 * Global Fastify error handler: log full detail server-side; avoid leaking stacks to clients in production.
 *
 * Per-route handlers that intentionally surface a user-facing message do so via
 * `reply.status(...).send({ error: '...' })` (their reply is already sent), so
 * this handler only catches errors *thrown* into Fastify (unhandled, plugin
 * errors, validation failures, rate-limit triggers). In production we replace
 * arbitrary `error.message` with a stable per-status string so we never leak
 * internals such as `error: "select … from users where email = '..."`.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const reqId = request.id;
    const statusCode = error.statusCode ?? 500;

    request.log.error(
      { err: error, reqId, url: request.url, method: request.method },
      error.message,
    );

    if (reply.sent) return;

    const isClientError = statusCode >= 400 && statusCode < 500;
    const isDev = config.nodeEnv === 'development';

    // Fastify rate-limit / structured user-facing errors set `error.code` we
    // can keep, but the message text is still genericized in prod.
    let clientMessage: string;
    if (!isClientError) {
      clientMessage = isDev ? error.message : 'Internal server error';
    } else if (isDev) {
      clientMessage = error.message;
    } else {
      clientMessage = defaultClientMessage(statusCode);
    }

    const body: { error: string; code?: string; reqId?: string; details?: unknown } = {
      error: clientMessage,
      reqId,
    };

    if (error.code) body.code = String(error.code);
    if (isDev && error.validation) {
      body.details = error.validation;
    }

    reply.status(statusCode).send(body);
  });
}
