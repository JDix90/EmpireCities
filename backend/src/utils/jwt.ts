import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JwtAccessPayload, JwtRefreshPayload } from '../types';

// Pin the signing/verification algorithm. The secrets are symmetric HMAC keys,
// so we both sign and verify with HS256. Passing an explicit `algorithms`
// allowlist on verify closes algorithm-confusion / `alg:none` classes of attack
// as defense-in-depth, and guarantees a future switch to asymmetric keys can't
// silently accept attacker-chosen algorithms.
const JWT_ALGORITHM = 'HS256' as const;

/**
 * Generate a short-lived access token.
 * Expiry uses `config.jwt.accessExpiresIn` (default `1h` when `JWT_ACCESS_EXPIRES_IN` is unset).
 */
export function signAccessToken(
  payload: Omit<JwtAccessPayload, 'iat' | 'exp'>,
  expiresIn?: string
): string {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: expiresIn ?? config.jwt.accessExpiresIn,
    algorithm: JWT_ALGORITHM,
  } as jwt.SignOptions);
}

/**
 * Generate a long-lived refresh token.
 * Expiry uses `config.jwt.refreshExpiresIn` (default `7d` when `JWT_REFRESH_EXPIRES_IN` is unset).
 */
export function signRefreshToken(payload: Omit<JwtRefreshPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    algorithm: JWT_ALGORITHM,
  } as jwt.SignOptions);
}

/**
 * Verify and decode an access token. Returns null if invalid or expired.
 */
export function verifyAccessToken(token: string): JwtAccessPayload | null {
  try {
    return jwt.verify(token, config.jwt.accessSecret, { algorithms: [JWT_ALGORITHM] }) as JwtAccessPayload;
  } catch {
    return null;
  }
}

/**
 * Verify and decode a refresh token. Returns null if invalid or expired.
 */
export function verifyRefreshToken(token: string): JwtRefreshPayload | null {
  try {
    return jwt.verify(token, config.jwt.refreshSecret, { algorithms: [JWT_ALGORITHM] }) as JwtRefreshPayload;
  } catch {
    return null;
  }
}
