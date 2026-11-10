/**
 * Coach tips (`coach_tips_enabled`): a one-line strip that says the next thing
 * to do, offered once in the first match's briefing and retiring step by step.
 *
 * The coach it replaces was a card over the board: on a phone it covered the
 * territories it asked the player to tap, it showed only on turn 1, only on the
 * globe and only at 0 XP (so never to anyone who had played the tutorial), and
 * after the units were placed it still read "You have 0 units to place". The
 * strip is offered, not imposed: the briefing asks "with tips, or I know this
 * kind of game", and the answer is kept. Each step retires once the player has
 * done it, so it teaches only what they have not done yet; "Hide tips" turns
 * them off for good.
 */

export type CoachTipsChoice = 'on' | 'off';

export type CoachTipId =
  | 'select_territory'
  | 'place'
  | 'begin_attack'
  | 'attack'
  | 'end_attack'
  | 'fortify';

export const COACH_TIP_IDS: readonly CoachTipId[] = [
  'select_territory',
  'place',
  'begin_attack',
  'attack',
  'end_attack',
  'fortify',
];

/** What the strip reads from the game. */
export interface CoachTipView {
  phase: string;
  myTurn: boolean;
  /** Units the player still has to place this turn. */
  draftPool: number;
  /** A territory of the player's own is open in the sheet. */
  ownTerritorySelected: boolean;
  /** The player attacked at least once this turn (server `attacked_this_turn`). */
  attackedThisTurn: boolean;
}

export interface CoachTip {
  id: CoachTipId;
  text: string;
}

const units = (n: number) => `${n} ${n === 1 ? 'unit' : 'units'}`;

/** The step to show now, or null when there is none (not the player's turn, or every step for this moment retired). */
export function coachTipFor(view: CoachTipView, done: ReadonlySet<CoachTipId>): CoachTip | null {
  if (!view.myTurn) return null;
  const pick = (id: CoachTipId, text: string): CoachTip | null => (done.has(id) ? null : { id, text });
  switch (view.phase) {
    case 'draft':
      if (view.draftPool > 0) {
        return view.ownTerritorySelected
          ? pick('place', `Press Place. Putting all ${units(view.draftPool)} on one border makes a stack that can attack.`)
          : pick('select_territory', `Tap one of your territories to place your ${units(view.draftPool)}.`);
      }
      return pick('begin_attack', 'All placed. Now press Begin Attack →');
    case 'attack':
      return view.attackedThisTurn
        ? pick('end_attack', 'Keep attacking while you have more units than them, or press Begin Fortify →')
        : pick('attack', 'Tap your biggest stack, then tap a neighbour with fewer units to attack it.');
    case 'fortify':
      return pick('fortify', 'Move units up to a border if you like, then press End Turn →');
    default:
      return null;
  }
}

/**
 * The steps the player just did, read from one view to the next. Placing
 * units retires both placement steps; leaving a phase by its button retires
 * that phase's "now press" step; an attack retires the attack step.
 */
export function coachTipsDoneBetween(prev: CoachTipView | null, next: CoachTipView): CoachTipId[] {
  if (!prev) return [];
  const out: CoachTipId[] = [];
  const stillMine = prev.myTurn && next.myTurn;
  if (stillMine && prev.phase === 'draft' && next.phase === 'draft' && next.draftPool < prev.draftPool) {
    out.push('select_territory', 'place');
  }
  if (stillMine && prev.phase === 'draft' && next.phase === 'attack') out.push('begin_attack');
  if (next.myTurn && next.phase === 'attack' && next.attackedThisTurn && !prev.attackedThisTurn) out.push('attack');
  if (stillMine && prev.phase === 'attack' && next.phase === 'fortify') out.push('end_attack');
  if (prev.myTurn && prev.phase === 'fortify' && !next.myTurn) out.push('fortify');
  return out;
}

const CHOICE_KEY = 'cc-coach-tips';
const DONE_KEY = 'cc-coach-tips-done';

export function readCoachTipsChoice(): CoachTipsChoice | null {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function writeCoachTipsChoice(choice: CoachTipsChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    /* storage unavailable: the choice lasts this page only */
  }
}

/** Retired steps, sanitised on load: unknown ids are dropped. */
export function readCoachTipsDone(): Set<CoachTipId> {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((id): id is CoachTipId => COACH_TIP_IDS.includes(id as CoachTipId)));
  } catch {
    return new Set();
  }
}

export function writeCoachTipsDone(done: ReadonlySet<CoachTipId>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* storage unavailable: retired steps last this page only */
  }
}

/**
 * The first match's phase button (`first_match_button_emphasis_enabled`): plain
 * until the phase's own action is done, then gold. The gold button was always
 * the one that left the phase, so a player who only ever pressed it placed
 * nothing by hand and never attacked, and lost every simulated first match.
 * Fortify keeps its gold End Turn: fortifying is optional.
 */
export function phaseButtonQuiet(input: {
  enabled: boolean;
  firstMatch: boolean;
  phase: string;
  draftPool: number;
  attackedThisTurn: boolean;
}): boolean {
  if (!input.enabled || !input.firstMatch) return false;
  if (input.phase === 'draft') return input.draftPool > 0;
  if (input.phase === 'attack') return !input.attackedThisTurn;
  return false;
}
