import type { PlayerState } from '../../types';

/**
 * Era signature payoffs — the one-shot reward granted on arriving in an era,
 * dispatched by the `signature_id` declared on the game's spine step (same
 * idiom as faction `ability_id`s). The PoC ships a single signature; later
 * eras add theirs here without touching the advancement flow.
 */
export interface EraSignatureDefinition {
  signature_id: string;
  name: string;
  description: string;
  /** Bonus attack dice granted while a charge is held; one charge burns per attack. */
  attack_die_bonus?: number;
}

export const ERA_SIGNATURES: Record<string, EraSignatureDefinition> = {
  levy_of_knights: {
    signature_id: 'levy_of_knights',
    name: 'Levy of Knights',
    description: '+1 attack die on your next attack.',
    attack_die_bonus: 1,
  },
};

/** Grant one charge of an era signature to the arriving player. */
export function grantEraSignature(player: PlayerState, signatureId: string): void {
  if (!ERA_SIGNATURES[signatureId]) return;
  player.era_signature_charges = player.era_signature_charges ?? {};
  player.era_signature_charges[signatureId] = (player.era_signature_charges[signatureId] ?? 0) + 1;
}

/**
 * Consume at most one held attack-die signature charge for a committed land
 * attack and return the bonus dice it grants (0 when none held). Mirrors the
 * legacy medieval behavior: one charge per attack.
 */
export function consumeSignatureAttackBonus(player: PlayerState): number {
  const charges = player.era_signature_charges;
  if (!charges) return 0;
  for (const [signatureId, count] of Object.entries(charges)) {
    if (count <= 0) continue;
    const bonus = ERA_SIGNATURES[signatureId]?.attack_die_bonus;
    if (!bonus) continue;
    charges[signatureId] = count - 1;
    return bonus;
  }
  return 0;
}
