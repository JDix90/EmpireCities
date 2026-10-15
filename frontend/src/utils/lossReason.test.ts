import { describe, it, expect } from 'vitest';
import { lossReason } from './lossReason';

describe('lossReason', () => {
  it('names the round the player\'s territories fell furthest', () => {
    expect(lossReason({ worst_round_loss: { turn: 12, from: 9, to: 4 } })).toEqual({
      kind: 'collapse',
      text:
        'Turn 12 cost you most: your territories fell from 9 to 4 in one round. ' +
        'Fewer borders with your armies stacked on them are harder to break through.',
    });
  });

  it('needs a fall of 4 or more territories, and 40% of what was held', () => {
    expect(lossReason({ worst_round_loss: { turn: 3, from: 5, to: 2 } })).toBeNull(); // 3 lost
    expect(lossReason({ worst_round_loss: { turn: 3, from: 12, to: 8 } })).toBeNull(); // a third
    expect(lossReason({ worst_round_loss: { turn: 3, from: 10, to: 6 } })?.kind).toBe('collapse');
    expect(lossReason({ worst_round_loss: null })).toBeNull();
  });

  it('names card sets held and never traded, from 3 turns', () => {
    expect(lossReason({ turns_ended_with_set: 2 })).toBeNull();
    expect(lossReason({ turns_ended_with_set: 6 })).toEqual({
      kind: 'idle_cards',
      text:
        'You ended 6 turns holding a set of cards you never traded. ' +
        'Trading a set while you place armies gives you extra ones.',
    });
  });

  it('names armies lost to event cards, from 8', () => {
    expect(lossReason({ units_lost_to_events: 7 })).toBeNull();
    expect(lossReason({ units_lost_to_events: 14 })).toEqual({
      kind: 'events',
      text: 'Event cards took 14 armies from you over the game.',
    });
  });

  it('picks the strongest reason', () => {
    // Half the land in a round outweighs three idle turns.
    expect(lossReason({
      worst_round_loss: { turn: 9, from: 8, to: 4 },
      turns_ended_with_set: 3,
      units_lost_to_events: 9,
    })?.kind).toBe('collapse');
    // Eight idle turns outweigh losing 40% in a round.
    expect(lossReason({
      worst_round_loss: { turn: 9, from: 10, to: 6 },
      turns_ended_with_set: 8,
    })?.kind).toBe('idle_cards');
    // Heavy event losses outweigh a borderline collapse.
    expect(lossReason({
      worst_round_loss: { turn: 9, from: 10, to: 6 },
      units_lost_to_events: 30,
    })?.kind).toBe('events');
  });

  it('says nothing when nothing stands out', () => {
    expect(lossReason({})).toBeNull();
    expect(lossReason({ units_lost_to_events: 2, turns_ended_with_set: 1, worst_round_loss: { turn: 4, from: 6, to: 5 } })).toBeNull();
  });
});
