/**
 * Canonical display names for each game phase — the ONE source shared by the
 * HUD header, the phase-progression bar, and tutorial/help copy. Promoted here
 * out of GameHUD so the header and the new PhaseProgressBar can't drift apart.
 */
export const PHASE_LABELS: Record<string, string> = {
  territory_select: 'Territory Draft',
  draft: 'Reinforcement',
  attack: 'Attack',
  fortify: 'Fortify',
  game_over: 'Game Over',
};

/**
 * The repeating per-turn phase cycle, in order. `territory_select` (the opening
 * land grab) and `game_over` sit outside this cycle, so the phase-progression
 * bar renders only for these three (plus a terminal "End Turn" step).
 */
export const TURN_PHASE_ORDER = ['draft', 'attack', 'fortify'] as const;

/**
 * Short, verb-first phase names for the compact phase-progression bar —
 * "Reinforce → Attack → Fortify → End Turn", the canonical player vocabulary.
 * The draft phase reads "Reinforce" here (vs the header's "Reinforcement" noun)
 * to fit the stepper and match how players describe the action.
 */
export const PHASE_SHORT_LABELS: Record<string, string> = {
  draft: 'Reinforce',
  attack: 'Attack',
  fortify: 'Fortify',
};

/**
 * The ONE label set for the gold phase-advance button, shared by the desktop
 * sidebar, the mobile bottom bar, and the tutorial copy.
 *
 * History: desktop said "Begin Attack Phase →" while mobile said "End Draft",
 * and the tutorial referenced only the desktop names — stranding phone
 * players at step 4, hunting for a button that wasn't on their screen.
 * "Begin <next> →" framing wins because it teaches what comes next; the
 * shortened form fits a 390px bottom bar.
 */
export function phaseAdvanceLabel(phase: string): string {
  switch (phase) {
    case 'draft':
      return 'Begin Attack →';
    case 'attack':
      return 'Begin Fortify →';
    case 'fortify':
      return 'End Turn →';
    default:
      return 'Next Phase →';
  }
}
