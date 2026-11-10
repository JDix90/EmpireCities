/**
 * Why a player lost, in one line (`loss_reason_enabled`). The defeat screen's
 * coaching lists the player's best moves and never said what went wrong; these
 * are the per-player tallies the server keeps on every game
 * (backend game-engine/state/lossTally.ts), sent in the game-over stats.
 */

export interface LossTallies {
  /** Units this player lost to event cards. */
  units_lost_to_events?: number;
  /** Turns that began holding a tradeable card set and ended without trading one. */
  turns_ended_with_set?: number;
  /** The round the player's territory count fell furthest in. */
  worst_round_loss?: { turn: number; from: number; to: number } | null;
  /** Turns the player took, and of those, turns with at least one attack in them. */
  turns_taken?: number;
  turns_attacked?: number;
  /** Turns of theirs the turn clock (or an async deadline) ended. */
  turns_timed_out?: number;
}

export type LossReasonKind = 'never_attacked' | 'rarely_attacked' | 'clock' | 'collapse' | 'idle_cards' | 'events';

/**
 * How the player played (`loss_reason_play_enabled`). The commonest loss a new
 * player has is slow erosion from not attacking: a stand-in that never attacks
 * loses every first match against one Easy bot, and the reasons above never
 * named it. Never attacking needs a few turns to be a pattern rather than a
 * short game; rarely is under a third of the player's turns.
 */
export const NEVER_ATTACKED_MIN_TURNS = 3;
export const RARELY_ATTACKED_MIN_TURNS = 5;
export const RARELY_ATTACKED_MAX_SHARE = 1 / 3;
export const CLOCK_MIN_TURNS = 2;

export interface LossReason {
  kind: LossReasonKind;
  text: string;
}

/** A collapse is at least this many territories... */
export const COLLAPSE_MIN_LOST = 4;
/** ...and at least this share of what the player held. */
export const COLLAPSE_MIN_SHARE = 0.4;
export const IDLE_SET_MIN_TURNS = 3;
export const EVENT_MIN_UNITS = 8;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The strongest reason, or null when nothing stands out (a close game lost on
 * the last turn says nothing here rather than something invented). Each reason
 * that clears its bar is scored, and the highest wins: a collapse by the share
 * of territory lost (0.4 to 1), idle sets by how many turns (0.5 at 3, 1 at 8),
 * event losses by how many units, capped low (at most 0.6) because a region
 * disaster takes from every player alike. Ties go to the order collapse, idle
 * cards, events. With `play` (loss_reason_play_enabled), how the player played
 * comes first: never attacking scores 1, rarely attacking 0.42 to 0.75 by how
 * rarely, and turns the clock ended 0.5 at two rising to 0.9.
 */
export function lossReason(t: LossTallies, options: { play?: boolean } = {}): LossReason | null {
  const candidates: Array<{ score: number } & LossReason> = [];

  // How the player played, first so a tie goes to it: a player who never
  // attacked also collapses, and the collapse is the symptom.
  if (options.play) {
    const taken = t.turns_taken ?? 0;
    const attacked = t.turns_attacked ?? 0;
    if (taken >= NEVER_ATTACKED_MIN_TURNS && attacked === 0) {
      candidates.push({
        kind: 'never_attacked',
        score: 1,
        text:
          'You never attacked. Bots grow when they are left alone: stack your armies on one border, ' +
          'then attack the weakest neighbour from there.',
      });
    } else if (taken >= RARELY_ATTACKED_MIN_TURNS && attacked / taken < RARELY_ATTACKED_MAX_SHARE) {
      candidates.push({
        kind: 'rarely_attacked',
        score: 0.75 - attacked / taken,
        text:
          `You attacked in only ${attacked} of your ${taken} turns. Every turn you hold back, the other side grows: ` +
          'attack the weakest neighbour from your biggest stack.',
      });
    }
    const clock = t.turns_timed_out ?? 0;
    if (clock >= CLOCK_MIN_TURNS) {
      candidates.push({
        kind: 'clock',
        score: Math.min(0.9, 0.5 + 0.1 * (clock - CLOCK_MIN_TURNS)),
        text:
          `The clock ran out on ${plural(clock, 'turn', 'turns')} of yours, so the game placed your armies ` +
          'and ended those turns for you.',
      });
    }
  }

  const fall = t.worst_round_loss;
  if (fall && fall.from > 0) {
    const lost = fall.from - fall.to;
    const share = lost / fall.from;
    if (lost >= COLLAPSE_MIN_LOST && share >= COLLAPSE_MIN_SHARE) {
      candidates.push({
        kind: 'collapse',
        score: share,
        text:
          `Turn ${fall.turn} cost you most: your territories fell from ${fall.from} to ${fall.to} in one round. ` +
          'Fewer borders with your armies stacked on them are harder to break through.',
      });
    }
  }

  const idle = t.turns_ended_with_set ?? 0;
  if (idle >= IDLE_SET_MIN_TURNS) {
    candidates.push({
      kind: 'idle_cards',
      score: Math.min(1, 0.5 + 0.1 * (idle - IDLE_SET_MIN_TURNS)),
      text:
        `You ended ${plural(idle, 'turn', 'turns')} holding a set of cards you never traded. ` +
        'Trading a set while you place armies gives you extra ones.',
    });
  }

  const events = t.units_lost_to_events ?? 0;
  if (events >= EVENT_MIN_UNITS) {
    candidates.push({
      kind: 'events',
      score: Math.min(0.6, 0.3 + events / 60),
      text: `Event cards took ${plural(events, 'army', 'armies')} from you over the game.`,
    });
  }

  let best: (typeof candidates)[number] | null = null;
  for (const c of candidates) if (!best || c.score > best.score) best = c;
  return best ? { kind: best.kind, text: best.text } : null;
}
