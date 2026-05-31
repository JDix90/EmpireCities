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
  style: 'danger' | 'warning' | 'info' | 'success';
  /** One-line tooltip shown below the button. */
  hint: string;
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
    // WW2
    germany:      'blitzkrieg',
    soviet_union: 'mass_mobilization',
    china_ww2:    'guerrilla_warfare',
    // Medieval / others added as server handlers land
    england:      'knights_charge',
    france:       'knights_charge',
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
  context: { isEnemy: boolean; isMine: boolean },
): string[] {
  const abilityId = getAvailableFactionAbilityId(gameState, player);
  if (!abilityId) return [];

  const def = FACTION_ABILITY_UI[abilityId];
  if (!def || def.enemyTarget === null) return [];

  const phase = gameState.phase as string;
  if (def.phase !== 'any' && def.phase !== phase) return [];
  if (def.enemyTarget && !context.isEnemy) return [];
  if (!def.enemyTarget && !context.isMine) return [];
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
  if (!isFactionAbilityAvailable(player, abilityId)) return [];

  return [abilityId];
}
