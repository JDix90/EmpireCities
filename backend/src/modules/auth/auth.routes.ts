import type { FastifyInstance } from 'fastify';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import zxcvbn from 'zxcvbn';
import { query, queryOne, withTransaction, pgPool } from '../../db/postgres';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { config } from '../../config';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { requireGuest } from '../../middleware/requireGuest';
import { compareWithDummy } from '../../utils/constantTimeBcrypt';
import { sendTransactionalEmailToAddress } from '../../services/notificationService';

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function compareRefreshToken(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashRefreshToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/**
 * Gmail treats `.` in the local part as meaningless and aliases googlemail.com ↔ gmail.com.
 * Users often register with one spelling and sign in with another; canonicalize for lookup only.
 */
function gmailDotlessLocal(loginIdentifier: string): string | null {
  const s = loginIdentifier.toLowerCase().trim();
  const at = s.lastIndexOf('@');
  if (at <= 0) return null;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return null;
  return local.replace(/\./g, '');
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const FORGOT_PASSWORD_RESPONSE = {
  message: 'If an account exists for that email, we sent password reset instructions.',
} as const;
const RESET_LINK_INVALID = 'Invalid or expired reset link. Request a new reset email.';

type PasswordResetUserRow = { user_id: string; username: string; email: string };

/** Same Gmail-aware email resolution as login; excludes guests, banned, and @guest.local. */
async function resolveUserForPasswordReset(normalizedEmail: string): Promise<PasswordResetUserRow | null> {
  const gmailLocal = gmailDotlessLocal(normalizedEmail);

  let row = await queryOne<PasswordResetUserRow>(
    `SELECT user_id, username, email FROM users
     WHERE LOWER(TRIM(BOTH FROM email)) = LOWER(TRIM(BOTH FROM $1::text))
       AND COALESCE(is_guest, false) = false
       AND is_banned = false
       AND LOWER(TRIM(BOTH FROM email)) NOT LIKE '%@guest.local'`,
    [normalizedEmail],
  );

  if (!row && gmailLocal) {
    row = await queryOne<PasswordResetUserRow>(
      `SELECT user_id, username, email FROM users
       WHERE LOWER(TRIM(BOTH FROM split_part(email, '@', 2))) IN ('gmail.com', 'googlemail.com')
         AND replace(split_part(LOWER(TRIM(BOTH FROM email)), '@', 1), '.', '') = $1::text
         AND COALESCE(is_guest, false) = false
         AND is_banned = false
         AND LOWER(TRIM(BOTH FROM email)) NOT LIKE '%@guest.local'
       ORDER BY
         (LOWER(TRIM(BOTH FROM email)) = LOWER(TRIM(BOTH FROM $2::text))) DESC,
         created_at ASC
       LIMIT 1`,
      [gmailLocal, normalizedEmail],
    );
  }

  return row;
}

function hashPasswordResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Try bcrypt variants (copy/paste whitespace around passwords is common). */
async function verifyLoginPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    return compareWithDummy(plain, null);
  }
  if (await bcrypt.compare(plain, hash)) return true;
  const trimmed = plain.trim();
  if (trimmed !== plain && (await bcrypt.compare(trimmed, hash))) return true;
  await compareWithDummy(plain, null);
  return false;
}

/**
 * Strip Zod field paths from validation errors in production. The original
 * `error.flatten()` payload exposes the internal schema shape (which fields
 * exist, which ones failed, etc.) — useful for dev, but a free credentials-
 * stuffing aid in prod where we want a uniform "Invalid input" surface.
 */
function formatZodError(err: z.ZodError): { error: string; details?: unknown } {
  if (config.nodeEnv === 'development') {
    return { error: 'Invalid input', details: err.flatten() };
  }
  return { error: 'Invalid input' };
}

/**
 * zxcvbn-driven password strength gate. Below score 2 (out of 4) the
 * password is brute-forceable in tractable time on commodity hardware. We
 * keep the legacy length floor as a defence-in-depth check for offline
 * cracking scenarios where short passwords lose first.
 */
