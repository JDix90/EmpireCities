import { describe, it, expect } from 'vitest';
import { aiPlayerName } from '@borderfall/shared';

// Guards the anti-slop intent: AI players never read as auto-numbered "AI Bot N".
describe('aiPlayerName (shared)', () => {
  it('never produces the lazy "AI Bot" name', () => {
    for (let i = 0; i < 14; i++) expect(aiPlayerName(i)).not.toMatch(/AI Bot/i);
  });

  it('tags the name as AI for honesty (so a bot is never mistaken for a human)', () => {
    expect(aiPlayerName(0)).toMatch(/\(AI\)$/);
  });

  it('is deterministic and distinct across the 8 seats of a full game', () => {
    const names = Array.from({ length: 8 }, (_, i) => aiPlayerName(i));
    expect(new Set(names).size).toBe(8);
    expect(aiPlayerName(3)).toBe(aiPlayerName(3));
  });

  it('returns a string for out-of-range / negative indices', () => {
    expect(typeof aiPlayerName(99)).toBe('string');
    expect(typeof aiPlayerName(-1)).toBe('string');
    expect(aiPlayerName(-1)).toMatch(/\(AI\)$/);
  });
});
