import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { computePuzzleMoveFeedback } from './puzzleMoveFeedback';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';

/**
 * Grading fixtures for daily-challenge move coaching.
 *
 * `computePuzzleMoveFeedback` is the only consumer of `evaluateBoard`, and it
 * is what tells a player whether the move they just made was strong, fine, or
 * a mistake. These fixtures pin the SEMANTICS — the tier a human would agree
 * with — rather than the raw score, so the heuristic's weights can be retuned
 * without churn but can never again invert.
 *
 * They exist because they caught exactly that inversion: before the border term
 * was normalized, capturing a defended territory graded "risky".
 */

const HUMAN = 'p1';
const AI = 'p2';

/** Two 3-territory realms in a line, each realm worth the same region bonus. */
function fixtureMap(): GameMap {
  const t = (territory_id: string, region_id: string) => ({
    territory_id, name: territory_id, polygon: [], center_point: [0, 0] as [number, number], region_id,
  });
  return {
    map_id: 'grading_fixture',
    name: 'Grading Fixture',
    territories: [
      t('w1', 'r_west'), t('w2', 'r_west'), t('w3', 'r_west'),
      t('e1', 'r_east'), t('e2', 'r_east'), t('e3', 'r_east'),
    ],
    connections: [
      { from: 'w1', to: 'w2', type: 'land' }, { from: 'w2', to: 'w3', type: 'land' },
      { from: 'w1', to: 'e1', type: 'land' }, { from: 'w2', to: 'e2', type: 'land' },
      { from: 'w3', to: 'e3', type: 'land' },
      { from: 'e1', to: 'e2', type: 'land' }, { from: 'e2', to: 'e3', type: 'land' },
    ],
    regions: [
      { region_id: 'r_west', name: 'West', bonus: 3 },
      { region_id: 'r_east', name: 'East', bonus: 3 },
    ],
  } as unknown as GameMap;
}

type Board = Record<string, [owner: string, units: number]>;

function boardState(board: Board): GameState {
  const territories: Record<string, unknown> = {};
  let humanCount = 0;
  let aiCount = 0;
  for (const [territoryId, [ownerId, unitCount]] of Object.entries(board)) {
    territories[territoryId] = { territory_id: territoryId, owner_id: ownerId, unit_count: unitCount };
    if (ownerId === HUMAN) humanCount += 1;
    else aiCount += 1;
  }
  return {
    territories,
    players: [
      { player_id: HUMAN, is_ai: false, is_eliminated: false, territory_count: humanCount },
      { player_id: AI, is_ai: true, is_eliminated: false, territory_count: aiCount },
    ],
  } as unknown as GameState;
}

const MAP = fixtureMap();
const CAPTURE_SPEC = { archetype: 'military_capture' } as unknown as DailyPuzzleSpec;

function grade(before: Board, after: Board) {
  return computePuzzleMoveFeedback(boardState(before), boardState(after), MAP, HUMAN, CAPTURE_SPEC);
}

describe('daily puzzle move grading', () => {
  it('calls a capture strong, not risky', () => {
    // The regression. Taking `e1` costs three units off `w1` and leaves a
    // thinner line — a real tradeoff, but plainly the right move. This used to
    // grade "Risky — consider reinforcing or a safer line next time."
    const feedback = grade(
      { w1: [HUMAN, 5], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 2], e2: [AI, 4], e3: [AI, 4] },
      { w1: [HUMAN, 2], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [HUMAN, 2], e2: [AI, 4], e3: [AI, 4] },
    );
    expect(feedback?.tier).toBe('strong');
  });

  it('calls a failed attack risky', () => {
    // Four units spent, nothing taken.
    const feedback = grade(
      { w1: [HUMAN, 5], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 4], e2: [AI, 4], e3: [AI, 4] },
      { w1: [HUMAN, 1], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 3], e2: [AI, 4], e3: [AI, 4] },
    );
    expect(feedback?.tier).toBe('risky');
  });

  it('calls completing a region strong', () => {
    const feedback = grade(
      { w1: [HUMAN, 3], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [HUMAN, 2], e2: [HUMAN, 2], e3: [AI, 2] },
      { w1: [HUMAN, 3], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [HUMAN, 2], e2: [HUMAN, 1], e3: [HUMAN, 1] },
    );
    expect(feedback?.tier).toBe('strong');
  });

  it('calls reinforcing a threatened border strong', () => {
    const feedback = grade(
      { w1: [HUMAN, 2], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 6], e2: [AI, 4], e3: [AI, 4] },
      { w1: [HUMAN, 6], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 6], e2: [AI, 4], e3: [AI, 4] },
    );
    expect(feedback?.tier).toBe('strong');
  });

  it('calls shuffling a unit between own territories neither', () => {
    const feedback = grade(
      { w1: [HUMAN, 5], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 4], e2: [AI, 4], e3: [AI, 4] },
      { w1: [HUMAN, 4], w2: [HUMAN, 4], w3: [HUMAN, 3], e1: [AI, 4], e2: [AI, 4], e3: [AI, 4] },
    );
    expect(feedback?.tier).toBe('ok');
  });

  it('never lets one term swamp the score', () => {
    // Every term feeding the heuristic is a ratio in [0, 1], so no single one
    // can move the score by more than its own weight. The border term used to
    // be unbounded — that is how a capture came out six times more negative
    // than the "risky" threshold.
    const lopsided = grade(
      { w1: [HUMAN, 1], w2: [HUMAN, 1], w3: [HUMAN, 1], e1: [AI, 1], e2: [AI, 1], e3: [AI, 1] },
      { w1: [HUMAN, 99], w2: [HUMAN, 1], w3: [HUMAN, 1], e1: [AI, 1], e2: [AI, 1], e3: [AI, 1] },
    );
    expect(Math.abs(lopsided!.delta_eval)).toBeLessThan(1);
  });

  it('returns nothing for domination puzzles, which are not move-graded', () => {
    const board: Board = { w1: [HUMAN, 3], w2: [HUMAN, 3], w3: [HUMAN, 3], e1: [AI, 3], e2: [AI, 3], e3: [AI, 3] };
    const feedback = computePuzzleMoveFeedback(
      boardState(board), boardState(board), MAP, HUMAN,
      { archetype: 'domination' } as unknown as DailyPuzzleSpec,
    );
    expect(feedback).toBeNull();
  });
});
