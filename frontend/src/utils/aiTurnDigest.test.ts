import { describe, it, expect } from 'vitest';
import type { AiTurnDigest } from '../store/gameStore';
import { describeAiTurnDigest, digestReportsAction } from './aiTurnDigest';

const YOU = 'you';
const names: Record<string, string> = { r1: 'Carthage', you: 'You' };
const nameOf = (id: string) => names[id] ?? id;

function digest(over: Partial<AiTurnDigest> = {}): AiTurnDigest {
  return { playerId: 'ai', turnNumber: 9, taken: [], regionsTaken: [], regionsBroken: [], eliminated: [], ...over };
}

describe('describeAiTurnDigest', () => {
  it('reports the regions taken and broken, and who was knocked out', () => {
    const line = describeAiTurnDigest(digest({
      regionsTaken: [{ regionId: 'west', name: 'The West' }],
      regionsBroken: [{ regionId: 'east', name: 'The East', fromPlayerId: 'r1' }],
      eliminated: ['r1'],
    }), YOU, nameOf);
    expect(line).toBe('Took The West · Broke Carthage’s hold on The East · Knocked out Carthage');
  });

  it('speaks to the reader about their own losses', () => {
    expect(describeAiTurnDigest(digest({
      regionsBroken: [{ regionId: 'east', name: 'The East', fromPlayerId: YOU }],
      eliminated: [YOU],
    }), YOU, nameOf)).toBe('Broke your hold on The East · Knocked you out');
    expect(describeAiTurnDigest(digest({ goal: { kind: 'hunt', target: YOU, name: 'You' } }), YOU, nameOf)).toBe('Hunting you');
  });

  it('names the goal it is playing toward', () => {
    expect(describeAiTurnDigest(digest({ goal: { kind: 'take_region', target: 'gaul', name: 'Gaul' } }), YOU, nameOf)).toBe('Pushing into Gaul');
    expect(describeAiTurnDigest(digest({ goal: { kind: 'break_region', target: 'gaul', name: 'Gaul' } }), YOU, nameOf)).toBe('Going after Gaul');
    expect(describeAiTurnDigest(digest({ goal: { kind: 'hunt', target: 'r1', name: 'Carthage' } }), YOU, nameOf)).toBe('Hunting Carthage');
  });

  it('does not repeat a goal it has just met', () => {
    expect(describeAiTurnDigest(digest({
      regionsTaken: [{ regionId: 'gaul', name: 'Gaul' }],
      goal: { kind: 'take_region', target: 'gaul', name: 'Gaul' },
    }), YOU, nameOf)).toBe('Took Gaul');
    expect(describeAiTurnDigest(digest({
      eliminated: ['r1'],
      goal: { kind: 'hunt', target: 'r1', name: 'Carthage' },
    }), YOU, nameOf)).toBe('Knocked out Carthage');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeAiTurnDigest(digest({ taken: [{ territoryId: 'a', fromPlayerId: null }] }), YOU, nameOf)).toBeNull();
  });
});

describe('digestReportsAction', () => {
  it('is true once the bot took a tile, a region or a player', () => {
    expect(digestReportsAction(digest())).toBe(false);
    expect(digestReportsAction(digest({ taken: [{ territoryId: 'a', fromPlayerId: null }] }))).toBe(true);
    expect(digestReportsAction(digest({ eliminated: ['r1'] }))).toBe(true);
  });
});
