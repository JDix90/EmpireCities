import { describe, it, expect } from 'vitest';
import type { ReadinessCheck } from './readiness';

describe('readiness shape', () => {
  it('ReadinessCheck requires name and ok', () => {
    const c: ReadinessCheck = { name: 'postgres', ok: true };
    expect(c.name).toBe('postgres');
    expect(c.ok).toBe(true);
  });
});
