import { describe, it, expect } from 'vitest';
import {
  glickoUpdate,
  placementScore,
  scoreVsOpponent,
  syntheticAiOpponent,
} from './ratingService';

describe('scoreVsOpponent', () => {
  it('gives the winner full credit against AI opponents', () => {
    expect(scoreVsOpponent({ rank: 1, totalPlayers: 4, isWinner: true, opponentIsAi: true })).toBe(1);
  });

  it('gives non-winners zero against AI opponents regardless of placement', () => {
    expect(scoreVsOpponent({ rank: 2, totalPlayers: 4, isWinner: false, opponentIsAi: true })).toBe(0);
    expect(scoreVsOpponent({ rank: 4, totalPlayers: 4, isWinner: false, opponentIsAi: true })).toBe(0);
  });

  it('keeps placement-based scoring against human opponents', () => {
    expect(scoreVsOpponent({ rank: 2, totalPlayers: 4, isWinner: false, opponentIsAi: false })).toBe(
      placementScore(2, 4),
    );
    expect(scoreVsOpponent({ rank: 1, totalPlayers: 4, isWinner: true, opponentIsAi: false })).toBe(1);
  });
});

describe('rating cannot increase on a solo defeat', () => {
  it('loses (or holds) rating when scoring 0 vs three medium AI opponents', () => {
    // Regression for the live bug: a resigned defeat at rank 2/4 in a solo
    // game produced +88 because placementScore(2,4)=0.667 was applied vs AI.
    const ai = syntheticAiOpponent('medium');
    const opponents = [0, 1, 2].map(() => ({ mu: ai.mu, phi: ai.phi, score: 0 }));
    const updated = glickoUpdate(1500, 350, opponents);
    expect(updated.mu).toBeLessThanOrEqual(1500);
  });

  it('previously-buggy placement scoring would have gained rating (sanity)', () => {
    const ai = syntheticAiOpponent('medium');
    const opponents = [0, 1, 2].map(() => ({ mu: ai.mu, phi: ai.phi, score: placementScore(2, 4) }));
    const updated = glickoUpdate(1500, 350, opponents);
    expect(updated.mu).toBeGreaterThan(1500);
  });

  it('still gains rating on a win vs AI opponents', () => {
    const ai = syntheticAiOpponent('medium');
    const opponents = [0, 1, 2].map(() => ({ mu: ai.mu, phi: ai.phi, score: 1 }));
    const updated = glickoUpdate(1500, 350, opponents);
    expect(updated.mu).toBeGreaterThan(1500);
  });
});
