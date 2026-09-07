/**
 * How a resolved combat is presented to the player it involves.
 *
 * Lite mode is labelled "skip combat & map animations", and it used to skip the
 * whole readout: neither the attacker's dice modal nor the defender's incoming
 * theater was queued, so a player with it on could attack, lose four units, and
 * see nothing but a line in the combat log. That is more than the label
 * promises. Lite mode now suppresses the *animation*, not the information — the
 * roll settles instantly and the card dismisses itself.
 */
export interface CombatCardMode {
  /** Queue the card at all. Always true: the dice are the information. */
  show: boolean;
  /** Dismiss after the dice settle instead of waiting on a click. */
  autoAdvance: boolean;
}

/** The card for an attack the local player made. */
export function ownAttackCardMode(opts: {
  liteMode: boolean;
  /** The same attack can be rolled again — so the card carries a decision. */
  canRepeatAttack: boolean;
}): CombatCardMode {
  // Never auto-advance past a roll the player can act on again: "Attack again"
  // and "Blitz" need a decision, lite mode or not.
  return { show: true, autoAdvance: opts.liteMode && !opts.canRepeatAttack };
}

/** The card for an attack made against the local player. */
export function incomingAttackCardMode(_opts: { liteMode: boolean }): CombatCardMode {
  // The defender's theater already auto-advances; lite mode only makes it
  // quicker (via the same `hurry` fast path), it does not need to hide it.
  return { show: true, autoAdvance: true };
}
