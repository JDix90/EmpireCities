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

describe('lossReason: how the player played (loss_reason_play_enabled)', () => {
  const play = { play: true };

  it('says the player never attacked, once it is a pattern', () => {
    expect(lossReason({ turns_taken: 2, turns_attacked: 0 }, play)).toBeNull();
    expect(lossReason({ turns_taken: 7, turns_attacked: 0 }, play)).toEqual({
      kind: 'never_attacked',
      text:
        'You never attacked. Bots grow when they are left alone: stack your armies on one border, ' +
        'then attack the weakest neighbour from there.',
    });
  });

  it('puts never attacking ahead of the collapse it causes', () => {
    const t = { turns_taken: 7, turns_attacked: 0, worst_round_loss: { turn: 7, from: 6, to: 0 } };
    expect(lossReason(t, play)?.kind).toBe('never_attacked');
    expect(lossReason(t)?.kind).toBe('collapse');
  });

  it('says the player rarely attacked, under a third of their turns', () => {
    expect(lossReason({ turns_taken: 9, turns_attacked: 2 }, play)).toEqual({
      kind: 'rarely_attacked',
      text:
        'You attacked in only 2 of your 9 turns. Every turn you hold back, the other side grows: ' +
        'attack the weakest neighbour from your biggest stack.',
    });
    expect(lossReason({ turns_taken: 9, turns_attacked: 3 }, play)).toBeNull();
    expect(lossReason({ turns_taken: 4, turns_attacked: 1 }, play)).toBeNull();
  });

  it('says the clock ended the player\u2019s turns, from two', () => {
    expect(lossReason({ turns_timed_out: 1 }, play)).toBeNull();
    expect(lossReason({ turns_timed_out: 3 }, play)).toEqual({
      kind: 'clock',
      text: 'The clock ran out on 3 turns of yours, so the game placed your armies and ended those turns for you.',
    });
  });

  it('says none of it with the flag off', () => {
    expect(lossReason({ turns_taken: 7, turns_attacked: 0, turns_timed_out: 4 })).toBeNull();
  });
});
