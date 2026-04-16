import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne } from '../../db/postgres';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { config } from '../../config';

const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

function refreshCookieOpts(maxAgeSeconds: number) {
  const sameSite = config.refreshCookieSameSite;
  const secure = sameSite === 'none' ? true : config.refreshCookieSecure;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/auth',
    maxAge: maxAgeSeconds,
  } as const;
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/auth/guest ─────────────────────────────────────────────────
  /** Short-lived session without refresh token; creates a minimal `users` row for FK integrity. */
  fastify.post('/guest', async (_request, reply) => {
    const userId = uuidv4();
    const username = `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
    const email = `${userId}@guest.local`;
    const password_hash = await bcrypt.hash(randomUUID(), 8);

    await query(
      `INSERT INTO users (user_id, username, email, password_hash, is_guest)
       VALUES ($1, $2, $3, $4, true)`,
      [userId, username, email, password_hash]
    );

    const accessToken = signAccessToken({ sub: userId, username, guest: true }, '4h');

    return reply.send({
      accessToken,
      guestId: userId,
      user: {
        user_id: userId,
        username,
        level: 1,
        xp: 0,
        mmr: 1000,
        is_guest: true,
      },
    });
  });

  // ── POST /api/auth/register ──────────────────────────────────────────────
  fastify.post('/register', async (request, reply) => {
    const body = RegisterSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() });
    }
    const { username, email, password } = body.data;

    // Check for existing user
    const existing = await queryOne(
      'SELECT user_id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existing) {
      return reply.status(409).send({ error: 'Username or email already in use' });
    }

    const password_hash = await bcrypt.hash(password, config.bcryptRounds);
    const [user] = await query<{ user_id: string; username: string; level: number; xp: number; mmr: number }>(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id, username, level, xp, mmr`,
      [username, email, password_hash]
    );

    const accessToken = signAccessToken({ sub: user.user_id, username: user.username });
    const tokenId = uuidv4();
    const refreshToken = signRefreshToken({ sub: user.user_id, tokenId });
    const refreshHash = await bcrypt.hash(refreshToken, 8);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenId, user.user_id, refreshHash, expiresAt]
    );

    reply.setCookie('refreshToken', refreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    return reply.status(201).send({ accessToken, user });
  });

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  fastify.post('/login', async (request, reply) => {
    const body = LoginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const { email, password } = body.data;

    const user = await queryOne<{
      user_id: string; username: string; password_hash: string;
      level: number; xp: number; mmr: number; is_banned: boolean;
    }>(
      'SELECT user_id, username, password_hash, level, xp, mmr, is_banned FROM users WHERE email = $1',
      [email]
    );

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    if (user.is_banned) {
      return reply.status(403).send({ error: 'Account is banned' });
    }

    const accessToken = signAccessToken({ sub: user.user_id, username: user.username });
    const tokenId = uuidv4();
    const refreshToken = signRefreshToken({ sub: user.user_id, tokenId });
    const refreshHash = await bcrypt.hash(refreshToken, 8);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenId, user.user_id, refreshHash, expiresAt]
    );

    reply.setCookie('refreshToken', refreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    const { password_hash: _ph, is_banned: _ib, ...safeUser } = user;
    return reply.send({ accessToken, user: safeUser });
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────────────
  fastify.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken;
    if (!refreshToken) {
      return reply.status(401).send({ error: 'No refresh token' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    const stored = await queryOne<{ token_hash: string; revoked: boolean }>(
      'SELECT token_hash, revoked FROM refresh_tokens WHERE token_id = $1 AND user_id = $2',
      [payload.tokenId, payload.sub]
    );
    if (!stored || stored.revoked || !(await bcrypt.compare(refreshToken, stored.token_hash))) {
      return reply.status(401).send({ error: 'Refresh token invalid or revoked' });
    }

    const user = await queryOne<{ username: string }>(
      'SELECT username FROM users WHERE user_id = $1',
      [payload.sub]
    );
    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    // Rotate: revoke old token, issue new pair
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_id = $1', [payload.tokenId]);
    const newTokenId = uuidv4();
    const newAccessToken = signAccessToken({ sub: payload.sub, username: user.username });
    const newRefreshToken = signRefreshToken({ sub: payload.sub, tokenId: newTokenId });
    const newRefreshHash = await bcrypt.hash(newRefreshToken, 8);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [newTokenId, payload.sub, newRefreshHash, expiresAt]
    );

    reply.setCookie('refreshToken', newRefreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    return reply.send({ accessToken: newAccessToken });
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  fastify.post('/logout', async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken;
    if (refreshToken) {
      const payload = verifyRefreshToken(refreshToken);
      if (payload) {
        await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_id = $1', [payload.tokenId]);
      }
    }
    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return reply.send({ message: 'Logged out successfully' });
  });
}
