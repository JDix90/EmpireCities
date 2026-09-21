/**
 * Daily Challenge v2 on the client (docs/DAILY_PUZZLE_V2.md): the shapes the
 * server sends and the words the cards use. Pure, so the copy is testable
 * without a socket.
 */

export type StoredPuzzleAction =
  | { kind: 'draft'; to: string; split?: string }
  | { kind: 'assault'; from: string; to: string; keep: number }
  | { kind: 'end_attack' }
  | { kind: 'fortify'; from: string; to: string; units: 'all_but_1' | 'half' }
  | { kind: 'end_turn' };

/** What /daily/today and the game state carry of a v2 day (never the solution). */
export interface PublicDailyPuzzleV2 {
  version: 2;
  theme: string;
  plan_prose: string[];
  decisions_target: number;
  verdicts: 'before_dice' | 'silent';
  intent: 'arrows' | 'prose';
  /** Decisions along the best line: the number the intro promises. */
  decisions: number;
}

export type PuzzleGrade = 'best' | 'good' | 'inaccuracy' | 'blunder';

/** The server's answer to game:puzzle_propose. */
export interface PuzzleVerdict {
  gameId?: string;
  decision: boolean;
  silent: boolean;
  equity?: number;
  best_equity?: number;
  loss?: number;
  grade?: PuzzleGrade;
  takebacks?: number;
  best?: StoredPuzzleAction;
}

export interface PuzzleDecisionRecord {
  key: string;
  turn: number;
  phase: 'draft' | 'attack' | 'fortify';
  best: StoredPuzzleAction;
  best_equity: number;
  first: StoredPuzzleAction | null;
  first_equity: number;
  loss: number;
  grade: PuzzleGrade;
  takebacks: number;
  revealed?: boolean;
  chosen?: StoredPuzzleAction | null;
  chosen_equity?: number;
  chosen_loss?: number;
}

/** game:puzzle_review, alongside game over. */
export interface PuzzleReview {
  gameId?: string;
  won: boolean;
  theme: string | null;
  accuracy: number;
  score: number;
  star: boolean;
  crown: boolean;
  first_try: boolean;
  attempts: number;
  takebacks: number;
  decisions: PuzzleDecisionRecord[];
}

/** The proposals the client may send before a move (mirrors the server's PuzzleProposal). */
export type PuzzleProposal =
  | { kind: 'attack'; from: string; to: string }
  | { kind: 'draft'; to: string; split?: string }
  | { kind: 'fortify'; from: string; to: string; units: number }
  | { kind: 'end_attack' }
  | { kind: 'end_turn' };

export const GRADE_LABELS: Record<PuzzleGrade, string> = {
  best: 'Best',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  blunder: 'Blunder',
};

export const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** "an 84% line", "a 55% line" — the article English actually takes. */
export function percentArticle(fraction: number): string {
  const n = Math.round(fraction * 100);
  return n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a';
}

/** A stored action in the player's words, with territory names from `nameOf`. */
export function describeStoredAction(a: StoredPuzzleAction | null | undefined, nameOf: (id: string) => string): string {
  if (!a) return '—';
  switch (a.kind) {
    case 'draft':
      return a.split ? `Draft half onto ${nameOf(a.to)} and half onto ${nameOf(a.split)}` : `Draft everything onto ${nameOf(a.to)}`;
    case 'assault':
      return a.keep > 1
        ? `Attack ${nameOf(a.to)} from ${nameOf(a.from)}, stopping with ${a.keep} left`
        : `Attack ${nameOf(a.to)} from ${nameOf(a.from)}`;
    case 'fortify':
      return a.units === 'half'
        ? `Move half of ${nameOf(a.from)} into ${nameOf(a.to)}`
        : `Move all but one from ${nameOf(a.from)} into ${nameOf(a.to)}`;
    case 'end_attack':
      return 'Stop attacking';
    case 'end_turn':
      return 'End the turn';
  }
}

/** The proposal in the player's words — the question on the verdict card. */
export function describeProposal(p: PuzzleProposal, nameOf: (id: string) => string): string {
  switch (p.kind) {
    case 'attack': return `Attack ${nameOf(p.to)} from ${nameOf(p.from)} now?`;
    case 'draft': return p.split ? `Draft onto ${nameOf(p.to)} and ${nameOf(p.split)}?` : `Draft everything onto ${nameOf(p.to)}?`;
    case 'fortify': return `Move ${p.units} ${p.units === 1 ? 'unit' : 'units'} from ${nameOf(p.from)} into ${nameOf(p.to)}?`;
    case 'end_attack': return 'Stop attacking?';
    case 'end_turn': return 'End the turn here?';
  }
}

/**
 * The confirm button's words for a held move.
 *
 * Only an attack rolls dice, so "Roll anyway" on a fortify or an end-of-phase
 * read as a different move entirely. "Anyway" is for a move the board just
 * argued against; the best move is simply confirmed.
 */
