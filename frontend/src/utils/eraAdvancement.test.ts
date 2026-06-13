import { describe, it, expect } from 'vitest';
import type { AdvanceEraClientPreview, GameState, PlayerState } from '../store/gameStore';
import {
  getAdvanceEraClientStatus,
  getEraIdForAdvancementIndex,
  resolvePlayerTechEraId,
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
});