function passwordStrengthError(password: string, hints: string[] = []): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters';
  const result = zxcvbn(password, hints);
  if (result.score < 2) {
    const advice = result.feedback?.warning
      || result.feedback?.suggestions?.[0]
      || 'Password is too easy to guess';
    return `Password is too weak: ${advice}`;
  }
  return null;
}

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(8).max(128),
});

const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

/**
 * Guest → full-account upgrade body. Same identity rules as register, plus:
 * `@guest.local` emails are rejected — that domain is reserved for the
 * synthetic guest rows, and login's email resolution explicitly excludes it,
 * so an upgraded account using one could never sign in by email.
 * Exported for tests.
 */
export const UpgradeSchema = RegisterSchema.refine(
  (data) => !data.email.toLowerCase().endsWith('@guest.local'),
  { message: 'Please use a real email address', path: ['email'] },
);

/** Login body field remains `email` for API compatibility; value may be email or username. */
const LoginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  // Capped at 128: the registration schema enforces the same ceiling, and
  // bcrypt.compare on an attacker-controlled 10MB string is a cheap DoS.
  password: z.string().min(1).max(128),
});

const ForgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
});

const ResetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(512),
  new_password: z.string().min(8).max(128),
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

/**
 * Best-effort "last seen" stamp for the admin dashboard (migration 033).
 * Fire-and-forget: a stamp failure must never fail an auth flow. Called on
 * login, register, guest creation, upgrade, and refresh rotation — the
 * rotation stamp gives ~hourly last-active granularity for returning users.
 */
