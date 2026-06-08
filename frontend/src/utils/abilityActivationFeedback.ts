import type { TerritoryAbilityUiDef } from './techAbilities';
import { TERRITORY_ABILITY_UI } from './techAbilities';
import { FACTION_ABILITY_UI, type FactionAbilityUiDef } from './factionAbilities';
import type { PlayerState } from '../store/gameStore';

const ACTIVATION_BY_ID: Record<string, string> = {
  knights_charge: '🐴 Knights Charge armed — your next attack rolls +1 extra die',
  siege_assault: '🏰 Siege Assault armed — your next attack ignores enemy fortifications',
  cannon_barrage: '💣 Cannon Barrage armed — your next attack rolls +1 extra die',
  testudo: '🐢 Testudo Formation armed — you take 0 losses on your next attack',
  war_elephants: '🐘 War Elephants armed — your next attack rolls +1 extra die',
  ambush: '🌲 Ambush armed — your next attack rolls +1 extra die',
  banzai_charge: '🎌 Banzai Charge armed — your next attack rolls +1 extra die',
  bersaglieri_charge: '🎖️ Bersaglieri Charge armed — your next attack rolls +1 extra die',
  air_strike: '✈️ Air Strike armed — your next attack deals +1 damage before combat',
  blitzkrieg: '⚡ Blitzkrieg armed — capture a territory for a bonus attack (+1 die)',
  double_blitz: '⚡ Double Blitz armed — capture a territory for two bonus attacks (+1 die each)',
  march_to_sea: '⚔️ March to the Sea armed — +1 attack die on up to 3 chain captures',
  armored_push: '🚜 Armored Push — +1 fortify move this turn',
  spy_network: '🕵️ Spy Network active — reveals enemy territories within 2 hops',
  satellite_reconnaissance: '🛰️ Satellite Recon active — full map revealed this turn',
  royal_decree: '👑 Royal Decree — +2 free units placed',
  launch_space_station: '🚀 Space Station launched',
  mass_mobilization: '🪖 Mass Mobilization — +5 units placed',
};

const ACTIVATION_BY_EFFECT: Record<string, string> = {
  pre_attack_damage_ready: '✈️ Air Strike armed — your next attack deals +1 damage before combat',
  extra_attack_die_ready: '⚔️ Bonus attack die armed for your next assault',
  negate_attacker_losses_ready: '🐢 Formation armed — you take 0 losses on your next attack',
  ignore_defense_building_ready: '🏰 Siege tactics armed — enemy fortifications ignored on your next attack',
  blitzkrieg_ready: '⚡ Blitz doctrine armed — capture to trigger bonus attack(s)',
  march_to_sea_active: '⚔️ March to the Sea armed — +1 attack die on up to 3 chain captures',
  bonus_fortify_move: '🚜 Armored Push — +1 fortify move this turn',
  spy_network_active: '🕵️ Spy Network active — reveals enemy territories within 2 hops',
  satellite_reconnaissance_active: '🛰️ Satellite Recon active — full map revealed this turn',
  faction_draft_reinforcements: '📦 Reinforcements added to your draft pool',
  faction_tech_points: '📚 Tech points gained',
  faction_tech_discount: '📚 Next research costs 3 fewer tech points',
  royal_decree_units: '👑 Royal Decree — +2 free units placed',
  faction_units_placed: '✅ Units placed',
  mass_mobilization_units: '🪖 Mass Mobilization — +5 units placed',
  unification_convert: '🇮🇹 Territory unified under your banner',
  space_station_launched: '🚀 Space Station launched',
};

export function getAbilityActivationMessage(
  abilityId?: string,
  effect?: string,
  territoryName?: string,
): string | null {
  if (effect === 'unit_reduction' && abilityId) {
    const def = getAbilityUiDef(abilityId);
    const label = def?.label ?? abilityId.replace(/_/g, ' ');
    const where = territoryName ? ` on ${territoryName}` : '';
    return `💥 ${label} — enemy units reduced${where}`;
  }
  if (effect === 'atom_bomb_detonated') {
    const where = territoryName ? ` at ${territoryName}` : '';
    return `☢️ Atom Bomb detonated${where}`;
  }
  if (abilityId && ACTIVATION_BY_ID[abilityId]) {
    const base = ACTIVATION_BY_ID[abilityId];
    if (territoryName && (effect === 'royal_decree_units' || effect === 'faction_units_placed' || effect === 'mass_mobilization_units')) {
      return `${base} on ${territoryName}`;
    }
    return base;
  }
  if (effect && ACTIVATION_BY_EFFECT[effect]) {
    const base = ACTIVATION_BY_EFFECT[effect];
    if (territoryName && effect !== 'blitzkrieg_ready') {
      return `${base}${territoryName ? ` (${territoryName})` : ''}`;
    }
    return base;
  }
  return null;
}

export function getAbilityUiDef(abilityId: string): TerritoryAbilityUiDef | FactionAbilityUiDef | undefined {
  return TERRITORY_ABILITY_UI[abilityId] ?? FACTION_ABILITY_UI[abilityId];
}

export const ARMED_BUFF_LABELS: Array<{
  emoji: string;
  label: string;
  isActive: (player: PlayerState) => boolean;
}> = [
  {
    emoji: '⚔️',
    label: 'Bonus attack die ready',
    isActive: (p) => !!p.pending_extra_attack_die,
  },
  {
    emoji: '🏰',
    label: 'Siege assault ready — ignores forts',
    isActive: (p) => !!p.pending_ignore_defense_building,
  },
  {
    emoji: '🐢',
    label: 'Testudo ready — 0 attacker losses',
    isActive: (p) => !!p.pending_negate_attacker_losses,
  },
  {
    emoji: '✈️',
    label: 'Air strike ready — +1 pre-combat damage',
    isActive: (p) => (p.pending_pre_attack_damage ?? 0) > 0,
  },
];

export const COMBAT_CALLOUT_LABELS: Record<string, (detail?: string) => string> = {
  knights_charge: () => '🐴 Knights Charge — +1 attack die',
  cannon_barrage: () => '💣 Cannon Barrage — +1 attack die',
  war_elephants: () => '🐘 War Elephants — +1 attack die',
  ambush: () => '🌲 Ambush — +1 attack die',
  banzai_charge: () => '🎌 Banzai Charge — +1 attack die',
  bersaglieri_charge: () => '🎖️ Bersaglieri Charge — +1 attack die',
  siege_assault: () => '🏰 Siege Assault — enemy fortifications ignored',
  gunpowder_passive: () => '💣 Gunpowder — enemy castle bonus negated',
  testudo: (detail) => `🐢 Testudo Formation — ${detail ?? '0'} attacker loss${detail === '1' ? '' : 'es'} prevented`,
  air_strike: () => '✈️ Air Strike — +1 damage before combat',
  extra_attack_die: () => '⚔️ Bonus attack die activated',
};
