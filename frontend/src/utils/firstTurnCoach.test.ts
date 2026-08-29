import { describe, it, expect } from 'vitest';
import {
  shouldShowFirstTurnCoach,
  coachPhaseForGamePhase,
  type FirstTurnCoachInput,
} from './firstTurnCoach';

const base: FirstTurnCoachInput = {
  xp: 0,
  isTutorial: false,
  coachingEnabled: false,
  mapView: 'globe',
  turnNumber: 1,
  flagEnabled: true,
};

describe('shouldShowFirstTurnCoach', () => {
  it('shows for a brand-new player on turn 1 on the globe (happy path)', () => {
    expect(shouldShowFirstTurnCoach(base)).toBe(true);
  });

  it('hides when the flag is off', () => {
    expect(shouldShowFirstTurnCoach({ ...base, flagEnabled: false })).toBe(false);
  });

  it('hides for veterans (xp > 0)', () => {
    expect(shouldShowFirstTurnCoach({ ...base, xp: 50 })).toBe(false);
  });

  it('treats missing xp as a veteran (no coaching)', () => {
    expect(shouldShowFirstTurnCoach({ ...base, xp: null })).toBe(false);
    expect(shouldShowFirstTurnCoach({ ...base, xp: undefined })).toBe(false);
  });

  it('hides during the tutorial', () => {
    expect(shouldShowFirstTurnCoach({ ...base, isTutorial: true })).toBe(false);
  });

  it('hides when In-Turn Coaching is on (no double coaching)', () => {
    expect(shouldShowFirstTurnCoach({ ...base, coachingEnabled: true })).toBe(false);
  });

  it('hides on the 2D map', () => {
    expect(shouldShowFirstTurnCoach({ ...base, mapView: '2d' })).toBe(false);
  });

  it('hides after turn 1', () => {
    expect(shouldShowFirstTurnCoach({ ...base, turnNumber: 2 })).toBe(false);
  });

  it('reads the active view, not the stored preference', () => {
    // GamePage opens every game on the globe but no longer writes that choice
    // to `cc-preferred-map-view`. A player whose stored preference is 2D is
    // therefore still on the globe for their first game, and still gets coached
    // — `mapView` here is the live view GamePage is rendering, not the
    // preference it read at mount.
    expect(shouldShowFirstTurnCoach({ ...base, mapView: 'globe' })).toBe(true);
  });
});

describe('coachPhaseForGamePhase', () => {
  it('maps game phases to coach steps', () => {
    expect(coachPhaseForGamePhase('draft')).toBe('reinforcement');
    expect(coachPhaseForGamePhase('attack')).toBe('attack');
    expect(coachPhaseForGamePhase('fortify')).toBe('fortify');
  });

  it('returns null for phases we do not coach', () => {
    expect(coachPhaseForGamePhase('territory_select')).toBeNull();
    expect(coachPhaseForGamePhase('game_over')).toBeNull();
  });
});
