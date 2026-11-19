import { describe, expect, it } from 'vitest';
import { GUIDED_STEP_IDS, guidedAttackStep, guidedCardFor, guidedDraftStep, guidedFortifyStep } from './guidedCards';
import { COMBINED_CORE_TUTORIAL_STEPS } from './modules/combinedCoreSteps';
import en from '../i18n/locales/en/tutorial.json';

const hint = { fromId: 'a', fromName: 'Tuscany & Latium', fromUnits: 9, toId: 'b', toName: 'Umbria & Abruzzo', toUnits: 2 };

describe('guidedCardFor', () => {
  it('names the three cards the core tutorial waits on a phase ending for, and no other', () => {
    for (const id of Object.values(GUIDED_STEP_IDS)) {
      expect(COMBINED_CORE_TUTORIAL_STEPS.find((s) => s.id === id)?.requireAction).toBe('end_phase');
    }
    expect(guidedCardFor('draft_do')).toBe('draft');
    expect(guidedCardFor('choose_front')).toBe('attack');
    expect(guidedCardFor('fortify_do')).toBe('fortify');
    expect(guidedCardFor('welcome')).toBeNull();
    expect(guidedCardFor(undefined)).toBeNull();
  });
});

describe('guidedDraftStep', () => {
  const at = (unitsRemaining: number, ownTerritorySelected: boolean) =>
    guidedDraftStep({ unitsRemaining, ownTerritorySelected, advanceLabel: 'Begin Attack →' });

  it('asks for a territory, then names the panel\'s controls, then the gold button', () => {
    expect(at(4, false)).toMatchObject({ stage: 'pick', number: 1, total: 3, action: 'placeForMe' });
    expect(at(4, true)).toMatchObject({ stage: 'place', number: 2, action: 'placeForMe' });
    // Some placed, some left, and the panel closed again: back to picking.
    expect(at(1, false).stage).toBe('pick');
    // Nothing left to place: the gold button, whatever is selected, and nothing to place for them.
    expect(at(0, true)).toMatchObject({ stage: 'advance', number: 3, action: null, vars: { button: 'Begin Attack →' } });
    expect(at(0, false).stage).toBe('advance');
  });
});

describe('guidedAttackStep', () => {
  const at = (over: Partial<Parameters<typeof guidedAttackStep>[0]> = {}) =>
    guidedAttackStep({ hint, open: null, attackedThisTurn: false, advanceLabel: 'Begin Fortify →', ...over });

  it('names one attack: its source, then its target', () => {
    expect(at()).toMatchObject({ stage: 'source', number: 1, total: 3, action: 'showMe', vars: { from: 'Tuscany & Latium', to: 'Umbria & Abruzzo' } });
    expect(at({ open: 'from' })).toMatchObject({ stage: 'target', number: 2, action: null });
    // Opened the target first: the panel offers "Attack from", so the card says to press it.
    expect(at({ open: 'to' })).toMatchObject({ stage: 'confirm', number: 2, action: null });
  });

  it('once an attack is made, says they can go again or move on', () => {
    expect(at({ attackedThisTurn: true })).toMatchObject({ stage: 'advance', number: 3, vars: { button: 'Begin Fortify →' }, action: null });
    // Even with nothing left worth suggesting.
    expect(at({ attackedThisTurn: true, hint: null })?.stage).toBe('advance');
  });

  it('leaves the long card standing when there is no attack to name', () => {
    expect(at({ hint: null })).toBeNull();
  });
});

describe('guidedFortifyStep', () => {
  it('says fortifying is optional and offers to end the turn, then points at the gold button', () => {
    expect(guidedFortifyStep({ movesUsed: 0, advanceLabel: 'End Turn' })).toMatchObject({ stage: 'choose', number: 1, total: 2, action: 'endTurn' });
    expect(guidedFortifyStep({ movesUsed: 1, advanceLabel: 'End Turn' })).toMatchObject({ stage: 'advance', number: 2, action: null });
  });
});

describe('the guided cards\' copy', () => {
  const guided = (en as { overlay: { guided: Record<string, unknown> } }).overlay.guided as Record<string, Record<string, string> | string>;

  it('has a line for every stage a card can be on, and a label for every button', () => {
    const stages: Record<string, string[]> = {
      draft: ['pick', 'place', 'advance'],
      attack: ['source', 'target', 'confirm', 'advance'],
      fortify: ['choose', 'advance'],
    };
    for (const [card, keys] of Object.entries(stages)) {
      for (const key of keys) expect({ card, key, line: typeof (guided[card] as Record<string, string>)[key] }).toEqual({ card, key, line: 'string' });
    }
    for (const action of ['placeForMe', 'showMe', 'endTurn']) {
      expect(typeof (guided.actions as Record<string, string>)[action]).toBe('string');
    }
  });

  it('keeps every line to one short sentence or two', () => {
    for (const card of ['draft', 'attack', 'fortify']) {
      for (const line of Object.values(guided[card] as Record<string, string>)) expect(line.length).toBeLessThanOrEqual(110);
    }
  });
});
