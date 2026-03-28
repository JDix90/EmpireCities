import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JwtAccessPayload, JwtRefreshPayload } from '../types';

/**
 * Generate a short-lived access token (15 minutes by default).
 */
export function signAccessToken(payload: Omit<JwtAccessPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Generate a long-lived refresh token (7 days by default).
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
