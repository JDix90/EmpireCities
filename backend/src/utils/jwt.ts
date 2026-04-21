import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JwtAccessPayload, JwtRefreshPayload } from '../types';

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
  } as jwt.SignOptions);
}

/**
 * Generate a long-lived refresh token.
 * Expiry uses `config.jwt.refreshExpiresIn` (default `7d` when `JWT_REFRESH_EXPIRES_IN` is unset).
 */
export function signRefreshToken(payload: Omit<JwtRefreshPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Verify and decode an access token. Returns null if invalid or expired.
 */
export function verifyAccessToken(token: string): JwtAccessPayload | null {
  try {
    return jwt.verify(token, config.jwt.accessSecret) as JwtAccessPayload;
  } catch {
    return null;
  }
}

/**
 * Verify and decode a refresh token. Returns null if invalid or expired.
 */
export function verifyRefreshToken(token: string): JwtRefreshPayload | null {
  try {
    return jwt.verify(token, config.jwt.refreshSecret) as JwtRefreshPayload;
  } catch {
    return null;
  }
}
