/**
 * Maps machine-readable socket rejection codes (backend `GameErrorCode`) to
 * concise, actionable player guidance. When a rejected action carries a code
 * present in this map, the in-game error toast shows this guidance instead of
 * the raw server message — turning "Territories not adjacent" into a sentence
 * that tells a first-time player what to do next.
 *
 * Codes whose server message already carries specifics worth keeping (unit
 * counts, stability caps, orbit-access reasons, fortify limits) are deliberately
 * OMITTED here so the toast falls back to that more specific server message.
 *
 * Keep the keys in sync with backend/src/sockets/socketErrors.ts.
 */
export const REJECTION_GUIDANCE: Record<string, string> = {
  NOT_YOUR_TURN: "It's not your turn yet — wait for your turn to act.",
  WRONG_PHASE: "That move isn't available in this phase. Check the phase bar for what you can do now.",
  NOT_OWNER: "You can only act from a territory you own. Select one of your own territories first.",
  NOT_ADJACENT: "Those territories don't share a border. Pick a territory next to your selected one.",
  PATH_NOT_CONNECTED: "Fortify only moves along a connected chain of territories you own.",
  ALREADY_ADVANCED: "You advanced an era this turn, so you can't attack until your next turn.",
  TRUCE_ACTIVE: "You have an active truce with this player. Break the truce first to attack them.",
  LANE_SEALED: "That hyperspace lane is sealed — choose a different route.",
  INVALID_TERRITORY: "That territory can't be used for this action. Pick a highlighted one.",
  NON_INTEGER_UNITS: "Enter a whole number of units.",
  ACTION_IN_FLIGHT: "Still processing your last action — give it a moment and try again.",
};

/**
 * Resolve the best player-facing rejection text: friendly guidance when the code
 * is mapped, otherwise the server-provided message (which, for the omitted
 * codes, already carries the specific detail like remaining unit counts).
 */
export function resolveRejectionText(code: string | undefined, fallbackMessage: string): string {
  if (code && REJECTION_GUIDANCE[code]) return REJECTION_GUIDANCE[code];
  return fallbackMessage;
}
