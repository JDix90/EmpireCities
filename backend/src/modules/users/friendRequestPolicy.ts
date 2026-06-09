export type FriendRequestsPolicy = 'everyone' | 'friends_of_friends' | 'nobody';

export function parseFriendRequestsPolicy(value: unknown): FriendRequestsPolicy {
  if (value === 'friends_of_friends' || value === 'nobody') return value;
  return 'everyone';
}

/** Whether a friend request from requesterId to targetId is allowed by policy. */
export function isFriendRequestAllowed(
  policy: FriendRequestsPolicy,
  hasMutualFriend: boolean,
): boolean {
  switch (policy) {
    case 'nobody':
      return false;
    case 'friends_of_friends':
      return hasMutualFriend;
    case 'everyone':
    default:
      return true;
  }
}

export function friendRequestBlockedMessage(policy: FriendRequestsPolicy): string {
  switch (policy) {
    case 'nobody':
      return 'This player is not accepting friend requests';
    case 'friends_of_friends':
      return 'This player only accepts friend requests from mutual friends';
    default:
      return 'Cannot send friend request';
  }
}
