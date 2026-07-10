import { describe, it, expect } from 'vitest';
import { REJECTION_GUIDANCE, resolveRejectionText } from './rejectionMessages';

describe('resolveRejectionText', () => {
  it('returns friendly guidance when the code is mapped', () => {
    expect(resolveRejectionText('NOT_ADJACENT', 'Territories not adjacent')).toBe(
      REJECTION_GUIDANCE.NOT_ADJACENT,
    );
    // Guidance replaces the terse server message, not appends to it.
    expect(resolveRejectionText('NOT_ADJACENT', 'Territories not adjacent')).not.toContain(
      'Territories not adjacent',
    );
  });

  it('falls back to the server message for unmapped codes', () => {
    // INSUFFICIENT_UNITS is intentionally unmapped so the specific server text
    // (e.g. "Cannot place 5 units (2 remaining)") is preserved.
    expect(resolveRejectionText('INSUFFICIENT_UNITS', 'Cannot place 5 units (2 remaining)')).toBe(
      'Cannot place 5 units (2 remaining)',
    );
  });

  it('falls back to the server message when no code is present', () => {
    expect(resolveRejectionText(undefined, 'Some legacy message')).toBe('Some legacy message');
  });

  it('every mapped guidance string is non-empty and does not echo a raw enum key', () => {
    for (const [code, guidance] of Object.entries(REJECTION_GUIDANCE)) {
      expect(guidance.trim().length).toBeGreaterThan(0);
      expect(guidance).not.toBe(code);
    }
  });
});
