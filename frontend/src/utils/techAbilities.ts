import type { GameState, PlayerState } from '../store/gameStore';

export interface TerritoryAbilityUiDef {
  label: string;
  emoji: string;
  scope: 'turn' | 'game';
  phase: 'attack' | 'draft' | 'fortify';
  /** Show on enemy territories (true) or owned territories (false). */
  enemyTarget: boolean;
  /**
   * Also offer on NEUTRAL territories. Only Drop Assault does today: it takes
   * ground rather than fighting a player, and the Space Age board carries
   * neutral frontier tiles worth taking. Without it an enemy-target ability is
   * hidden on unowned ground even where the server would accept it.
   */
  alsoUnowned?: boolean;
  style: 'danger' | 'warning' | 'info' | 'success';
  hint?: string;
}

/** UI metadata for tech/faction abilities triggered from the territory panel. */
export const TERRITORY_ABILITY_UI: Record<string, TerritoryAbilityUiDef> = {
  atom_bomb: {
    label: 'Atom Bomb', emoji: '☢️', scope: 'game', phase: 'attack', enemyTarget: true, style: 'danger',
    hint: 'Devastate an enemy territory (once per game).',
  },
  nuclear_strike: {
    label: 'Nuclear Strike', emoji: '☢️', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'danger',
    hint: 'Remove 2 units from an enemy territory.',
  },
  cyber_attack: {
    label: 'Cyber Attack', emoji: '💻', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning',
    hint: 'Remove 1 unit from an adjacent enemy territory.',
  },
  data_breach: {
    label: 'Data Breach', emoji: '💻', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning',
    hint: 'Remove 1 unit from an adjacent enemy territory.',
  },
  orbital_strike: {
    label: 'Orbital Strike', emoji: '🛰️', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'danger',
    hint: 'Remove 3 units from an enemy territory.',
  },
  swarm_strike: {
    label: 'Swarm Strike', emoji: '🐝', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning',
    hint: 'Remove 2 units from an adjacent enemy territory.',
  },
  dyson_beam: {
    label: 'Dyson Beam', emoji: '☀️', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'danger',
    hint: 'Remove 4 units from an enemy territory.',
  },
  // ── Space Age Moon Race: powers held by lunar ground, not by a tech ────────
  lunar_export: {
    label: 'Lunar Export', emoji: '☾', scope: 'turn', phase: 'draft', enemyTarget: false, style: 'info',
    hint: 'Convert up to 5 Helium-3 into tech points.',
  },
  orbital_drop: {
    label: 'Orbital Drop', emoji: '🛬', scope: 'turn', phase: 'draft', enemyTarget: false, style: 'success',
    hint: 'Land 3 units on any territory you own — 3 Moon tiles, 8 He-3.',
  },
  drop_assault: {
    label: 'Drop Assault', emoji: '💥', scope: 'turn', phase: 'draft', enemyTarget: true, style: 'danger',
    alsoUnowned: true,
    hint: 'Mark this tile: 3 units land here at the start of your next turn — 10 He-3.',
  },
  hypersonic_strike: {
    label: 'Hypersonic Strike', emoji: '🚀', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning',
    hint: 'Remove 2 units from an enemy within 2 hops.',
  },
  river_blockade: {
    label: 'River Blockade', emoji: '🌊', scope: 'turn', phase: 'attack', enemyTarget: true, style: 'warning',
    hint: 'Remove 1 unit from an adjacent enemy territory.',
  },
  air_strike: {
    label: 'Air Strike', emoji: '✈️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: '+1 damage to target before your next attack resolves',
  },
  knights_charge: {
    label: 'Knights Charge', emoji: '🐴', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: '+1 attack die on your next attack',
  },
  bersaglieri_charge: {
    label: 'Bersaglieri Charge', emoji: '🎖️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: '+1 attack die on your next attack',
  },
  spy_network: {
    label: 'Spy Network', emoji: '🕵️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info',
    hint: 'Reveal enemy territories within 2 hops for this turn.',
  },
  satellite_reconnaissance: {
    label: 'Satellite Recon', emoji: '🛰️', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'info',
    hint: 'Reveal the entire map for this turn.',
  },
  siege_assault: {
    label: 'Siege Assault', emoji: '🏰', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: 'Next attack ignores enemy fortification bonus',
  },
  cannon_barrage: {
    label: 'Cannon Barrage', emoji: '💣', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: '+1 attack die on your next attack (Gunpowder already negates forts)',
  },
  royal_decree: {
    label: 'Royal Decree', emoji: '👑', scope: 'turn', phase: 'draft', enemyTarget: false, style: 'success',
    hint: 'Place 2 free units on an owned territory.',
  },
  march_to_sea: {
    label: 'March to the Sea', emoji: '⚔️', scope: 'game', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: '+1 attack die on up to 3 consecutive chain captures (once per game).',
  },
  double_blitz: {
    label: 'Double Blitz', emoji: '⚡', scope: 'turn', phase: 'attack', enemyTarget: false, style: 'warning',
    hint: 'After a capture, make two bonus attacks from that territory (+1 die each).',
  },
  launch_space_station: {
    label: 'Launch Space Station', emoji: '🚀', scope: 'game', phase: 'draft', enemyTarget: false, style: 'info',
    hint: 'Launch your orbital station (requires Launch Pad, once per game).',
  },
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

/**
 * Moon tiles each lunar power needs, mirroring `requiresMoonTiles` in
 * `backend/src/game-engine/abilities/techAbilities.ts`. The backend re-checks
 * this before resolving, so the worst a drift here can do is offer a button the
 * server then declines with a specific reason — the same contract the
 * tech-point-costed faction abilities already run on.
 */
const MOON_GROUND_TILE_REQUIREMENT: Record<string, number> = {
  lunar_export: 1,
  orbital_drop: 3,
  drop_assault: 3,
};

/**
 * Abilities a player holds because of where they stand, not what they
 * researched (`moonPowers.ts` hasMoonGroundAccess).
 *
 * Without this they are unreachable in the UI: every other ability is surfaced
 * by walking the tech tree for `unlocks_ability`, and these two have no
 * unlocking tech on purpose — the Lunar Pioneers reach the Moon from turn one
 * without `sa_lunar_expansion`, and gating the Moon's powers on that tech would
 * lock the Moon-native faction out of them.
 */
export function getMoonGroundAbilityIds(gameState: GameState, lunarTilesOwned: number): string[] {
  const settings = gameState.settings;
  if (!settings.space_age_moon_helium3_enabled) return [];
  const ids: string[] = [];
  if (lunarTilesOwned >= MOON_GROUND_TILE_REQUIREMENT.lunar_export) ids.push('lunar_export');
  if (settings.space_age_moon_gated_tier_enabled) {
    if (lunarTilesOwned >= MOON_GROUND_TILE_REQUIREMENT.orbital_drop) ids.push('orbital_drop');
    if (lunarTilesOwned >= MOON_GROUND_TILE_REQUIREMENT.drop_assault) ids.push('drop_assault');
  }
  return ids;
}

export function getTerritoryPanelAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
  context: { isEnemy: boolean; isMine: boolean; isUnowned?: boolean },
  lunarTilesOwned = 0,
): string[] {
  const unlocked = getUnlockedAbilityIds(gameState, player, techTree);
  // Legacy charges carried from a prior era stay usable even though the
  // unlocking tech is gone (era advancement); they flow through the same
  // phase/target/availability filter below.
  for (const [abilityId, count] of Object.entries(player.legacy_ability_charges ?? {})) {
    if (count > 0) unlocked.add(abilityId);
  }
  for (const abilityId of getMoonGroundAbilityIds(gameState, lunarTilesOwned)) {
    unlocked.add(abilityId);
  }
  const phase = gameState.phase;

  return Object.entries(TERRITORY_ABILITY_UI)
    .filter(([abilityId, def]) => {
      if (!unlocked.has(abilityId)) return false;
      if (def.phase !== phase && !(def.phase === 'draft' && phase === 'fortify')) return false;
      if (def.enemyTarget && !(context.isEnemy || (def.alsoUnowned && context.isUnowned))) return false;
      if (!def.enemyTarget && !context.isMine) return false;
      return isAbilityAvailable(player, abilityId);
    })
    .map(([abilityId]) => abilityId);
}

export function getGlobalPanelAbilities(
  gameState: GameState,
  player: PlayerState,
  techTree: Array<{ tech_id: string; unlocks_ability?: string }>,
  lunarTilesOwned = 0,
): string[] {
  const unlocked = getUnlockedAbilityIds(gameState, player, techTree);
  for (const abilityId of getMoonGroundAbilityIds(gameState, lunarTilesOwned)) {
    unlocked.add(abilityId);
  }
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
