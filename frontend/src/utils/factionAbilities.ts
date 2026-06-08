/**
 * Faction ability UI definitions and helpers.
 *
 * Only includes abilities that have full server-side handlers.
 * Tech-tree-unlocked abilities remain in techAbilities.ts.
 */
import type { GameState, PlayerState } from '../store/gameStore';

export interface FactionAbilityUiDef {
  label: string;
  emoji: string;
  scope: 'turn' | 'game';
  /** Which game phase the button is active during. */
  phase: 'attack' | 'draft' | 'fortify' | 'any';
  /** True = player picks an enemy territory; false = picks own territory; null = no territory target. */
  enemyTarget: boolean | null;
  /** True = player picks a neutral (unowned) territory (unification_drive). Overrides enemyTarget for filtering. */
  neutralTarget?: boolean;
  style: 'danger' | 'warning' | 'info' | 'success';
  /** One-line tooltip shown below the button. */
  hint: string;
  /** Hidden unless the economy layer is enabled (tech-point-gated abilities). */
  requiresEconomy?: boolean;
  /** Tech points consumed on use; the button is hidden until the player can afford it. */
  techCost?: number;
}

/**
 * UI metadata for faction abilities that have working server handlers.
 * Gate new entries here only after backend handler + game:ability_result exist.
 */
