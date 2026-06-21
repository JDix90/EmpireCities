/**
 * Gating for the coached first turn (WI1). Kept pure + exported so the truth
 * table is unit-tested without rendering GamePage.
 *
 * Targets ALL brand-new players — anyone with 0 XP, i.e. guests AND newly-
 * registered accounts (a new registered user hits the same first-turn globe
 * confusion). Globe only, first game only (turn 1), and never alongside the
 * tutorial or the opt-in In-Turn Coaching. Behind the `first_turn_coach_enabled`
 * feature flag. Veterans (xp > 0) never qualify.
 */
export interface FirstTurnCoachInput {
  xp: number | null | undefined;
  isTutorial: boolean;
  /** The existing In-Turn Coaching opt-in — don't show two coaching surfaces. */
  coachingEnabled: boolean;
  mapView: '2d' | 'globe';
  turnNumber: number | null | undefined;
  flagEnabled: boolean;
}

export function shouldShowFirstTurnCoach(input: FirstTurnCoachInput): boolean {
  return (
    input.flagEnabled &&
    (input.xp ?? 1) === 0 &&
    !input.isTutorial &&
    !input.coachingEnabled &&
    input.mapView === 'globe' &&
    input.turnNumber === 1
  );
}

export type CoachPhase = 'reinforcement' | 'attack' | 'fortify';

/** Map a game phase to a coach step, or null for phases we don't coach. */
export function coachPhaseForGamePhase(phase: string): CoachPhase | null {
  if (phase === 'draft') return 'reinforcement';
  if (phase === 'attack') return 'attack';
  if (phase === 'fortify') return 'fortify';
  return null;
}
