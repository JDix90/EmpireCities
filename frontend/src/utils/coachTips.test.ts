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
});

describe('coachTipsDoneBetween', () => {
  it('retires placement when units go down by hand, and each phase\'s step when it is left', () => {
    expect(coachTipsDoneBetween(view(), view({ draftPool: 2 }))).toEqual(['select_territory', 'place']);
    expect(coachTipsDoneBetween(view({ draftPool: 0 }), view({ phase: 'attack', draftPool: 0 }))).toEqual(['begin_attack']);
    expect(coachTipsDoneBetween(view({ phase: 'attack' }), view({ phase: 'attack', attackedThisTurn: true }))).toEqual(['attack']);
    expect(coachTipsDoneBetween(view({ phase: 'attack', attackedThisTurn: true }), view({ phase: 'fortify' }))).toEqual(['end_attack']);
    expect(coachTipsDoneBetween(view({ phase: 'fortify' }), view({ phase: 'draft', myTurn: false }))).toEqual(['fortify']);
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
