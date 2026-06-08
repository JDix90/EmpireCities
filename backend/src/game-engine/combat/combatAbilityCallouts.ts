import type { CombatResult, GameState } from '../../types';
import { attackerIgnoresDefenseBuilding } from '../abilities/techAbilities';
import { getBuildingDefenseBonus } from '../state/economyManager';

export type CombatAbilityCalloutId =
  | 'knights_charge'
  | 'cannon_barrage'
  | 'war_elephants'
  | 'ambush'
  | 'banzai_charge'
  | 'bersaglieri_charge'
  | 'siege_assault'
  | 'gunpowder_passive'
  | 'testudo'
  | 'air_strike'
  | 'extra_attack_die';

export interface CombatAbilityCallout {
  id: CombatAbilityCalloutId;
  detail?: string;
}

const EXTRA_DIE_ABILITY_IDS: CombatAbilityCalloutId[] = [
  'knights_charge',
  'cannon_barrage',
  'war_elephants',
  'ambush',
  'banzai_charge',
  'bersaglieri_charge',
];

function resolveExtraDieCallout(abilityUses: Record<string, number> | undefined): CombatAbilityCallout {
  for (const id of EXTRA_DIE_ABILITY_IDS) {
    if (abilityUses?.[id]) return { id };
  }
  return { id: 'extra_attack_die' };
}

export function buildCombatAbilityCallouts(params: {
  state: GameState;
  attackerId: string;
  toId: string;
  attackBuffs: {
    preAttackDamage: number;
    extraAttackDie: boolean;
    ignoreDefenseBuilding: boolean;
    negateAttackerLosses: boolean;
  };
  abilityUses: Record<string, number> | undefined;
  rawAttackerLosses: number;
}): CombatAbilityCallout[] {
  const { state, attackerId, toId, attackBuffs, abilityUses, rawAttackerLosses } = params;
  const callouts: CombatAbilityCallout[] = [];

  if (attackBuffs.preAttackDamage > 0) {
    callouts.push({ id: 'air_strike' });
  }

  if (attackBuffs.extraAttackDie) {
    callouts.push(resolveExtraDieCallout(abilityUses));
  }

  if (attackBuffs.ignoreDefenseBuilding) {
    callouts.push({ id: 'siege_assault' });
  } else {
    const buildingBonus = getBuildingDefenseBonus(state, toId);
    if (buildingBonus > 0 && attackerIgnoresDefenseBuilding(state, attackerId)) {
      callouts.push({ id: 'gunpowder_passive' });
    }
  }

  if (attackBuffs.negateAttackerLosses && rawAttackerLosses > 0) {
    callouts.push({ id: 'testudo', detail: String(rawAttackerLosses) });
  }

  return callouts;
}

export function attachCombatAbilityCallouts(
  result: CombatResult,
  callouts: CombatAbilityCallout[],
): void {
  if (callouts.length > 0) {
    result.combat_ability_callouts = callouts;
  }
}