export const FACTION_ABILITY_UI: Record<string, FactionAbilityUiDef> = {
  // WW2 — fully implemented (gameSocket.ts ~2002)
  blitzkrieg: {
    label: 'Blitzkrieg',
    emoji: '⚡',
    scope: 'turn',
    phase: 'attack',
    enemyTarget: null,
    style: 'warning',
    hint: 'Activate then capture a territory for one free bonus attack from it.',
  },
  // WW2 — fully implemented (gameSocket.ts ~2012)
  guerrilla_warfare: {
    label: 'Guerrilla Warfare',
    emoji: '🌿',
    scope: 'turn',
    phase: 'draft',
    enemyTarget: false,
    style: 'success',
    hint: 'Place 1 free unit on any owned territory.',
  },
  // Mass Mobilization — once-per-game, draft phase
  mass_mobilization: {
    label: 'Mass Mobilization',
    emoji: '🪖',
    scope: 'game',
    phase: 'draft',
    enemyTarget: false,
    style: 'info',
    hint: 'Place 5 extra units on any owned territory (once per game).',
  },
  // ── Group A: free-unit placement on an owned territory (draft) ──────────────
  marshall_plan: {
    label: 'Marshall Plan', emoji: '🎖️', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'success', hint: 'Place 1 free unit on an owned territory.',
  },
  insurgency: {
    label: 'Insurgency', emoji: '🥷', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'success', hint: 'Place 1 free unit on an owned territory.',
  },
  guerrilla_resistance: {
    label: 'Guerrilla Resistance', emoji: '🌿', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'success', hint: 'Place 2 free units on an owned territory.',
  },
  habsberg_garrison: {
    label: 'Habsburg Garrison', emoji: '🛡️', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'success', hint: 'Place 1 free unit on an owned territory.',
  },
  lunar_supply_drop: {
    label: 'Lunar Supply Drop', emoji: '🌙', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'success', hint: 'Drop 2 free units on an owned Moon territory.',
  },
  terraform: {
    label: 'Terraform', emoji: '🌱', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'success', hint: 'Place 1 free unit and restore stability on an owned territory.',
  },
  // ── Group B: tech-point-gated placement (draft, requires economy) ───────────
  arsenal_of_democracy: {
    label: 'Arsenal of Democracy', emoji: '🏭', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'info', requiresEconomy: true, techCost: 5,
    hint: 'Spend 5 tech points: place 3 units on an owned territory.',
  },
  ai_surge: {
    label: 'AI Surge', emoji: '🤖', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'info', requiresEconomy: true, techCost: 5,
    hint: 'Spend 5 tech points: place 3 units on an owned territory.',
  },
  economic_boom: {
    label: 'Economic Boom', emoji: '📈', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'info', requiresEconomy: true, techCost: 3,
    hint: 'Spend 3 tech points: place 2 units on an owned territory.',
  },
  oil_wealth: {
    label: 'Oil Wealth', emoji: '🛢️', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'info', requiresEconomy: true, techCost: 6,
    hint: 'Spend 6 tech points: place 3 units on an owned territory.',
  },
  mercenary_contract: {
    label: 'Mercenary Contract', emoji: '💰', scope: 'turn', phase: 'draft',
    enemyTarget: false, style: 'info', requiresEconomy: true, techCost: 5,
    hint: 'Spend 5 tech points: place 4 units on a production territory.',
  },
  spice_trade: {
    label: 'Spice Trade', emoji: '🌶️', scope: 'turn', phase: 'draft',
    enemyTarget: null, style: 'info', requiresEconomy: true, techCost: 5,
    hint: 'Spend 5 tech points: add 2 reinforcements to your draft pool.',
  },
  // ── Group C: reinforcement / economy boosts (draft, no territory target) ────
  total_war: {
    label: 'Total War', emoji: '🔥', scope: 'game', phase: 'draft',
    enemyTarget: null, style: 'warning', hint: 'Add 6 reinforcements to your draft pool (once per game).',
  },
  peoples_war: {
    label: "People's War", emoji: '✊', scope: 'game', phase: 'draft',
    enemyTarget: null, style: 'warning', hint: 'Add 6 reinforcements to your draft pool (once per game).',
  },
  imperial_diet: {
    label: 'Imperial Diet', emoji: '👑', scope: 'turn', phase: 'draft',
    enemyTarget: null, style: 'info', hint: 'Add 1 reinforcement per fully-owned region (max 4).',
  },
  silk_road: {
    label: 'Silk Road', emoji: '🐫', scope: 'turn', phase: 'draft',
    enemyTarget: null, style: 'info', requiresEconomy: true, hint: 'Gain 3 tech points.',
  },
  house_of_wisdom: {
    label: 'House of Wisdom', emoji: '📚', scope: 'turn', phase: 'draft',
    enemyTarget: null, style: 'info', requiresEconomy: true, hint: 'Your next research costs 3 fewer tech points.',
  },
  // ── Group D: attack self-buffs (attack, self-activated) ─────────────────────
  war_elephants: {
    label: 'War Elephants', emoji: '🐘', scope: 'turn', phase: 'attack',
    enemyTarget: null, style: 'warning', hint: '+1 attack die on your next attack.',
  },
  banzai_charge: {
    label: 'Banzai Charge', emoji: '🎌', scope: 'turn', phase: 'attack',
    enemyTarget: null, style: 'warning', hint: '+1 attack die on your next attack.',
  },
  ambush: {
    label: 'Ambush', emoji: '🌲', scope: 'turn', phase: 'attack',
    enemyTarget: null, style: 'warning', hint: '+1 attack die on your next attack.',
  },
  testudo: {
    label: 'Testudo', emoji: '🐢', scope: 'turn', phase: 'attack',
    enemyTarget: null, style: 'info', hint: 'Take 0 losses on your next attack.',
  },
  // ── Group E: unit-reduction strikes (attack, target an adjacent enemy) ──────
  precision_airstrike: {
    label: 'Precision Airstrike', emoji: '✈️', scope: 'turn', phase: 'attack',
    enemyTarget: true, style: 'danger', hint: 'Remove 2 units from an adjacent enemy territory.',
  },
  longbowmen: {
    label: 'Longbowmen', emoji: '🏹', scope: 'turn', phase: 'attack',
    enemyTarget: true, style: 'danger', hint: 'Remove 1 unit from an adjacent enemy territory.',
  },
  chevauchee: {
    label: 'Chevauchée', emoji: '🐎', scope: 'turn', phase: 'attack',
    enemyTarget: true, style: 'danger', hint: 'Remove 2 units from an adjacent enemy territory.',
  },
  privateer: {
    label: 'Privateer', emoji: '🏴‍☠️', scope: 'turn', phase: 'attack',
    enemyTarget: true, style: 'danger', hint: 'Raid an adjacent coastal enemy: remove 1 unit (+1 tech point).',
  },
  cyber_attack: {
    label: 'Cyber Attack', emoji: '💻', scope: 'turn', phase: 'attack',
    enemyTarget: true, style: 'danger', hint: 'Remove 1 unit from an adjacent enemy territory.',
  },
  // ── Group F: fortify boost (fortify, self-activated) ────────────────────────
  armored_push: {
    label: 'Armored Push', emoji: '🚜', scope: 'turn', phase: 'fortify',
    enemyTarget: null, style: 'info', hint: '+1 fortify move this turn.',
  },
  // ── Group G: unification drive — convert an in-range neutral territory free ──
  unification_drive: {
    label: 'Unification Drive', emoji: '🇮🇹', scope: 'turn', phase: 'attack',
    enemyTarget: false, neutralTarget: true, style: 'success',
    hint: 'Convert an in-range neutral territory to your control for free.',
  },
};

/**
 * Checks whether a faction ability is currently available to use.
 * Consults FACTION_ABILITY_UI for scope (turn vs game), NOT TERRITORY_ABILITY_UI.
 * Previously this delegated to isAbilityAvailable() from techAbilities.ts which
 * checks TERRITORY_ABILITY_UI and would always return false for faction abilities.
 */
