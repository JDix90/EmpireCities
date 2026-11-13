import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapControlChip, MapControlObjective, describeMapControl } from './MapControlTracker';

const progress = { held: 18, total: 42, heldPct: 42, thresholdPct: 65, needed: 28, remaining: 10 };

describe('MapControlChip', () => {
  it('shows the share held over the share that wins, and says both in words', () => {
    render(<MapControlChip progress={progress} />);
    const meter = screen.getByRole('meter', { name: 'Map control' });
    // "42%/65%" alone said nothing on a phone, where the sidebar that explains it is behind the menu.
    expect(meter).toHaveTextContent('Map 42%/65%');
    expect(meter).toHaveAttribute('aria-valuetext', 'You hold 42% of the map. 65% wins — 10 more territories.');
  });
});

describe('describeMapControl', () => {
  it('counts the last territory in the singular', () => {
    expect(describeMapControl({ ...progress, held: 27, heldPct: 64, remaining: 1 }))
      .toBe('You hold 64% of the map. 65% wins — 1 more territory.');
  });

  it('drops the countdown once the threshold is met', () => {
    expect(describeMapControl({ ...progress, held: 28, heldPct: 66, remaining: 0 }))
      .toBe('You hold 66% of the map — 65% wins.');
  });
});

describe('describeMapControl in a team game', () => {
  it("speaks for the viewer's side", () => {
    expect(describeMapControl({ ...progress, side: true }))
      .toBe('Your side holds 42% of the map. 65% wins — 10 more territories.');
    expect(describeMapControl({ ...progress, held: 28, heldPct: 66, remaining: 0, side: true }))
      .toBe('Your side holds 66% of the map — 65% wins.');
  });
});

describe('era-tied conquest', () => {
  const conquest = { basePct: 65, claimAtTurnStart: true, onCourse: false, rivalsOnCourse: [] as string[] };

  it('says the share does not count until the player reaches the last era', () => {
    expect(describeMapControl({ ...progress, conquest: { ...conquest, lockedUntilEraId: 'modern' } }))
      .toBe('You hold 42% of the map. 65% wins once you reach the last era, The Modern Day.');
  });

  it('says the share is about to fall', () => {
    expect(describeMapControl({ ...progress, thresholdPct: 50, needed: 21, remaining: 3, conquest: { ...conquest, nextPct: 47 } }))
      .toBe('You hold 42% of the map. 50% wins — 3 more territories. Next round 47% wins.');
  });

  it('says holding the share wins when the turn comes round, not at once', () => {
    expect(describeMapControl({ ...progress, held: 28, heldPct: 66, remaining: 0, conquest: { ...conquest, onCourse: true } }))
      .toBe('You hold 66% of the map — 65% wins. Hold it until your next turn begins.');
  });

  it('warns in the sidebar when a rival is on course to win', () => {
    render(<MapControlObjective progress={{ ...progress, conquest: { ...conquest, rivalsOnCourse: ['Rome'], nextPct: 47 } }} />);
    expect(screen.getByTestId('conquest-rival-on-course')).toHaveTextContent('Rome holds the share that wins, and wins when their turn begins. Take territory from them first.');
    expect(screen.getByTestId('conquest-share-note')).toHaveTextContent('The share needed falls to 47% next round.');
  });

  it('tells the player when they are the one on course', () => {
    render(<MapControlObjective progress={{ ...progress, held: 28, heldPct: 66, remaining: 0, conquest: { ...conquest, onCourse: true } }} />);
    expect(screen.getByTestId('conquest-on-course')).toHaveTextContent('Keep it until your next turn begins');
  });

  it('adds nothing in a game without it', () => {
    render(<MapControlObjective progress={progress} />);
    expect(screen.queryByTestId('conquest-share-note')).toBeNull();
  });
});
