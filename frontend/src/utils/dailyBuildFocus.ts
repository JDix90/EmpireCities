/**
 * What the build panel should say on a daily objective day, and which
 * buildings cannot matter in a game at all.
 *
 * The case that produced this: an economy day asked for a tier-two production
 * building on a seven-PP budget with a five-turn clock, and the panel offered
 * a Palisade (the AI could never reach it), a Laboratory (tech trees were off,
 * so its tech points would never accrue) and a 25-PP wonder beside the
 * Workshop the goal actually needed. One wrong purchase was survivable; two
 * were fatal, and nothing said which rows were the wrong ones.
 */
import type { GameState } from '../store/gameStore';
import type { MapConnection } from './mapAdjacencyTargets';
import { buildingDisplayName } from '@borderfall/shared';

export interface DailyBuildFocus {
  /** One line above the build list: what today's goal counts. */
  note: string;
  /** Building ids that count toward it; the panel tags every other row. */
  countsToward: string[];
}

const CHAINS: Record<string, string[]> = {
  production: ['production_1', 'production_2', 'production_3', 'production_4'],
  defense: ['defense_1', 'defense_2', 'defense_3'],
  tech_gen: ['tech_gen_1', 'tech_gen_2'],
};
const TECH_BUILDINGS = CHAINS.tech_gen;
const DEFENCE_BUILDINGS = [...CHAINS.defense, 'coastal_battery'];

type DailySpec = NonNullable<GameState['settings']['daily_challenge_spec']>;

/** A day whose goal is something built or researched, not ground taken or held. */
function objectiveDay(spec: DailySpec | undefined): DailySpec | null {
  if (!spec) return null;
  return spec.archetype === 'economy_build' || spec.archetype === 'tech_research' ? spec : null;
}

/** The tiers a building goal needs, the goal last: a Foundry needs a Workshop first. */
export function goalChain(buildingType: string): string[] {
  for (const chain of Object.values(CHAINS)) {
    const idx = chain.indexOf(buildingType);
    if (idx >= 0) return chain.slice(0, idx + 1);
  }
  return [buildingType];
}

/**
 * The focus line and the rows that count, on a build or research day. Null in
 * every other game, where buildings are the ordinary strategic choice they
 * always are.
 */
export function dailyBuildFocus(settings: GameState['settings'] | null | undefined): DailyBuildFocus | null {
  const spec = objectiveDay(settings?.daily_challenge_spec);
  if (!spec) return null;
  if (spec.archetype === 'economy_build') {
    if (!spec.building_type) return null;
    const chain = goalChain(spec.building_type);
    const names = chain.map((b) => buildingDisplayName(b, true));
    const plan = names.length > 1
      ? `${names.slice(0, -1).join(', then ')}, then ${names[names.length - 1]} on top of it`
      : names[0];
    return { note: `Today's goal: ${plan}. Nothing else counts toward it.`, countsToward: chain };
  }
  return {
    note: "Today's goal is research: a Laboratory adds tech points. Nothing else counts toward it.",
    countsToward: TECH_BUILDINGS,
  };
}

/**
 * Whether another player's territory borders one the viewer holds. Written for
 * daily boards, which have no teams, so every other owner counts as an enemy.
 */
export function enemyBordersPlayer(
  gameState: Pick<GameState, 'territories'>,
  connections: MapConnection[],
  viewerId: string | null | undefined,
): boolean {
  if (!viewerId) return false;
  for (const conn of connections) {
    const a = gameState.territories[conn.from]?.owner_id;
    const b = gameState.territories[conn.to]?.owner_id;
    const mine = a === viewerId || b === viewerId;
    const theirs = (a && a !== viewerId) || (b && b !== viewerId);
    if (mine && theirs) return true;
  }
  return false;
}

/**
 * Buildings that cannot matter in this game, each with the reason the panel
 * shows. Two cases, both certain:
 *  - tech buildings with tech trees off: tech points never accrue
 *    (economyManager.collectProduction credits them only with tech trees on),
 *    unless factions are on, where one faction's bonus pays production for
 *    every tech building it holds;
 *  - defence on a build or research day whose board was cleared and where no
 *    enemy borders the viewer: an empty neutral cannot be taken by either side
 *    (executeLandAttack refuses it), so nothing can ever reach those walls.
 */
export function unavailableBuildings(
  gameState: Pick<GameState, 'settings' | 'territories'>,
  connections: MapConnection[],
  viewerId: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const settings = gameState.settings;
  if (!settings.tech_trees_enabled && !settings.factions_enabled) {
    for (const b of TECH_BUILDINGS) out[b] = 'No tech trees in this game, so tech points would go unused.';
  }
  const spec = objectiveDay(settings.daily_challenge_spec);
  if (spec && spec.clear_board === true && !enemyBordersPlayer(gameState, connections, viewerId)) {
    for (const b of DEFENCE_BUILDINGS) out[b] = "Nothing can reach your territories on today's board.";
  }
  return out;
}
