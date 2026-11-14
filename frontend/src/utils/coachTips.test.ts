import { describe, it, expect, beforeEach } from 'vitest';
import {
  coachTipFor,
  coachTipsDoneBetween,
  phaseButtonQuiet,
  readCoachTipsChoice,
  readCoachTipsDone,
  writeCoachTipsChoice,
  writeCoachTipsDone,
  type CoachTipId,
  type CoachTipView,
} from './coachTips';

const view = (over: Partial<CoachTipView> = {}): CoachTipView => ({
  phase: 'draft', myTurn: true, draftPool: 4, ownTerritorySelected: false, attackedThisTurn: false, ...over,
});
const none = new Set<CoachTipId>();

describe('coachTipFor', () => {
  it('walks a first turn one step at a time', () => {
    expect(coachTipFor(view(), none)?.text).toBe('Tap one of your territories to place your 4 units.');
    expect(coachTipFor(view({ ownTerritorySelected: true }), none)?.id).toBe('place');
    expect(coachTipFor(view({ draftPool: 0 }), none)?.text).toBe('All placed. Now press Begin Attack →');
    expect(coachTipFor(view({ phase: 'attack' }), none)?.id).toBe('attack');
    expect(coachTipFor(view({ phase: 'attack', attackedThisTurn: true }), none)?.id).toBe('end_attack');
    expect(coachTipFor(view({ phase: 'fortify' }), none)?.id).toBe('fortify');
  });

  it('never says "0 units", and says nothing on someone else\'s turn', () => {
    expect(coachTipFor(view({ draftPool: 0 }), none)?.text).not.toMatch(/\b0 units\b/);
    expect(coachTipFor(view({ myTurn: false }), none)).toBeNull();
  });

  it('skips a step the player has already done', () => {
    expect(coachTipFor(view({ phase: 'attack' }), new Set<CoachTipId>(['attack']))).toBeNull();
  });

  it('names the suggested first attack in the attack step (first_attack_hint_enabled), and only there', () => {
    const hint = { fromId: 'strathclyde', fromName: 'Strathclyde', fromUnits: 6, toId: 'jorvik', toName: 'Jórvík', toUnits: 3 };
    const tip = coachTipFor(view({ phase: 'attack', firstAttack: { hint, open: null } }), none);
    expect(tip).toEqual({ id: 'first_attack', text: 'Attack Jórvík from Strathclyde: your 6 against their 3. Tap Strathclyde.' });
    expect(coachTipFor(view({ phase: 'attack', firstAttack: { hint, open: 'from' } }), none)?.text).toBe('Tap Jórvík in the panel to attack it.');
    // An attack in the tutorial retired the generic step; the suggestion still shows.
    expect(coachTipFor(view({ phase: 'attack', firstAttack: { hint, open: null } }), new Set<CoachTipId>(['attack']))?.id).toBe('first_attack');
    // Once attacked, or with its own step retired, it goes.
    expect(coachTipFor(view({ phase: 'attack', attackedThisTurn: true, firstAttack: { hint, open: null } }), none)?.id).toBe('end_attack');
    expect(coachTipFor(view({ phase: 'attack', firstAttack: { hint, open: null } }), new Set<CoachTipId>(['attack', 'first_attack']))).toBeNull();
    // Without one, the tip is as before.
    expect(coachTipFor(view({ phase: 'attack', firstAttack: null }), none)?.text)
      .toBe('Tap your biggest stack, then tap a neighbour with fewer units to attack it.');
  });
});

describe('coachTipsDoneBetween', () => {
  it('retires placement when units go down by hand, and each phase\'s step when it is left', () => {
    expect(coachTipsDoneBetween(view(), view({ draftPool: 2 }))).toEqual(['select_territory', 'place']);
    expect(coachTipsDoneBetween(view({ draftPool: 0 }), view({ phase: 'attack', draftPool: 0 }))).toEqual(['begin_attack']);
    expect(coachTipsDoneBetween(view({ phase: 'attack' }), view({ phase: 'attack', attackedThisTurn: true }))).toEqual(['attack']);
    expect(coachTipsDoneBetween(view({ phase: 'attack', attackedThisTurn: true }), view({ phase: 'fortify' }))).toEqual(['end_attack']);
    expect(coachTipsDoneBetween(view({ phase: 'fortify' }), view({ phase: 'draft', myTurn: false }))).toEqual(['fortify']);
  });

  it('retires the suggested first attack only with an attack made while it was up', () => {
    const hint = { fromId: 'a', fromName: 'A', fromUnits: 5, toId: 'b', toName: 'B', toUnits: 2 };
    expect(coachTipsDoneBetween(
      view({ phase: 'attack', firstAttack: { hint, open: 'from' } }),
      view({ phase: 'attack', attackedThisTurn: true, firstAttack: null }),
    )).toEqual(['attack', 'first_attack']);
    // The tutorial's attack (no suggestion there) leaves it for the first match.
    expect(coachTipsDoneBetween(view({ phase: 'attack' }), view({ phase: 'attack', attackedThisTurn: true }))).toEqual(['attack']);
  });

  it('keeps first_attack when reading retired steps back', () => {
    writeCoachTipsDone(new Set<CoachTipId>(['attack', 'first_attack']));
    expect([...readCoachTipsDone()].sort()).toEqual(['attack', 'first_attack']);
  });

  it('retires nothing on the first view, or when the turn changes hands mid-draft', () => {
    expect(coachTipsDoneBetween(null, view())).toEqual([]);
    expect(coachTipsDoneBetween(view({ myTurn: false }), view({ draftPool: 3 }))).toEqual([]);
  });
});

describe('phaseButtonQuiet (first_match_button_emphasis_enabled)', () => {
  const base = { enabled: true, firstMatch: true, phase: 'draft', draftPool: 3, attackedThisTurn: false };
  it('is plain until the phase\'s action is done, in a first match only', () => {
    expect(phaseButtonQuiet(base)).toBe(true);
    expect(phaseButtonQuiet({ ...base, draftPool: 0 })).toBe(false);
    expect(phaseButtonQuiet({ ...base, phase: 'attack' })).toBe(true);
    expect(phaseButtonQuiet({ ...base, phase: 'attack', attackedThisTurn: true })).toBe(false);
    expect(phaseButtonQuiet({ ...base, phase: 'fortify' })).toBe(false);
    expect(phaseButtonQuiet({ ...base, firstMatch: false })).toBe(false);
    expect(phaseButtonQuiet({ ...base, enabled: false })).toBe(false);
  });
});

describe('stored choice and retired steps', () => {
  beforeEach(() => localStorage.clear());
  it('keeps the choice and the retired steps, and drops anything it does not know', () => {
    expect(readCoachTipsChoice()).toBeNull();
    writeCoachTipsChoice('off');
    expect(readCoachTipsChoice()).toBe('off');
    writeCoachTipsDone(new Set<CoachTipId>(['attack', 'place']));
    expect([...readCoachTipsDone()].sort()).toEqual(['attack', 'place']);
    localStorage.setItem('cc-coach-tips-done', JSON.stringify(['attack', 'dance']));
    expect([...readCoachTipsDone()]).toEqual(['attack']);
    localStorage.setItem('cc-coach-tips', 'maybe');
    expect(readCoachTipsChoice()).toBeNull();
  });
});
