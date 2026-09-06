import { describe, it, expect } from 'vitest';
import type { AdvanceEraClientPreview, GameState, PlayerState } from '../store/gameStore';
import {
  getAdvanceEraClientStatus,
  getEraIdForAdvancementIndex,
  resolvePlayerTechEraId,
  listEraGateRows,
  countEraGateBlockers,
} from './eraAdvancement';

function basePreview(overrides: Partial<AdvanceEraClientPreview> = {}): AdvanceEraClientPreview {
  return {
    cost: 20,
    can_advance: true,
    current_era_index: 0,
    max_era_index: 1,
    current_era_id: 'ancient',
    next_era_id: 'medieval',
    stability: 72,
    stability_gate: 60,
    gate_mode: 'milestone',
    readiness: {
      met: true,
      mode: 'milestone',
      tier1: { met: true, current: 3, required: 3, label: 'tier-1 technologies' },
      tier2: { met: true, current: 1, required: 1, label: 'tier-2 technologies' },
      buildings: { met: true, current: 1, required: 1, label: 'buildings' },
    },
    ...overrides,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    era: 'ancient',
    phase: 'draft',
    era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval', signature_id: 'levy_of_knights' }],
    era_advancement_preview: basePreview(),
    settings: { era_advancement_enabled: true, tech_trees_enabled: true, stability_enabled: true },
    ...overrides,
  } as GameState;
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p1', special_resource: 100, current_era_index: 0, ...overrides } as PlayerState;
}

describe('getEraIdForAdvancementIndex / resolvePlayerTechEraId', () => {
  it('reads era ids from the broadcast spine snapshot, clamped', () => {
    const s = baseState();
    expect(getEraIdForAdvancementIndex(s, 0)).toBe('ancient');
    expect(getEraIdForAdvancementIndex(s, 1)).toBe('medieval');
    expect(getEraIdForAdvancementIndex(s, 5)).toBe('medieval');
  });

  it('falls back to the game era without a spine or when the mode is off', () => {
    const noSpine = baseState({ era_spine: undefined });
    expect(getEraIdForAdvancementIndex(noSpine, 1)).toBe('ancient');
    const off = baseState({ settings: { era_advancement_enabled: false } } as Partial<GameState>);
    expect(resolvePlayerTechEraId(off, player({ current_era_index: 1 }))).toBe('ancient');
  });

  it('resolves a player tech era from their index', () => {
    expect(resolvePlayerTechEraId(baseState(), player({ current_era_index: 1 }))).toBe('medieval');
  });
});

describe('getAdvanceEraClientStatus', () => {
  it('returns null without a player, with the mode off, or before a preview arrives', () => {
    expect(getAdvanceEraClientStatus(baseState(), null)).toBeNull();
    const off = baseState({ settings: { era_advancement_enabled: false } } as Partial<GameState>);
    expect(getAdvanceEraClientStatus(off, player())).toBeNull();
    expect(getAdvanceEraClientStatus(baseState({ era_advancement_preview: undefined }), player())).toBeNull();
  });

  it('maps a ready server preview to a ready status', () => {
    const status = getAdvanceEraClientStatus(baseState(), player());
    expect(status).toMatchObject({
      ready: true,
      blockers: [],
      cost: 20,
      gold: 100,
      goldMet: true,
      techMet: true,
      stabilityMet: true,
      atMaxEra: false,
      currentEraId: 'ancient',
      nextEraId: 'medieval',
    });
  });

  it('builds milestone blockers from server readiness counts', () => {
    const s = baseState({
      era_advancement_preview: basePreview({
        can_advance: false,
        readiness: {
          met: false,
          mode: 'milestone',
          tier1: { met: false, current: 1, required: 3, label: 'tier-1 technologies' },
          tier2: { met: true, current: 1, required: 1, label: 'tier-2 technologies' },
          buildings: { met: false, current: 0, required: 1, label: 'buildings' },
        },
      }),
    });
    const status = getAdvanceEraClientStatus(s, player());
    expect(status?.ready).toBe(false);
    expect(status?.blockers).toEqual([
      'Research 3 tier-1 technologies (1/3)',
      'Build at least 1 building (0/1)',
    ]);
  });

  it('builds percent-mode and stability/gold blockers', () => {
    const s = baseState({
      era_advancement_preview: basePreview({
        can_advance: false,
        stability: 41,
        gate_mode: 'percent',
        readiness: { met: false, mode: 'percent', percent: { unlocked: 2, required: 4 } },
      }),
    });
    const status = getAdvanceEraClientStatus(s, player({ special_resource: 5 }));
    expect(status?.blockers).toEqual([
      'Research 4 technologies (2/4)',
      'Empire stability 41% (need 60%)',
      'Need 20 gold (have 5)',
    ]);
  });

  it('locks a zero-cost advance behind pending income, matching legacy behavior', () => {
    const s = baseState({ era_advancement_preview: basePreview({ cost: 0 }) });
    const status = getAdvanceEraClientStatus(s, player());
    expect(status?.ready).toBe(false);
    expect(status?.goldMet).toBe(false);
    expect(status?.blockers).toContain('Wait for production income on your next turn');
  });

  it('flags phase and max-era blockers client-side', () => {
    const fortify = baseState({ phase: 'fortify' } as Partial<GameState>);
    expect(getAdvanceEraClientStatus(fortify, player())?.blockers)
      .toContain('Available during Reinforcement or Attack phase');

    const maxed = baseState({
      era_advancement_preview: basePreview({ current_era_index: 1, current_era_id: 'medieval', next_era_id: 'medieval' }),
    });
    const status = getAdvanceEraClientStatus(maxed, player({ current_era_index: 1 }));
    expect(status?.atMaxEra).toBe(true);
    expect(status?.blockers).toContain('Already at maximum era');
  });

  it('surfaces the tier-3 gate row and blocker when the step requires it', () => {
    const s = baseState({
      era_advancement_preview: basePreview({
        can_advance: false,
        readiness: {
          met: false,
          mode: 'milestone',
          tier1: { met: true, current: 3, required: 3, label: 'tier-1 technologies' },
          tier2: { met: true, current: 2, required: 2, label: 'tier-2 technologies' },
          tier3: { met: false, current: 0, required: 1, label: 'tier-3 technologies' },
          buildings: { met: true, current: 2, required: 2, label: 'buildings' },
        },
      }),
    });
    const status = getAdvanceEraClientStatus(s, player());
    expect(status?.tier3Required).toBe(1);
    expect(status?.tier3Met).toBe(false);
    expect(status?.blockers).toContain('Research at least 1 tier-3 technology (0/1)');
  });

  it('passes catch-up gap and discount through for the badge', () => {
    const s = baseState({
      era_advancement_preview: basePreview({ cost: 12, catchup_gap: 2, catchup_discount_pct: 28 }),
    });
    const status = getAdvanceEraClientStatus(s, player());
    expect(status?.catchupGap).toBe(2);
    expect(status?.catchupDiscountPct).toBe(28);
    expect(status?.ready).toBe(true);
  });

  it('passes the next-era signature name and description through', () => {
    const s = baseState({
      era_advancement_preview: basePreview({
        next_signature: { id: 'levy_of_knights', name: 'Levy of Knights', description: '+1 attack die on your next attack.' },
      }),
    });
    const status = getAdvanceEraClientStatus(s, player());
    expect(status?.nextSignatureName).toBe('Levy of Knights');
    expect(status?.nextSignatureDescription).toContain('attack die');
  });
});

