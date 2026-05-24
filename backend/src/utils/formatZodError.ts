import { z } from 'zod';
import { config } from '../config';

/**
 * Strip Zod's `flatten()` payload from validation errors in production.
 *
 * `flatten()` echoes the internal schema shape (field names, which ones failed
 * with which constraint) — handy in development, but in production it gives
 * credential-stuffing / probe tooling a free schema map. In prod we surface a
 * single uniform message; in dev we keep the structured details to help
 * debugging.
 *
 * Use this anywhere we do `Schema.safeParse(req.body)` and reply on failure.
 */
export function formatZodError(err: z.ZodError, fallback = 'Invalid input'): {
  error: string;
  details?: unknown;
} {
  if (config.nodeEnv === 'development') {
    return { error: fallback, details: err.flatten() };
  }
  return { error: fallback };
}
