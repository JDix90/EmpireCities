import { describe, it, expect } from 'vitest';
import { isOwnCardRedemption } from './cardsRedeemed';

describe('isOwnCardRedemption', () => {
  it("is the viewer's own when the payload names their user id or their seat", () => {
    expect(isOwnCardRedemption({ bonus: 4, playerId: 'user-1' }, ['seat-1', 'user-1'])).toBe(true);
    expect(isOwnCardRedemption({ bonus: 4, playerId: 'seat-1' }, ['seat-1', 'user-1'])).toBe(true);
  });

  it("is not the viewer's when another seat redeemed", () => {
    // The bug: an AI's redemption broadcast to the room read as the viewer's own.
    expect(isOwnCardRedemption({ bonus: 4, playerId: 'ai_1' }, ['seat-1', 'user-1'])).toBe(false);
    expect(isOwnCardRedemption({ bonus: 4, playerId: 'ai_1' }, [null, undefined])).toBe(false);
  });

  it('keeps the old reading for a payload from an older server', () => {
    expect(isOwnCardRedemption({ bonus: 4 }, ['user-1'])).toBe(true);
    expect(isOwnCardRedemption({ bonus: 4, playerId: null }, ['user-1'])).toBe(true);
  });
});
