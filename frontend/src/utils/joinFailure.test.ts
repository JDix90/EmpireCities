import { describe, it, expect } from 'vitest';
import { resolveJoinFailure } from './joinFailure';

describe('resolveJoinFailure', () => {
  it('routes an already-started game to spectate', () => {
    expect(resolveJoinFailure(409, 'not_waiting')).toBe('spectate');
  });

  it('shows the error screen for gone / full / unknown failures', () => {
    expect(resolveJoinFailure(404, 'not_found')).toBe('error');
    expect(resolveJoinFailure(409, 'full')).toBe('error');
    expect(resolveJoinFailure(409, 'already_joined')).toBe('error');
    expect(resolveJoinFailure(500, undefined)).toBe('error');
    expect(resolveJoinFailure(undefined, undefined)).toBe('error');
  });
});
