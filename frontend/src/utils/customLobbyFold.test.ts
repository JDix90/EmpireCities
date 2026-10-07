import { describe, it, expect, beforeEach } from 'vitest';
import {
  advancedSummary,
  loadAdvancedOpen,
  saveAdvancedOpen,
  type CustomLobbyAdvancedChoices,
} from './customLobbyFold';

const NONE: CustomLobbyAdvancedChoices = {
  customPairing: false,
  territoryDraft: false,
  factions: false,
  economy: false,
  techTrees: false,
  events: false,
  naval: false,
  stability: false,
  fogOfWar: false,
  diplomacy: false,
  coaching: false,
  eraAdvancement: false,
  uncappedCardSets: false,
  diceCapApplies: false,
  diceCap: true,
  maxAttackerDice: 5,
  maxDefenderDice: 4,
};

describe('what the closed Advanced fold says is on', () => {
  it('says nothing for a game as a new one starts', () => {
    expect(advancedSummary(NONE)).toEqual([]);
    // The dice cap at its defaults is how a game with dice bonuses starts.
    expect(advancedSummary({ ...NONE, economy: true, diceCapApplies: true })).toEqual(['Economy & Buildings']);
  });

  it('names every option that is on, in the order the form lists them', () => {
    const all = {
      ...NONE,
      customPairing: true, territoryDraft: true, factions: true, economy: true, techTrees: true, events: true,
      naval: true, stability: true, fogOfWar: true, diplomacy: true, coaching: true, eraAdvancement: true,
      uncappedCardSets: true,
    };
    expect(advancedSummary(all)).toEqual([
      'Map pairing', 'Territory Draft', 'Asymmetric Factions', 'Economy & Buildings', 'Technology Trees',
      'Historical Events', 'Naval Warfare', 'Population & Stability', 'Fog of War', 'Diplomacy',
      'In-Turn Coaching', 'Era Advancement', 'Uncapped card sets',
    ]);
  });

  it('names a dice cap switched off or changed, only where the cap applies', () => {
    expect(advancedSummary({ ...NONE, diceCapApplies: true, diceCap: false })).toEqual(['No dice cap']);
    expect(advancedSummary({ ...NONE, diceCapApplies: true, maxDefenderDice: 3 })).toEqual(['Dice cap 5/3']);
    expect(advancedSummary({ ...NONE, diceCapApplies: false, diceCap: false })).toEqual([]);
  });
});

describe('whether the fold was left open', () => {
  beforeEach(() => localStorage.clear());

  it('starts closed, and remembers open and closed', () => {
    expect(loadAdvancedOpen()).toBe(false);
    saveAdvancedOpen(true);
    expect(loadAdvancedOpen()).toBe(true);
    saveAdvancedOpen(false);
    expect(loadAdvancedOpen()).toBe(false);
  });

  it('reads anything but a saved "open" as closed', () => {
    for (const stored of ['true', 'yes', '{}', ' 1', '2']) {
      localStorage.setItem('cc-custom-advanced-open', stored);
      expect({ stored, open: loadAdvancedOpen() }).toEqual({ stored, open: false });
    }
  });
});
