import { describe, it, expect } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken';

describe('unsubscribeToken', () => {
  const userId = 'a3f1c2e4-5678-4abc-9def-0123456789ab';

  it('round-trips a signed token', () => {
    const token = signUnsubscribeToken(userId);
    expect(verifyUnsubscribeToken(token)).toBe(userId);
  });

  it('rejects a tampered payload', () => {
    const token = signUnsubscribeToken(userId);
    const otherId = 'b3f1c2e4-5678-4abc-9def-0123456789ab';
    const forged = `${Buffer.from(otherId, 'utf8').toString('base64url')}.${token.split('.')[1]}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signUnsubscribeToken(userId);
    const [payload, sig] = token.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(verifyUnsubscribeToken(`${payload}.${flipped}`)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('no-dot')).toBeNull();
    expect(verifyUnsubscribeToken('.sigonly')).toBeNull();
    expect(verifyUnsubscribeToken('payloadonly.')).toBeNull();
    expect(verifyUnsubscribeToken('!!!.###')).toBeNull();
  });
});
