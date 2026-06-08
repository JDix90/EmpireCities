import {
  playAbilityArmSound,
  playAbilityConfirmSound,
  playDoctrineArmSound,
  playReconSound,
  playStrikeImpactSound,
} from './gameSounds';

const ARM_EFFECTS = new Set([
  'pre_attack_damage_ready',
  'extra_attack_die_ready',
  'negate_attacker_losses_ready',
  'ignore_defense_building_ready',
]);

const CONFIRM_EFFECTS = new Set([
  'royal_decree_units',
  'faction_units_placed',
  'mass_mobilization_units',
  'unification_convert',
  'faction_draft_reinforcements',
  'faction_tech_points',
  'faction_tech_discount',
  'bonus_fortify_move',
  'space_station_launched',
]);

const ARM_ABILITY_IDS = new Set([
  'knights_charge',
  'siege_assault',
  'cannon_barrage',
  'bersaglieri_charge',
  'air_strike',
  'testudo',
  'war_elephants',
  'ambush',
  'banzai_charge',
]);

/** Play a synthesized cue for ability activation (not strikes — those use strike_animation). */
export function playAbilityActivationSound(abilityId?: string, effect?: string): void {
  if (!abilityId && !effect) return;

  if (effect === 'unit_reduction' || effect === 'atom_bomb_detonated') return;

  if (effect === 'blitzkrieg_ready' || effect === 'march_to_sea_active') {
    playDoctrineArmSound();
    return;
  }

  if (effect === 'spy_network_active' || effect === 'satellite_reconnaissance_active') {
    playReconSound();
    return;
  }

  if (effect && ARM_EFFECTS.has(effect)) {
    playAbilityArmSound();
    return;
  }

  if (abilityId && ARM_ABILITY_IDS.has(abilityId)) {
    playAbilityArmSound();
    return;
  }

  if (effect && CONFIRM_EFFECTS.has(effect)) {
    playAbilityConfirmSound();
    return;
  }

  if (abilityId === 'guerrilla_warfare') {
    playAbilityConfirmSound();
  }
}

export function playStrikeAbilitySound(abilityId: string): void {
  playStrikeImpactSound(abilityId);
}
