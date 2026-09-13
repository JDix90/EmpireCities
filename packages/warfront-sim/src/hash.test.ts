import { describe, it, expect } from 'vitest';
import { StateHasher } from './hash';

describe('StateHasher', () => {
  it('pins known digests (changing these changes every golden hash)', () => {
    expect(new StateHasher().digest()).toBe('811c9dc5ebb6c228');
    expect(new StateHasher().int(0).digest()).toBe('9be171652e1d9bd8');
    expect(new StateHasher().int(1).int(-1).ascii('move').bool(true).digest()).toBe('44239ac822d3a5d9');
  });

  it('is order sensitive and repeatable', () => {
    const a = new StateHasher().int(1).int(2).digest();
    const b = new StateHasher().int(2).int(1).digest();
    const c = new StateHasher().int(1).int(2).digest();
    expect(a).not.toBe(b);
    expect(a).toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('digest() does not consume state', () => {
    const h = new StateHasher().int(5);
    expect(h.digest()).toBe(h.digest());
  });

  it('rejects floats and non-ASCII', () => {
    expect(() => new StateHasher().int(1.5)).toThrow(/safe integers/);
    expect(() => new StateHasher().ascii('é')).toThrow(/non-ASCII/);
  });
});