function isFactionAbilityAvailable(player: PlayerState, abilityId: string): boolean {
  const def = FACTION_ABILITY_UI[abilityId];
  if (!def) return false;
  if (def.scope === 'game') {
    return !(player.used_game_abilities ?? []).includes(abilityId);
  }
  // turn-scoped: ability_uses is reset to {} each turn by the server
  return !(player.ability_uses ?? {})[abilityId];
}

/**
 * Returns the faction ability id for the given player if factions are enabled
 * and the ability is listed in FACTION_ABILITY_UI.
 */
export function getAvailableFactionAbilityId(
  gameState: GameState,
  player: PlayerState,
): string | null {
  if (!gameState.settings.factions_enabled) return null;
  const factionId = player.faction_id;
  if (!factionId) return null;

  // Static map from faction_id → ability_id, derived from era faction definitions.
  const FACTION_TO_ABILITY: Record<string, string> = {
    // WW2 — only factions with working server handlers are surfaced here.
    germany:      'blitzkrieg',
    soviet_union: 'mass_mobilization',
    china_ww2:    'guerrilla_warfare',
    // Group A — free-unit placement (draft)
    usa_cw:                  'marshall_plan',
    rogue_state:             'insurgency',
    decolonization_movement: 'guerrilla_resistance',
    austria:                 'habsberg_garrison',
    lunar_pioneers:          'lunar_supply_drop',
    climate_alliance:        'terraform',
    void_custodians:         'terraform',
    // Group B — tech-point-gated placement (draft)
    usa:               'arsenal_of_democracy',
    sino_hegemony:     'ai_surge',
    emerging_power:    'economic_boom',
    petro_state:       'oil_wealth',
    corpo_enclave:     'mercenary_contract',
    mughal:            'spice_trade',
    // Group C — reinforcement / economy boosts (draft)
    union:        'total_war',
    china_cw:     'peoples_war',
    hre:          'imperial_diet',
    han:          'silk_road',
    caliphate:    'house_of_wisdom',
    // Group D — attack self-buffs (attack)
    maurya:          'war_elephants',
    japan:           'banzai_charge',
    germanic_tribes: 'ambush',
    rome:            'testudo',
    // Group E — unit-reduction strikes (attack)
    western_power:    'precision_airstrike',
    england:          'longbowmen',
    france:           'chevauchee',
    england_discovery:'privateer',
    cyber_power:      'cyber_attack',
    stellar_mandate:  'cyber_attack',
    // Group F — fortify boost (fortify)
    eastern_bloc:     'armored_push',
    // Group G — other actives
    sardinia_piedmont: 'unification_drive',
  };

  const abilityId = FACTION_TO_ABILITY[factionId];
  if (!abilityId) return null;
  if (!FACTION_ABILITY_UI[abilityId]) return null;
  return abilityId;
}

/** Subset of faction abilities valid for territory-targeted interactions (own or enemy). */
export function getFactionTerritoryAbilities(
  gameState: GameState,
  player: PlayerState,
  context: { isEnemy: boolean; isMine: boolean; isUnowned?: boolean },
): string[] {
  const abilityId = getAvailableFactionAbilityId(gameState, player);
  if (!abilityId) return [];

  const def = FACTION_ABILITY_UI[abilityId];
  if (!def) return [];
  // Global self-buffs (Group D) also appear on owned territories during attack.
  if (def.enemyTarget === null && !(def.phase === 'attack' && context.isMine)) return [];

  const phase = gameState.phase as string;
  if (def.phase !== 'any' && def.phase !== phase) return [];
  if (def.neutralTarget) {
    if (!context.isUnowned) return [];
  } else if (def.enemyTarget && !context.isEnemy) {
    return [];
  } else if (!def.enemyTarget && !context.isMine) {
    return [];
  }
  if (def.requiresEconomy && !gameState.settings.economy_enabled) return [];
  if (def.techCost && (player.tech_points ?? 0) < def.techCost) return [];
  if (!isFactionAbilityAvailable(player, abilityId)) return [];

  return [abilityId];
}

/** Faction abilities that require no territory target (e.g. blitzkrieg self-activation). */
export function getFactionGlobalAbilities(
  gameState: GameState,
  player: PlayerState,
): string[] {
  const abilityId = getAvailableFactionAbilityId(gameState, player);
  if (!abilityId) return [];

  const def = FACTION_ABILITY_UI[abilityId];
  if (!def || def.enemyTarget !== null) return [];

  const phase = gameState.phase as string;
  if (def.phase !== 'any' && def.phase !== phase) return [];
  if (def.requiresEconomy && !gameState.settings.economy_enabled) return [];
  if (def.techCost && (player.tech_points ?? 0) < def.techCost) return [];
  if (!isFactionAbilityAvailable(player, abilityId)) return [];

  return [abilityId];
}
