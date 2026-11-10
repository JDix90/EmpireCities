import { describe, it, expect } from 'vitest';
import { placementGameNumber, PLACEMENT_GAMES } from './statsManager';

describe('placementGameNumber (placement_rating_enabled)', () => {
  it('numbers a player\u2019s first five rated games of a kind', () => {
    expect(PLACEMENT_GAMES).toBe(5);
    expect(placementGameNumber(0)).toBe(1);
    expect(placementGameNumber(4)).toBe(5);
  });

  it('is nothing from the sixth on, when the rating shows', () => {
    expect(placementGameNumber(5)).toBeNull();
    expect(placementGameNumber(40)).toBeNull();
  });
});
