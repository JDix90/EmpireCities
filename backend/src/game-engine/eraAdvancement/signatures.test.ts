import { describe, it, expect } from 'vitest';
import type { PlayerState } from '../../types';
import { consumeSignatureAttackBonus, grantEraSignature } from './signatures';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return { player_id: 'p1', ...overrides } as PlayerState;
}

describe('grantEraSignature', () => {
  it('accumulates charges per signature id', () => {
    const p = player();
    grantEraSignature(p, 'levy_of_knights');
    grantEraSignature(p, 'levy_of_knights');
    expect(p.era_signature_charges?.levy_of_knights).toBe(2);
  });

  it('ignores unknown signature ids', () => {
    const p = player();
    grantEraSignature(p, 'not_a_signature');
    expect(p.era_signature_charges).toBeUndefined();
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
    const p = player({ era_signature_charges: { unknown_id: 3, levy_of_knights: 1 } });
    expect(consumeSignatureAttackBonus(p)).toBe(1);
    expect(p.era_signature_charges?.unknown_id).toBe(3);
    expect(p.era_signature_charges?.levy_of_knights).toBe(0);
  });
});