function stampLastLogin(userId: string): void {
  query('UPDATE users SET last_login_at = NOW() WHERE user_id = $1', [userId]).catch(() => {});
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /api/auth/guest ─────────────────────────────────────────────────
  /**
   * Short-lived session without refresh token; creates a minimal `users` row
   * for FK integrity. Guest username uses an 8-hex slice of the user id to
   * keep the chance of a collision with another active guest astronomically
   * small (16⁸ ≈ 4.3B values vs the ~9k of the previous Math.random scheme,
   * which collided in production and broke registration).
   *
   * In the unlikely case of a collision, we retry with a fresh user id; the
   * `users.username` column has a UNIQUE constraint that turns the race into
   * a clean ON CONFLICT bail rather than a corrupted partial insert.
   */
  fastify.post('/guest', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_request, reply) => {
    // Use the same cost factor as registered accounts so the row is
    // indistinguishable by hash shape (defense in depth — the guest password
    // is a never-exposed random UUID, but uniform parameters mean a future
    // database leak can't be partitioned into guest vs. real users by cost).
    const password_hash = await bcrypt.hash(randomUUID(), config.bcryptRounds);

    let userId: string | null = null;
    let username: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidateId = uuidv4();
      const candidateUsername = `Guest_${candidateId.slice(0, 8)}`;
      const email = `${candidateId}@guest.local`;
      const inserted = await queryOne<{ user_id: string }>(
        `INSERT INTO users (user_id, username, email, password_hash, is_guest)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (username) DO NOTHING
         RETURNING user_id`,
        [candidateId, candidateUsername, email, password_hash],
      );
      if (inserted) {
        userId = candidateId;
        username = candidateUsername;
        break;
      }
    }
    if (!userId || !username) {
      // Astronomically unlikely; fail loudly so monitoring catches it.
      return reply.status(500).send({ error: 'Could not allocate a unique guest username; try again' });
    }

    const accessToken = signAccessToken({ sub: userId, username, guest: true, admin: false }, '4h');

    // Guests get the same refresh-cookie session as registered users so a
    // page reload (or 4h token expiry mid-game) doesn't destroy their
    // identity — guests are exactly the players we can't ask to log back in.
    // The rotation handler preserves the `guest` claim, so refreshed tokens
    // never escalate a guest past rejectGuest-protected routes. Stale no-game
    // guests are deleted by guestCleanupService; their refresh then 401s
    // (`no_user`) and the client logs out cleanly.
    const tokenId = uuidv4();
    const refreshToken = signRefreshToken({ sub: userId, tokenId });
    const refreshHash = hashRefreshToken(refreshToken);
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenId, userId, refreshHash, refreshExpiresAt],
    );
    reply.setCookie('refreshToken', refreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    stampLastLogin(userId);

    return reply.send({
      accessToken,
      guestId: userId,
      user: {
        user_id: userId,
        username,
        // Defaults matching the `users` schema (level/xp/mmr columns).
        // These values never get persisted differently for guests; we send
        // them so the client bootstraps the lobby UI without a follow-up
        // /me round-trip.
        level: 1,
        xp: 0,
        mmr: 1000,
        is_guest: true,
        is_admin: false,
      },
    });
  });

  // ── POST /api/auth/register ──────────────────────────────────────────────
  fastify.post('/register', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = RegisterSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(formatZodError(body.error));
    }
    const { username, email, password } = body.data;

    // Reject trivially-weak passwords. Username + email are passed in as
    // user-specific signals so zxcvbn down-scores passwords like
    // `username123`.
    const strength = passwordStrengthError(password, [username, email]);
    if (strength) {
      return reply.status(400).send({ error: strength });
    }

    // Check for existing user
    const existing = await queryOne(
      'SELECT user_id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existing) {
      return reply.status(409).send({ error: 'Username or email already in use' });
    }

    const password_hash = await bcrypt.hash(password, config.bcryptRounds);
    const [user] = await query<{ user_id: string; username: string; level: number; xp: number; mmr: number; is_admin: boolean }>(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id, username, level, xp, mmr, is_admin`,
      [username, email, password_hash]
    );

    const accessToken = signAccessToken({ sub: user.user_id, username: user.username, admin: user.is_admin });
    const tokenId = uuidv4();
    const refreshToken = signRefreshToken({ sub: user.user_id, tokenId });
    const refreshHash = hashRefreshToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenId, user.user_id, refreshHash, expiresAt]
    );

    reply.setCookie('refreshToken', refreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    stampLastLogin(user.user_id);
    return reply.status(201).send({ accessToken, user });
  });

  // ── POST /api/auth/upgrade ───────────────────────────────────────────────
  /**
   * Convert the authenticated guest's existing users row into a full account
   * IN PLACE: set a real username/email/password and flip is_guest. Because
   * the row keeps its user_id, every progression artifact — XP, level, gold,
   * streaks, user_ratings, achievements, cosmetics — carries over with zero
   * migration, and the 48h guest sweep (is_guest = true only) spares it.
   */
  fastify.post('/upgrade', {
    preHandler: [authenticate, requireGuest],
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const body = UpgradeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(formatZodError(body.error));
    }
    const { username, email, password } = body.data;

    const weak = passwordStrengthError(password, [username, email]);
    if (weak) {
      return reply.status(400).send({ error: weak });
    }

    // Pre-check excluding the guest's own row (their auto-generated
    // Guest_xxxxxxxx name and @guest.local email must not self-conflict).
    const existing = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM users WHERE (email = $1 OR username = $2) AND user_id <> $3',
      [email, username, request.userId],
    );
    if (existing) {
      return reply.status(409).send({ error: 'Username or email already in use' });
    }

    const password_hash = await bcrypt.hash(password, config.bcryptRounds);

    type UpgradedRow = {
      user_id: string; username: string; level: number; xp: number; mmr: number;
      gold: number; win_streak: number; daily_streak: number; onboarding_stage: number;
      is_admin: boolean;
    };

    const client = await pgPool.connect();
    let upgraded: UpgradedRow | null = null;
    const tokenId = uuidv4();
    let refreshToken: string;
    try {
      await client.query('BEGIN');

      // The is_guest predicate makes concurrent or replayed upgrades fail
      // closed: only one caller ever sees a row come back.
      const { rows } = await client.query<UpgradedRow>(
        `UPDATE users
         SET username = $1, email = $2, password_hash = $3, is_guest = false,
             upgraded_at = NOW()
         WHERE user_id = $4 AND COALESCE(is_guest, false) = true
         RETURNING user_id, username, level, xp, mmr,
                   COALESCE(gold, 0) AS gold,
                   COALESCE(win_streak, 0) AS win_streak,
                   COALESCE(daily_streak, 0) AS daily_streak,
                   COALESCE(onboarding_stage, 0) AS onboarding_stage,
                   COALESCE(is_admin, false) AS is_admin`,
        [username, email, password_hash, request.userId],
      );
      upgraded = rows[0] ?? null;
      if (!upgraded) {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'This account has already been upgraded' });
      }

      // The guest's old refresh chain must die with the guest identity.
      await client.query(
        'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
        [request.userId],
      );

      refreshToken = signRefreshToken({ sub: upgraded.user_id, tokenId });
      const refreshHash = hashRefreshToken(refreshToken);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await client.query(
        'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
        [tokenId, upgraded.user_id, refreshHash, expiresAt],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // Unique violation racing past the pre-check — same answer as register.
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: 'Username or email already in use' });
      }
      request.log.error({ err, userId: request.userId }, 'guest upgrade failed');
      return reply.status(500).send({ error: 'Upgrade failed' });
    } finally {
      client.release();
    }

    // Full-account token: no guest claim, standard expiry (not the guest 4h).
    const accessToken = signAccessToken({
      sub: upgraded.user_id,
      username: upgraded.username,
      admin: upgraded.is_admin,
    });
    reply.setCookie('refreshToken', refreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    stampLastLogin(upgraded.user_id);
    return reply.send({
      accessToken,
      user: { ...upgraded, is_guest: false },
    });
  });

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  fastify.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = LoginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }
    const loginIdentifier = body.data.email.normalize('NFC').trim();
    const { password } = body.data;
    const gmailLocal = gmailDotlessLocal(loginIdentifier);

    type LoginUserRow = {
      user_id: string;
      username: string;
      password_hash: string;
      level: number;
      xp: number;
      mmr: number;
      is_banned: boolean;
      is_admin: boolean;
    };

    // Prefer exact username / email match first so Gmail dot-aliases cannot pick an arbitrary row
    // when `queryOne` would otherwise return `rows[0]` from an unordered multi-match set.
    let user = await queryOne<LoginUserRow>(
      `SELECT user_id, username, password_hash, level, xp, mmr, is_banned, is_admin
       FROM users
       WHERE LOWER(TRIM(BOTH FROM username)) = LOWER(TRIM(BOTH FROM $1::text))
          OR LOWER(TRIM(BOTH FROM email)) = LOWER(TRIM(BOTH FROM $1::text))`,
      [loginIdentifier],
    );

    if (!user && gmailLocal) {
      user = await queryOne<LoginUserRow>(
        `SELECT user_id, username, password_hash, level, xp, mmr, is_banned, is_admin
         FROM users
         WHERE LOWER(TRIM(BOTH FROM split_part(email, '@', 2))) IN ('gmail.com', 'googlemail.com')
           AND replace(split_part(LOWER(TRIM(BOTH FROM email)), '@', 1), '.', '') = $1::text
         ORDER BY
           (LOWER(TRIM(BOTH FROM email)) = LOWER(TRIM(BOTH FROM $2::text))) DESC,
           created_at ASC
         LIMIT 1`,
        [gmailLocal, loginIdentifier],
      );
    }

    const passwordOk = await verifyLoginPassword(password, user?.password_hash ?? null);
    if (!user || !passwordOk) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    if (user.is_banned) {
      return reply.status(403).send({ error: 'Account is banned' });
    }

    const accessToken = signAccessToken({ sub: user.user_id, username: user.username, admin: user.is_admin });
    const tokenId = uuidv4();
    const refreshToken = signRefreshToken({ sub: user.user_id, tokenId });
    const refreshHash = hashRefreshToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenId, user.user_id, refreshHash, expiresAt]
    );

    reply.setCookie('refreshToken', refreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    const { password_hash: _ph, is_banned: _ib, ...safeUser } = user;
    stampLastLogin(user.user_id);
    return reply.send({ accessToken, user: safeUser });
  });

  // ── POST /api/auth/forgot-password ───────────────────────────────────────
  fastify.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = ForgotPasswordSchema.safeParse(request.body);
    if (!body.success) {
      return reply.send(FORGOT_PASSWORD_RESPONSE);
    }
    const normalizedEmail = body.data.email.normalize('NFC').trim();

    const resetUser = await resolveUserForPasswordReset(normalizedEmail);
    if (!resetUser) {
      return reply.send(FORGOT_PASSWORD_RESPONSE);
    }

    await query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [
      resetUser.user_id,
    ]);

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [resetUser.user_id, tokenHash, expiresAt],
    );

    const baseUrl = config.frontendUrl.replace(/\/+$/, '');
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const htmlBody = `
      <p>You requested a password reset for <strong>Borderfall</strong>.</p>
      <p><a href="${resetUrl}">Set a new password</a></p>
      <p>This link expires in one hour. If you did not request this, you can ignore this email.</p>
    `.trim();

    const sent = await sendTransactionalEmailToAddress(
      resetUser.email,
      'Reset your Borderfall password',
      htmlBody,
    );
    if (
      !sent &&
      config.nodeEnv !== 'production' &&
      process.env.PASSWORD_RESET_DEV_LOG === 'true'
    ) {
      request.log.warn({ resetUrl }, '[auth] PASSWORD_RESET_DEV_LOG: reset URL (SMTP not configured or send failed)');
    }

    return reply.send(FORGOT_PASSWORD_RESPONSE);
  });

  // ── POST /api/auth/reset-password ────────────────────────────────────────
  fastify.post('/reset-password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = ResetPasswordSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: RESET_LINK_INVALID });
    }
    const { token: rawToken, new_password } = body.data;
    const tokenHash = hashPasswordResetToken(rawToken);

    const userForStrength = await queryOne<{ username: string; email: string }>(
      `SELECT u.username, u.email
       FROM password_reset_tokens t
       JOIN users u ON u.user_id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > NOW()`,
      [tokenHash],
    );
    if (!userForStrength) {
      return reply.status(400).send({ error: RESET_LINK_INVALID });
    }

    const strength = passwordStrengthError(new_password, [
      userForStrength.username,
      userForStrength.email,
    ]);
    if (strength) {
      return reply.status(400).send({ error: strength });
    }

    const newHash = await bcrypt.hash(new_password, config.bcryptRounds);

    try {
      await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM password_reset_tokens
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
           FOR UPDATE`,
          [tokenHash],
        );
        const row = rows[0];
        if (!row) {
          throw new Error('TOKEN_GONE');
        }

        await client.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [
          newHash,
          row.user_id,
        ]);
        await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
        await client.query(
          'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
          [row.user_id],
        );
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'TOKEN_GONE') {
        return reply.status(400).send({ error: RESET_LINK_INVALID });
      }
      request.log.error({ err }, 'password reset failed');
      return reply.status(500).send({ error: 'Password reset failed' });
    }

    return reply.send({ message: 'Password updated; you can sign in now.' });
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────────────
  fastify.post('/refresh', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken;
    if (!refreshToken) {
      return reply.status(401).send({ error: 'No refresh token' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    // Rotation must be atomic: SELECT → bcrypt.compare → UPDATE revoked →
    // INSERT new. If two parallel refreshes run with the same cookie (mobile
    // tab duplication, retries on flaky network), the old non-transactional
    // flow could both pass the revoked-check and each issue a new token,
    // leaving two live refresh tokens for one logical session. Wrapping in a
    // transaction with `FOR UPDATE` on the token row serializes the rotation:
    // the second request sees `revoked = true` and bails with 401.
    //
    // The token comparison runs inside the txn so the row lock covers the
    // whole compare→update window, preventing TOCTOU on concurrent refreshes.
    const newTokenId = uuidv4();
    const newRefreshToken = signRefreshToken({ sub: payload.sub, tokenId: newTokenId });
    const newRefreshHash = hashRefreshToken(newRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    type RotationResult =
      | { code: 'ok'; username: string; is_admin: boolean; is_guest: boolean }
      | { code: 'invalid' }
      | { code: 'no_user' };

    let rotation: RotationResult;
    try {
      rotation = await withTransaction<RotationResult>(async (client) => {
        const { rows: storedRows } = await client.query<{ token_hash: string; revoked: boolean }>(
          `SELECT token_hash, revoked FROM refresh_tokens
           WHERE token_id = $1 AND user_id = $2
           FOR UPDATE`,
          [payload.tokenId, payload.sub],
        );
        const stored = storedRows[0];
        if (!stored || stored.revoked || !compareRefreshToken(refreshToken, stored.token_hash)) {
          return { code: 'invalid' };
        }

        const { rows: userRows } = await client.query<{ username: string; is_admin: boolean; is_guest: boolean }>(
          'SELECT username, is_admin, COALESCE(is_guest, false) AS is_guest FROM users WHERE user_id = $1',
          [payload.sub],
        );
        if (userRows.length === 0) {
          return { code: 'no_user' };
        }

        await client.query(
          'UPDATE refresh_tokens SET revoked = TRUE WHERE token_id = $1',
          [payload.tokenId],
        );
        await client.query(
          'INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
          [newTokenId, payload.sub, newRefreshHash, expiresAt],
        );

        return {
          code: 'ok',
          username: userRows[0].username,
          is_admin: userRows[0].is_admin,
          is_guest: userRows[0].is_guest,
        };
      });
    } catch (err) {
      request.log.error({ err, userId: payload.sub }, 'refresh rotation failed');
      return reply.status(500).send({ error: 'Refresh failed' });
    }

    if (rotation.code === 'invalid') {
      return reply.status(401).send({ error: 'Refresh token invalid or revoked' });
    }
    if (rotation.code === 'no_user') {
      return reply.status(401).send({ error: 'User not found' });
    }

    // Preserve the guest claim across rotation: without it, a guest's first
    // refresh would mint a token that walks straight past rejectGuest routes.
    const newAccessToken = signAccessToken({
      sub: payload.sub,
      username: rotation.username,
      admin: rotation.is_admin,
      ...(rotation.is_guest ? { guest: true } : {}),
    });
    reply.setCookie('refreshToken', newRefreshToken, refreshCookieOpts(60 * 60 * 24 * 7));

    stampLastLogin(payload.sub);
    return reply.send({ accessToken: newAccessToken });
  });

  // ── POST /api/auth/change-password ───────────────────────────────────────
  // A logged-in, non-guest user rotates their password. Verifies the current
  // password, hashes the new one, and revokes ALL refresh tokens so other
  // active sessions (e.g. a compromised device) are kicked to the login
  // screen. The current session's refresh cookie is cleared by the client on
  // the next refresh attempt; we leave it to the client flow to re-login.
  fastify.post('/change-password', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = ChangePasswordSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send(formatZodError(parsed.error));
    }
    const { current_password, new_password } = parsed.data;
    if (current_password === new_password) {
      return reply.status(400).send({ error: 'New password must differ from current password' });
    }

    // Look up the user's username/email to seed zxcvbn so a password matching
    // their identity is rejected as easily-guessable.
    const userRow = await queryOne<{ username: string; email: string; password_hash: string }>(
      'SELECT username, email, password_hash FROM users WHERE user_id = $1',
      [request.userId],
    );
    if (!userRow) return reply.status(404).send({ error: 'User not found' });

    const strength = passwordStrengthError(new_password, [userRow.username, userRow.email]);
    if (strength) return reply.status(400).send({ error: strength });

    const ok = await bcrypt.compare(current_password, userRow.password_hash);
    if (!ok) return reply.status(401).send({ error: 'Incorrect current password' });

    const newHash = await bcrypt.hash(new_password, config.bcryptRounds);
    try {
      await withTransaction(async (client) => {
        await client.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [newHash, request.userId]);
        // Invalidate every existing session for this user — including the
        // attacker's if the password rotation is a compromise-response.
        await client.query(
          'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
          [request.userId],
        );
      });
    } catch (err) {
      request.log.error({ err, userId: request.userId }, 'password change failed');
      return reply.status(500).send({ error: 'Password change failed' });
    }

    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return reply.send({ message: 'Password updated; please log in again' });
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