describe('listEraGateRows / countEraGateBlockers', () => {
  function rowsFor(state: GameState, p = player()) {
    const status = getAdvanceEraClientStatus(state, p)!;
    return { rows: listEraGateRows(state, status), status };
  }

  it('drops requirements the gate does not have, so "0/0" is never counted', () => {
    const state = baseState({
      era_advancement_preview: basePreview({
        readiness: {
          met: true,
          mode: 'milestone',
          tier1: { met: true, current: 2, required: 2, label: 't1' },
          tier2: { met: true, current: 0, required: 0, label: 't2' },
          buildings: { met: true, current: 0, required: 0, label: 'b' },
        },
      }),
    });
    const { rows } = rowsFor(state);
    expect(rows.map((r) => r.key)).toEqual(['tier1', 'stability', 'gold']);
  });

  it('adds the phase requirement only while it blocks', () => {
    const draft = rowsFor(baseState());
    expect(draft.rows.some((r) => r.key === 'phase')).toBe(false);

    const fortify = rowsFor(baseState({ phase: 'fortify' } as Partial<GameState>));
    const phaseRow = fortify.rows.find((r) => r.key === 'phase');
    expect(phaseRow).toMatchObject({
      ok: false,
      label: 'Advance during your Reinforcement or Attack phase',
    });
  });

  it('counts the phase requirement that the chips used to omit', () => {
    // The reported bug: every visible gate satisfied, yet "1 to go".
    const state = baseState({ phase: 'fortify' } as Partial<GameState>);
    const status = getAdvanceEraClientStatus(state, player())!;
    expect(status.blockers).toHaveLength(1);
    expect(countEraGateBlockers(state, status)).toBe(1);
    // ...and now that one is a row the player can actually read.
    const unmet = listEraGateRows(state, status).filter((r) => !r.ok);
    expect(unmet.map((r) => r.key)).toEqual(['phase']);
  });

  it('never reports more outstanding items than it lists', () => {
    const cases: GameState[] = [
      baseState(),
      baseState({ phase: 'fortify' } as Partial<GameState>),
      baseState({ phase: 'attack' } as Partial<GameState>),
      baseState({
        era_advancement_preview: basePreview({
          readiness: {
            met: false,
            mode: 'milestone',
            tier1: { met: false, current: 1, required: 3, label: 't1' },
            tier2: { met: true, current: 0, required: 0, label: 't2' },
            buildings: { met: false, current: 0, required: 2, label: 'b' },
          },
        }),
      }),
      baseState({ era_advancement_preview: basePreview({ cost: 0 }) }),
      baseState({ era_advancement_preview: basePreview({ gate_mode: 'percent', readiness: { met: false, mode: 'percent', percent: { unlocked: 1, required: 4 } } }) }),
    ];
    for (const state of cases) {
      const status = getAdvanceEraClientStatus(state, player({ special_resource: 5 }))!;
      const unmet = listEraGateRows(state, status).filter((r) => !r.ok);
      expect(countEraGateBlockers(state, status)).toBe(unmet.length);
    }
  });

  it('keeps the gold row honest before any income has landed', () => {
    const state = baseState({ era_advancement_preview: basePreview({ cost: 0 }) });
    const { rows } = rowsFor(state);
    const gold = rows.find((r) => r.key === 'gold')!;
    expect(gold.ok).toBe(false);
    expect(gold.chip).toBe('Gold pending');
  });
});
