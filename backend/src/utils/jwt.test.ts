import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { signAccessToken, verifyAccessToken } from './jwt';

describe('jwt algorithm pinning', () => {
  it('accepts a normally-signed (HS256) access token', () => {
    const token = signAccessToken({ sub: 'u1', username: 'alice', admin: false });
    expect(verifyAccessToken(token)?.sub).toBe('u1');
  });

  it('rejects a token signed with a different algorithm (algorithm-confusion defense)', () => {
    // Same secret, but HS512 instead of the pinned HS256.
    const forged = jwt.sign(
      { sub: 'attacker', username: 'mallory', admin: true },
      config.jwt.accessSecret,
      { algorithm: 'HS512' },
    );
    expect(verifyAccessToken(forged)).toBeNull();
  });

  it('rejects an alg:none token', () => {
    const none = jwt.sign({ sub: 'attacker', username: 'mallory' }, '', { algorithm: 'none' });
    expect(verifyAccessToken(none)).toBeNull();
  });
});
