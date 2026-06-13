import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, TerritoryState } from '../../types';
import { consumeSignatureAttackBonus, ERA_SIGNATURES, grantEraSignature } from './signatures';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p1', ...overrides } as PlayerState;
}

function terr(owner: string | null, extra: Partial<TerritoryState> = {}): TerritoryState {
  return { territory_id: 't', owner_id: owner, unit_count: 3, unit_type: 'infantry', ...extra } as TerritoryState;
}

function stateWith(p: PlayerState, territories: Record<string, TerritoryState>, settings: Partial<GameState['settings']> = {}): GameState {
  for (const [tid, t] of Object.entries(territories)) t.territory_id = tid;
  return {
    players: [p],
    territories,
    settings: { era_advancement_enabled: true, ...settings },
  } as GameState;
}

describe('grantEraSignature — charges', () => {
  it('grants the Levy of Knights attack charge', () => {
    const p = player();
    grantEraSignature(stateWith(p, {}), p, 'levy_of_knights');
    expect(p.era_signature_charges?.levy_of_knights).toBe(1);
  });

  it('ignores unknown signature ids', () => {
    const p = player();
    grantEraSignature(stateWith(p, {}), p, 'not_a_signature');
    expect(p.era_signature_charges).toBeUndefined();
  });
});

describe('grantEraSignature — age_of_sail', () => {
  it('pays a per-territory gold windfall and grants 2 attack charges', () => {
    const p = player({ special_resource: 10 });
    const state = stateWith(p, { a: terr('p1'), b: terr('p1'), c: terr('enemy') });
    grantEraSignature(state, p, 'age_of_sail');
    expect(p.special_resource).toBe(10 + 2 * 2); // 2 owned territories × 2 gold
    expect(p.era_signature_charges?.age_of_sail).toBe(2);
  });
});

describe('grantEraSignature — mobilization', () => {
  it('adds a reinforcement wave of at least 2 units across owned territories', () => {
    const p = player();
    const territories: Record<string, TerritoryState> = {};
    for (let i = 0; i < 9; i++) territories[`t${i}`] = terr('p1', { unit_count: 1 });
    const state = stateWith(p, territories);
    grantEraSignature(state, p, 'mobilization');
    const total = Object.values(state.territories).reduce((s, t) => s + t.unit_count, 0);
    expect(total).toBe(9 + 3); // floor(9/3) = 3 units added
  });

  it('grants the minimum of 2 units on a small empire', () => {
    const p = player();
    const state = stateWith(p, { a: terr('p1', { unit_count: 1 }), b: terr('p1', { unit_count: 1 }) });
    grantEraSignature(state, p, 'mobilization');
    expect(state.territories.a.unit_count + state.territories.b.unit_count).toBe(2 + 2);
  });
});

describe('grantEraSignature — intelligence_coup', () => {
  it('sabotages the strongest enemy territory when stability is enabled', () => {
    const p = player();
    const state = stateWith(
      p,
      {
        mine: terr('p1', { stability: 90 }),
        weak: terr('enemy', { stability: 40 }),
        strong: terr('enemy', { stability: 80 }),
      },
      { stability_enabled: true },
    );
    grantEraSignature(state, p, 'intelligence_coup');
    expect(state.territories.strong.stability).toBe(65); // 80 - 15
    expect(state.territories.weak.stability).toBe(40); // untouched
    expect(p.era_signature_charges).toBeUndefined(); // sabotage path, no charge
  });

  it('falls back to an attack charge when stability is disabled', () => {
    const p = player();
    const state = stateWith(p, { a: terr('p1'), b: terr('enemy', { stability: 80 }) }, { stability_enabled: false });
    grantEraSignature(state, p, 'intelligence_coup');
    expect(p.era_signature_charges?.intelligence_coup).toBe(1);
  });

  it('falls back to a charge when there is no enemy territory to sabotage', () => {
    const p = player();
    const state = stateWith(p, { a: terr('p1', { stability: 90 }) }, { stability_enabled: true });
    grantEraSignature(state, p, 'intelligence_coup');
    expect(p.era_signature_charges?.intelligence_coup).toBe(1);
  });
});

describe('grantEraSignature — precision_strike', () => {
  it('arms a pending pre-attack strike of 2 (reusing the air-strike mechanic)', () => {
    const p = player({ pending_pre_attack_damage: 1 });
    grantEraSignature(stateWith(p, {}), p, 'precision_strike');
    expect(p.pending_pre_attack_damage).toBe(3); // additive with any existing buff
  });
});

describe('grantEraSignature — orbital_window', () => {
  it('drops at least 3 reinforcements onto owned territories', () => {
    const p = player();
    const state = stateWith(p, { a: terr('p1', { unit_count: 1 }), b: terr('p1', { unit_count: 1 }) });
    grantEraSignature(state, p, 'orbital_window');
    expect(state.territories.a.unit_count + state.territories.b.unit_count).toBe(2 + 3);
  });
});

describe('grantEraSignature — idempotency boundary', () => {
  it('applies once per call (replays compound — guarded by action-id upstream)', () => {
    const p = player({ special_resource: 0 });
    const state = stateWith(p, { a: terr('p1'), b: terr('p1') });
    grantEraSignature(state, p, 'age_of_sail');
    expect(p.special_resource).toBe(4);
    grantEraSignature(state, p, 'age_of_sail');
    expect(p.special_resource).toBe(8); // second call compounds — dedupe is the caller's job
  });
});

describe('consumeSignatureAttackBonus', () => {
  it('burns one charge per attack and returns the bonus dice', () => {
    const p = player({ era_signature_charges: { levy_of_knights: 2 } });
    expect(consumeSignatureAttackBonus(p)).toBe(1);
    expect(p.era_signature_charges?.levy_of_knights).toBe(1);
    expect(consumeSignatureAttackBonus(p)).toBe(1);
    expect(consumeSignatureAttackBonus(p)).toBe(0);
  });

  it('returns 0 for players without charges', () => {
    expect(consumeSignatureAttackBonus(player())).toBe(0);
    expect(consumeSignatureAttackBonus(player({ era_signature_charges: {} }))).toBe(0);
  });

  it('skips stale charge entries for ids with no attack bonus', () => {
    const p = player({ era_signature_charges: { mobilization: 3, levy_of_knights: 1 } });
    expect(consumeSignatureAttackBonus(p)).toBe(1);
    expect(p.era_signature_charges?.mobilization).toBe(3);
    expect(p.era_signature_charges?.levy_of_knights).toBe(0);
  });
});

describe('ERA_SIGNATURES catalogue', () => {
  it('defines every signature referenced by the classic spine', () => {
    for (const id of ['levy_of_knights', 'age_of_sail', 'mobilization', 'intelligence_coup', 'precision_strike']) {
      expect(ERA_SIGNATURES[id], id).toBeDefined();
      expect(ERA_SIGNATURES[id].name.length).toBeGreaterThan(0);
      expect(ERA_SIGNATURES[id].description.length).toBeGreaterThan(0);
    }
  });
});
