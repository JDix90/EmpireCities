/**
 * WW2 Manhattan Project, Phase 3: the atomic arsenal on the client
 * (docs/WW2_MANHATTAN_PROJECT.md §5). The server decides (backend
 * state/atomicArsenal.ts and abilities/atomicArsenal.ts); this restates what the
 * territory panel shows: the bomb once per turn at its price, and a tile's
 * fallout.
 */
import { WW2_ATOMIC_ARSENAL, atomBombPrice } from '@borderfall/shared';

interface ArsenalSettings {
  ww2_atomic_arsenal?: boolean;
}

/** True when this game plays the arsenal. */
export function atomicArsenalOn(settings: ArsenalSettings | undefined): boolean {
  return settings?.ww2_atomic_arsenal === true;
}

/** Is the bomb once per turn here (the arsenal) rather than once per game? */
export function atomBombIsPerTurn(abilityId: string, settings: ArsenalSettings | undefined): boolean {
  return abilityId === 'atom_bomb' && atomicArsenalOn(settings);
}

/**
 * PP the player's next detonation costs, or null when the game has no price for
 * it. A charge carried out of WW2 (the unlocking tech gone, a legacy charge
 * held) fires without the price, as the server charges it.
 */
export function atomBombPriceLabel(
  settings: ArsenalSettings | undefined,
  player: { atom_bomb_uses?: number; legacy_ability_charges?: Record<string, number> },
  holdsTech: boolean,
): number | null {
  if (!atomicArsenalOn(settings)) return null;
  const carried = !holdsTech && (player.legacy_ability_charges?.atom_bomb ?? 0) > 0;
  return carried ? 0 : atomBombPrice(player.atom_bomb_uses ?? 0);
}

/** The arsenal's description of the bomb, in place of the once-per-game one. */
export const ATOM_BOMB_ARSENAL_HINT =
  `Wipe an enemy territory: its units and buildings are gone and it goes neutral at 1 unit, `
  + `with fallout for ${WW2_ATOMIC_ARSENAL.falloutRounds} rounds. Each bomb costs more than the last.`;

/** The territory panel's line for a tile with fallout, or null for a clean one. */
export function falloutLine(t: { fallout_rounds?: number } | undefined): string | null {
  const rounds = t?.fallout_rounds ?? 0;
  if (rounds <= 0) return null;
  return `Fallout: ${rounds} round${rounds === 1 ? '' : 's'} left. Whoever holds it loses `
    + `${WW2_ATOMIC_ARSENAL.falloutAttrition} unit a round, it earns nothing, and nothing can be built here.`;
}

/**
 * The price the tech tree shows and gates Research on: a node's own cost, and
 * under the arsenal Manhattan Project at half once anyone has detonated, for a
 * player without it (backend state/atomicArsenal.ts proliferatedTechCost). Other
 * discounts are the server's, as they always were on this panel.
 */
export function shownTechCost(
  settings: ArsenalSettings | undefined,
  players: ReadonlyArray<{ atom_bomb_uses?: number }>,
  unlocked: ReadonlySet<string>,
  node: { tech_id: string; cost: number; unlocks_ability?: string },
): number {
  const proliferated = atomicArsenalOn(settings)
    && node.unlocks_ability === 'atom_bomb'
    && !unlocked.has(node.tech_id)
    && players.some((p) => (p.atom_bomb_uses ?? 0) > 0);
  return proliferated ? Math.ceil(node.cost * WW2_ATOMIC_ARSENAL.proliferationCostShare) : node.cost;
}
