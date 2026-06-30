import { describe, it, expect } from 'vitest';
import { buildInviteUrl } from './inviteLink';

describe('buildInviteUrl', () => {
  const origin = 'https://borderfall.app';

  it('prefers the join-code link so fresh invitees go through the lobby join flow', () => {
    expect(buildInviteUrl(origin, 'game-123', 'ABCD')).toBe('https://borderfall.app/join/ABCD');
  });

  it('falls back to the (self-healing) /game/:id link when no join code exists', () => {
    expect(buildInviteUrl(origin, 'game-123', null)).toBe('https://borderfall.app/game/game-123');
    expect(buildInviteUrl(origin, 'game-123', undefined)).toBe('https://borderfall.app/game/game-123');
  });

  it('treats an empty join code as absent', () => {
    expect(buildInviteUrl(origin, 'game-123', '')).toBe('https://borderfall.app/game/game-123');
  });
});