export function commitLabel(p: PuzzleProposal, grade: PuzzleGrade = 'best'): string {
  const defiant = grade !== 'best';
  switch (p.kind) {
    case 'attack': return defiant ? 'Roll anyway' : 'Roll';
    case 'draft': return defiant ? 'Place anyway' : 'Place them';
    case 'fortify': return defiant ? 'Move anyway' : 'Move them';
    case 'end_attack': return defiant ? 'Stop anyway' : 'Stop attacking';
    case 'end_turn': return defiant ? 'End turn anyway' : 'End the turn';
  }
}

export interface VerdictCopy {
  /** "You win this 55% of the time. There's an 84% line." */
  body: string;
  /** "Blunder · gives up 29 points" */
  tag: string;
  /** What a takeback costs, now. */
  takebackNote: string;
}

export function verdictCopy(v: PuzzleVerdict): VerdictCopy {
  const equity = v.equity ?? 0;
  const best = v.best_equity ?? equity;
  const loss = v.loss ?? 0;
  const grade = v.grade ?? 'best';
  const body = grade === 'best'
    ? `You win this ${pct(equity)} of the time. Nothing beats it.`
    : `You win this ${pct(equity)} of the time. There's ${percentArticle(best)} ${pct(best)} line.`;
  const tag = grade === 'best' ? 'Best move' : `${GRADE_LABELS[grade]} · gives up ${Math.round(loss)} ${Math.round(loss) === 1 ? 'point' : 'points'}`;
  const takebacks = v.takebacks ?? 0;
  const takebackNote = takebacks === 0
    ? 'Take it back and the streak survives, but the star is gone.'
    : takebacks === 1
      ? "Take it back again and you'll see the best move, but this one scores zero."
      : "Best move's on the table. This one scores zero.";
  return { body, tag, takebackNote };
}

export interface ShareLineInput {
  /** YYYY-MM-DD */
  date: string;
  accuracy: number;
  star: boolean;
  crown: boolean;
  won: boolean;
  /** Decisions graded best, and decisions graded in all. */
  bestCount: number;
  decisionCount: number;
  /** The link the line carries, e.g. https://borderfall.gg/daily. */
  url: string;
}

/**
 * "Borderfall Daily 2026-09-21 · 👑 100% · 2/2 best · 🎲 won   https://…/daily"
 * The crown outranks the star; a run with neither shows the accuracy alone.
 */
export function buildShareLine(input: ShareLineInput): string {
  const badge = input.crown ? '👑 ' : input.star ? '★ ' : '';
  const acc = `${badge}${Math.round(input.accuracy)}%`;
  const best = `${input.bestCount}/${input.decisionCount} best`;
  const dice = input.won ? '🎲 won' : '🎲 lost';
  return `Borderfall Daily ${input.date} · ${acc} · ${best} · ${dice}   ${input.url}`;
}

/** Decisions graded best on the first attempt. */
export function countBest(decisions: PuzzleDecisionRecord[]): number {
  return decisions.filter((d) => d.grade === 'best').length;
}

/** What the day asks of the player, for the intro and the daily card. */
export function decisionsLine(v2: PublicDailyPuzzleV2): string {
  const n = v2.decisions || v2.decisions_target;
  const count = `${n} ${n === 1 ? 'decision' : 'decisions'} to get right`;
  return v2.verdicts === 'silent'
    ? `${count} · no verdicts until the end`
    : `${count} · the board answers before you roll`;
}

/** The review panel's display-ready reading of a run (names resolved, share line built). */
export interface PuzzleReviewView {
  accuracy: number;
  score: number;
  star: boolean;
  crown: boolean;
  won: boolean;
  theme: string | null;
  first_try: boolean;
  attempts: number;
  decisions: Array<{
    turn: number;
    phase: 'draft' | 'attack' | 'fortify';
    chosen: string;
    best: string;
    loss: number;
    grade: PuzzleGrade;
    takebacks: number;
  }>;
  shareLine: string;
}

/** Resolve a review into words for the panel and the share line. */
export function describePuzzleReview(
  review: PuzzleReview,
  nameOf: (id: string) => string,
  date: string,
  url: string,
): PuzzleReviewView {
  return {
    accuracy: review.accuracy,
    score: review.score,
    star: review.star,
    crown: review.crown,
    won: review.won,
    theme: review.theme,
    first_try: review.first_try,
    attempts: review.attempts,
    decisions: review.decisions.map((d) => ({
      turn: d.turn,
      phase: d.phase,
      chosen: describeStoredAction(d.chosen ?? d.first, nameOf),
      best: describeStoredAction(d.best, nameOf),
      loss: d.loss,
      grade: d.grade,
      takebacks: d.takebacks,
    })),
    shareLine: buildShareLine({
      date,
      accuracy: review.accuracy,
      star: review.star,
      crown: review.crown,
      won: review.won,
      bestCount: countBest(review.decisions),
      decisionCount: review.decisions.length,
      url,
    }),
  };
}
