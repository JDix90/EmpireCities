/**
 * One overlay at a time (overlay_queue_enabled): what may show, given what
 * wants to.
 */
import { describe, it, expect } from 'vitest';
import { planOverlays, type OverlayWants } from './overlayQueue';

const want = (o: Partial<OverlayWants> = {}): OverlayWants => ({
  intro: false,
  briefing: false,
  tutorialCard: false,
  tutorialEraStep: false,
  coach: false,
  eraBanner: false,
  surrender: false,
  recap: false,
  phone: true,
  ...o,
});

describe('planOverlays', () => {
  it('opens a Full Game on the briefing alone, not four overlays at once', () => {
    const plan = planOverlays(want({ briefing: true, coach: true, eraBanner: true, recap: true }));
    expect(plan).toEqual({ intro: false, briefing: true, coach: false, eraBanner: false, surrender: false, recap: false });
  });

  it('then the coach; the era banner waits for it, and on a phone so does the recap strip', () => {
    expect(planOverlays(want({ coach: true, eraBanner: true, recap: true }))).toMatchObject({ coach: true, eraBanner: false, recap: false });
    // On desktop the recap is a side panel, clear of the coach.
    expect(planOverlays(want({ coach: true, recap: true, phone: false }))).toMatchObject({ coach: true, recap: true });
  });

  it('then the era banner, once nothing is ahead of it', () => {
    expect(planOverlays(want({ eraBanner: true, recap: true }))).toMatchObject({ eraBanner: true, recap: true });
  });

  it('never stacks two modals: the intro first, then the briefing', () => {
    expect(planOverlays(want({ intro: true, briefing: true }))).toMatchObject({ intro: true, briefing: false });
  });

  it('keeps the era banner off the tutorial card except on the steps about eras', () => {
    expect(planOverlays(want({ tutorialCard: true, eraBanner: true })).eraBanner).toBe(false);
    expect(planOverlays(want({ tutorialCard: true, tutorialEraStep: true, eraBanner: true })).eraBanner).toBe(true);
  });

  it('gives a standing surrender offer the strip, ahead of the recap', () => {
    expect(planOverlays(want({ surrender: true, recap: true }))).toMatchObject({ surrender: true, recap: false });
    // A desktop's recap panel sits at the top right, clear of the strip.
    expect(planOverlays(want({ surrender: true, recap: true, phone: false }))).toMatchObject({ surrender: true, recap: true });
    // Not over a briefing or a tutorial card.
    expect(planOverlays(want({ surrender: true, briefing: true })).surrender).toBe(false);
    expect(planOverlays(want({ surrender: true, tutorialCard: true, recap: true }))).toMatchObject({ surrender: false, recap: true });
  });
});
