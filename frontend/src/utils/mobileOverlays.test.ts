import { describe, it, expect } from 'vitest';
import type { CombatResult } from '../store/gameStore';
import type { MapVisualEvent } from './mapVisualEvents';
import type { TurnRecapEntry } from '../components/game/AiTurnRecapPanel';
import { MAX_RECAP_ROUNDS, combatInvolves, keepsMapVisualOnPhone, lostTerritoryIds, pickStripSlot, pushRecapRound, summarizeRecapsForViewer } from './mobileOverlays';

const ME = 'me';
const AI = 'ai_1';
const OTHER_AI = 'ai_2';

function combat(over: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6, 5],
    defender_rolls: [3],
    attacker_losses: 0,
    defender_losses: 1,
    territory_captured: false,
    attackerId: AI,
    defenderId: ME,
    fromId: 'kushan',
    toId: 'persia',
    fromName: 'Kushan Empire',
    toName: 'Persia',
    ...over,
  } as CombatResult;
}

function recap(playerName: string, combats: CombatResult[], turnNumber = 4): TurnRecapEntry {
  return { playerName, playerColor: '#0f0', turnNumber, combats };
}

function visual(over: Partial<MapVisualEvent>): MapVisualEvent {
  return { id: 'v1', kind: 'combat', territoryId: 'persia', playerId: AI, ...over };
}

describe('combatInvolves', () => {
  it('is true for the viewer on either side and false otherwise', () => {
    expect(combatInvolves(combat(), ME)).toBe(true);
    expect(combatInvolves(combat({ attackerId: ME, defenderId: AI }), ME)).toBe(true);
    // The reported screenshot: an AI-vs-AI fight narrated on the player's own turn.
    expect(combatInvolves(combat({ attackerId: AI, defenderId: OTHER_AI }), ME)).toBe(false);
    expect(combatInvolves(combat(), null)).toBe(false);
    expect(combatInvolves(null, ME)).toBe(false);
  });
});

describe('keepsMapVisualOnPhone', () => {
  it("plays the viewer's own moves and drops other players'", () => {
    expect(keepsMapVisualOnPhone(visual({ playerId: ME }), ME)).toBe(true);
    for (const kind of ['combat', 'capture', 'reinforce', 'fortify', 'strike', 'naval', 'influence'] as const) {
      expect(keepsMapVisualOnPhone(visual({ kind, playerId: AI }), ME), kind).toBe(false);
    }
  });

  it('always plays board-level visuals, whoever moved', () => {
    for (const kind of ['era_advance', 'frontier_unlock', 'board_transform', 'event'] as const) {
      expect(keepsMapVisualOnPhone(visual({ kind, playerId: AI }), ME), kind).toBe(true);
    }
    expect(keepsMapVisualOnPhone(visual({ kind: 'event', playerId: undefined, global: true }), ME)).toBe(true);
  });

  it('plays nothing player-scoped for a spectator', () => {
    expect(keepsMapVisualOnPhone(visual({ playerId: AI }), null)).toBe(false);
    expect(keepsMapVisualOnPhone(visual({ kind: 'era_advance' }), null)).toBe(true);
  });
});

describe('summarizeRecapsForViewer', () => {
  const recaps = [
    recap('Admiral Chen', [
      combat({ attackerId: AI, defenderId: OTHER_AI, toId: 'china', toName: 'Central China', territory_captured: true }),
      combat(),
      combat({ territory_captured: true }),
    ]),
    recap('Marshal Okonkwo', [
      combat({ attackerId: OTHER_AI, toId: 'hispania', toName: 'Hispania', territory_captured: true }),
      // Persia changes hands again between the AIs: not a second loss for the viewer.
      combat({ attackerId: OTHER_AI, defenderId: AI, toId: 'persia', territory_captured: true }),
    ], 5),
  ];

  it('counts the field and names each loss once, in order', () => {
    expect(summarizeRecapsForViewer(recaps, ME)).toEqual({
      turns: 2,
      battles: 5,
      captures: 4,
      attacksOnViewer: 3,
      lost: [
        { id: 'persia', name: 'Persia' },
        { id: 'hispania', name: 'Hispania' },
      ],
    });
    expect(lostTerritoryIds(recaps, ME)).toEqual(['persia', 'hispania']);
  });

  it('records no losses for a spectator, and none when the viewer held', () => {
    expect(summarizeRecapsForViewer(recaps, null).lost).toEqual([]);
    expect(summarizeRecapsForViewer([recap('Admiral Chen', [combat()])], ME)).toMatchObject({
      attacksOnViewer: 1,
      lost: [],
    });
  });

  it('falls back to the name when an older server sent no territory id', () => {
    const noIds = [recap('Admiral Chen', [combat({ toId: undefined, territory_captured: true })])];
    expect(summarizeRecapsForViewer(noIds, ME).lost).toEqual([{ id: null, name: 'Persia' }]);
    expect(lostTerritoryIds(noIds, ME)).toEqual([]);
  });
});

describe('pickStripSlot', () => {
  const quiet = { live: false, notice: false, recaps: true, isMyTurn: true, acted: false };

  it('shows a fresh battle against the viewer before anything else', () => {
    expect(pickStripSlot({ ...quiet, live: true, notice: true })).toBe('live');
  });

  it("shows the viewer's own move feedback ahead of the recap, even once they have acted", () => {
    expect(pickStripSlot({ ...quiet, notice: true })).toBe('notice');
    expect(pickStripSlot({ ...quiet, notice: true, acted: true })).toBe('notice');
    expect(pickStripSlot({ ...quiet, notice: true, recaps: false })).toBe('notice');
  });

  it('falls back to the recap line before the first move and the pill after it', () => {
    expect(pickStripSlot(quiet)).toBe('recap');
    expect(pickStripSlot({ ...quiet, acted: true })).toBe('pill');
    // Watching: the running count, however far the viewer got last turn.
    expect(pickStripSlot({ ...quiet, isMyTurn: false, acted: true })).toBe('recap');
  });

  it('shows nothing with nothing to say', () => {
    expect(pickStripSlot({ ...quiet, recaps: false })).toBe('none');
  });

  it('keeps the pill alone when only history is left to scrub', () => {
    expect(pickStripSlot({ ...quiet, recaps: false, history: true })).toBe('pill');
    expect(pickStripSlot({ ...quiet, recaps: false, history: true, isMyTurn: false })).toBe('pill');
    // Current recaps still win the line before the first move.
    expect(pickStripSlot({ ...quiet, history: true })).toBe('recap');
  });
});

describe('pushRecapRound', () => {
  const round = (turnNumber: number) => ({ turnNumber, entries: [recap('Admiral Chen', [combat()], turnNumber)] });

  it('appends newest last and skips a round with no battles', () => {
    let h = pushRecapRound([], round(3));
    h = pushRecapRound(h, { turnNumber: 4, entries: [] });
    h = pushRecapRound(h, round(5));
    expect(h.map((r) => r.turnNumber)).toEqual([3, 5]);
  });

  it('rolls the oldest off past the cap', () => {
    let h: ReturnType<typeof pushRecapRound> = [];
    for (let t = 1; t <= MAX_RECAP_ROUNDS + 3; t++) h = pushRecapRound(h, round(t));
    expect(h).toHaveLength(MAX_RECAP_ROUNDS);
    expect(h[0].turnNumber).toBe(4);
    expect(h[h.length - 1].turnNumber).toBe(MAX_RECAP_ROUNDS + 3);
  });
});
