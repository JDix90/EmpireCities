/**
 * One overlay at a time (overlay_queue_enabled). The product review found the
 * Full Game opening with four at once (the briefing, the era banner, the
 * recap pill and the first-turn coach), the era banner showing through and
 * beside the tutorial card for most of the tutorial, and the surrender offer
 * sitting on a territory a player could not tap through in six tries.
 *
 * Given what wants to show, this says what may. The order is the order a
 * player needs them: an intro or the game-start briefing alone; then the
 * first-turn coach; then the era banner. The tutorial's card keeps the era
 * banner away except on the steps that teach era advancement. Transient
 * messages share one strip above the bottom bar, so the surrender offer
 * takes it from the recap while it stands, and the top of the map stays clear.
 */
export interface OverlayWants {
  /** A campaign or daily intro modal. */
  intro: boolean;
  /** The one-time game-start briefing. */
  briefing: boolean;
  /** A tutorial coaching card is on screen. */
  tutorialCard: boolean;
  /** The tutorial step on screen teaches era advancement. */
  tutorialEraStep: boolean;
  /** The first-turn coach has a prompt for this phase. */
  coach: boolean;
  /** Era advancement is on, so its banner would show. */
  eraBanner: boolean;
  /** The bots' surrender offer stands this round. */
  surrender: boolean;
  /** Recap of the other players' turns (the phone strip or the desktop panel). */
  recap: boolean;
  /** A phone layout: the coach and the strip share the bottom of the screen. */
  phone: boolean;
}

export interface OverlayPlan {
  intro: boolean;
  briefing: boolean;
  coach: boolean;
  eraBanner: boolean;
  surrender: boolean;
  recap: boolean;
}

export function planOverlays(w: OverlayWants): OverlayPlan {
  const modal = w.intro || w.briefing;
  const coach = w.coach && !modal;
  return {
    intro: w.intro,
    // The intro first, then the briefing: never two modals stacked.
    briefing: w.briefing && !w.intro,
    coach,
    eraBanner: w.eraBanner && !modal && !coach && (!w.tutorialCard || w.tutorialEraStep),
    surrender: w.surrender && !modal && !w.tutorialCard,
    // On a phone the strip above the bottom bar carries one message: the
    // coach first, then a standing surrender offer, then the recap. On a
    // desktop the recap is a panel at the top right, clear of both.
    recap: w.recap && !modal && !(w.phone && (coach || (w.surrender && !w.tutorialCard))),
  };
}
