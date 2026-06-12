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
