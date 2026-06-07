import type { GameState, PlayerState } from '../store/gameStore';

export interface TerritoryAbilityUiDef {
  label: string;
  emoji: string;
  scope: 'turn' | 'game';
  phase: 'attack' | 'draft' | 'fortify';
  /** Show on enemy territories (true) or owned territories (false). */
  enemyTarget: boolean;
  style: 'danger' | 'warning' | 'info' | 'success';
  hint?: string;
}

/** UI metadata for tech/faction abilities triggered from the territory panel. */
export const TERRITORY_ABILITY_UI: Record<string, TerritoryAbilityUiDef> = {
  atom_bomb: { label: 'Atom Bomb', emoji: '☢️', scope: 'game', phase: 'attack', enemyTarget: true, style: 'danger' },
  nuclear_strike: { label: 'Nuclear Strike', emoji: '☢️', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'danger' },
  cyber_attack: { label: 'Cyber Attack', emoji: '💻', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning' },
  data_breach: { label: 'Data Breach', emoji: '💻', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning' },
  orbital_strike: { label: 'Orbital Strike', emoji: '🛰️', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'danger' },
  swarm_strike: { label: 'Swarm Strike', emoji: '🐝', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning' },
  dyson_beam: { label: 'Dyson Beam', emoji: '☀️', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'danger' },
  hypersonic_strike: { label: 'Hypersonic Strike', emoji: '🚀', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning' },
  river_blockade: { label: 'River Blockade', emoji: '🌊', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning' },
  air_strike: { label: 'Air Strike', emoji: '✈️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  knights_charge: { label: 'Knights Charge', emoji: '🐴', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  bersaglieri_charge: { label: 'Bersaglieri Charge', emoji: '🎖️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  spy_network: { label: 'Spy Network', emoji: '🕵️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  satellite_reconnaissance: { label: 'Satellite Recon', emoji: '🛰️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  siege_assault: { label: 'Siege Assault', emoji: '🏰', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  cannon_barrage: { label: 'Cannon Barrage', emoji: '💣', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info' },
  royal_decree: { label: 'Royal Decree', emoji: '👑', scope: 'turn', phase: 'draft', enemyTarget: false, style: 'info' },
  march_to_sea: { label: 'March to the Sea', emoji: '⚔️', scope: 'game', phase: 'attack', enemyTarget: false, style: 'info', hint: '+1 attack die on up to 3 consecutive chain captures' },
  double_blitz: { label: 'Double Blitz', emoji: '⚡', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning', hint: 'After a capture, make two bonus attacks from that territory (+1 die each).' },
  launch_space_station: { label: 'Launch Space Station', emoji: '🚀', scope: 'game', phase: 'draft', enemyTarget: false, style: 'info' },
};

const GAME_SCOPED = new Set(['atom_bomb', 'launch_space_station', 'march_to_sea']);

export function getUnlockedAbilityIds(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
): Set<string> {
  if (!gameState.settings.tech_trees_enabled) return new Set();
  const unlocked = player.unlocked_techs ?? [];
  const ids = new Set<string>();
  for (const node of techTree) {
    if (unlocked.includes(node.tech_id) && node.unlocks_ability) {
      ids.add(node.unlocks_ability);
    }
  }
  return ids;
}

export function isAbilityAvailable(
  player: PlayerState,
  abilityId: string,
): boolean {
  const def = TERRITORY_ABILITY_UI[abilityId];
  if (!def) return false;
  if (GAME_SCOPED.has(abilityId)) {
    return !(player.used_game_abilities ?? []).includes(abilityId);
  }
  return !(player.ability_uses ?? {})[abilityId];
}

export function getTerritoryPanelAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
  context: { isEnemy: boolean; isMine: boolean },
): string[] {
  const unlocked = getUnlockedAbilityIds(gameState, player, techTree);
  const phase = gameState.phase;

  return Object.entries(TERRITORY_ABILITY_UI)
    .filter(([abilityId, def]) => {
      if (!unlocked.has(abilityId)) return false;
      if (def.phase !== phase && !(def.phase === 'draft' && phase === 'fortify')) return false;
      if (def.enemyTarget && !context.isEnemy) return false;
      if (!def.enemyTarget && !context.isMine) return false;
      return isAbilityAvailable(player, abilityId);
    })
    .map(([abilityId]) => abilityId);
}

export function getGlobalPanelAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
): string[] {
  const unlocked = getUnlockedAbilityIds(gameState, player, techTree);
  const phase = gameState.phase;
  return Object.entries(TERRITORY_ABILITY_UI)
    .filter(([abilityId, def]) => {
      if (!unlocked.has(abilityId)) return false;
      if (def.enemyTarget) return false;
      if (def.phase !== phase && !(def.phase === 'draft' && phase === 'fortify')) return false;
      return isAbilityAvailable(player, abilityId);
    })
    .map(([abilityId]) => abilityId);
}
