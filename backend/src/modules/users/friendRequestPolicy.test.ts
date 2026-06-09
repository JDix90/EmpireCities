import { describe, expect, it } from 'vitest';
import {
  friendRequestBlockedMessage,
  isFriendRequestAllowed,
  parseFriendRequestsPolicy,
} from './friendRequestPolicy';

describe('friendRequestPolicy', () => {
  it('parses known policies and defaults unknown values to everyone', () => {
    expect(parseFriendRequestsPolicy('everyone')).toBe('everyone');
    expect(parseFriendRequestsPolicy('friends_of_friends')).toBe('friends_of_friends');
    expect(parseFriendRequestsPolicy('nobody')).toBe('nobody');
    expect(parseFriendRequestsPolicy('invalid')).toBe('everyone');
    expect(parseFriendRequestsPolicy(undefined)).toBe('everyone');
  });

  it('allows everyone policy regardless of mutual friends', () => {
    expect(isFriendRequestAllowed('everyone', false)).toBe(true);
    expect(isFriendRequestAllowed('everyone', true)).toBe(true);
  });

  it('blocks nobody policy always', () => {
    expect(isFriendRequestAllowed('nobody', false)).toBe(false);
    expect(isFriendRequestAllowed('nobody', true)).toBe(false);
  });

  it('friends_of_friends requires a mutual friend', () => {
    expect(isFriendRequestAllowed('friends_of_friends', false)).toBe(false);
    expect(isFriendRequestAllowed('friends_of_friends', true)).toBe(true);
  });

  it('returns user-facing blocked messages', () => {
    expect(friendRequestBlockedMessage('nobody')).toContain('not accepting');
    expect(friendRequestBlockedMessage('friends_of_friends')).toContain('mutual friends');
  });
});
