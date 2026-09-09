/**
 * Moon-gated powers — the Space Age Moon Race, Phase 2a.
 *
 * Phase 1 gave the Moon an income and one sink, and measured the result as
 * honestly neutral: ~375 tech points a game were injected and none of the era's
 * numbers moved, because tech points are not what a Space Age player is short
 * of. The Moon paid, but it did not let you do anything you could not do from
 * Earth.
 *
 * Phase 2 is the answer: the era's most dramatic power stops being an Earth
 * pick, and a new one exists only for Moon holders.
 *
 * - `dyson_beam` (a global 4-unit strike) keeps its tech, `sa_dyson_array`, and
 *   that tech keeps its +8 TP/turn. The *ability* now needs a lunar foothold
 *   and lunar fuel. An Earth-only player still buys the economy; only the
 *   dramatic thing moved to the Moon.
 * - `orbital_drop` places 3 units on any territory you already own, anywhere on
 *   the board. It has no unlocking tech at all — three Moon tiles and 8 He-3
 *   are the whole credential.
 *
 * Both requirements are checked at USE time against live ownership, so a player
 * who loses their last lunar tile loses the beam mid-turn. That is the point of
 * §4.3: the Moon is a position, not a credential you keep once earned.
 *
 * See docs/space-age-moon/README.md §4.
 */

import type { GameState } from '../../types';
import { countLunarTerritories, isHelium3Enabled } from '../state/helium3';
import { TERRITORY_ABILITY_DEFS } from './techAbilities';

/**
 * Whether Phase 2's gating is live.
 *
 * Deliberately requires Phase 1 as well as its own flag. The gate spends He-3,
 * so turning it on without the economy that produces He-3 would not "gate"
 * `dyson_beam` — it would delete it, permanently and for everyone. A flag whose
 * failure mode is removing a shipped ability is not a flag worth trusting to
 * operator discipline.
 */
export function areMoonPowersEnabled(state: GameState): boolean {
  return isHelium3Enabled(state) && state.settings.space_age_moon_gated_tier_enabled === true;
}

/**
 * Abilities whose availability is lunar ground rather than a tech unlock.
 *
 * The socket validates ability ownership against the faction and the tech tree;
 * these belong to neither, so they need their own credential check. Both are
 * deliberately un-teched: the Lunar Pioneers reach the Moon from turn one
 * without `sa_lunar_expansion`, and gating the Moon's own powers on that tech
 * would lock the Moon-native faction out of them.
 */
export const MOON_GROUND_ABILITY_IDS: ReadonlySet<string> = new Set([
  'lunar_export',
  'orbital_drop',
]);

/**
 * Whether holding lunar ground makes this ability available to this player.
 *
 * `lunar_export` ships in Phase 1 and answers to the Phase 1 flag alone;
 * `orbital_drop` is Phase 2 and needs both. Written as two explicit cases
 * rather than one clever rule, because the two phases can be enabled
 * independently and a shared rule would silently tie them together.
 */
export function hasMoonGroundAccess(
  state: GameState,
  playerId: string,
  abilityId: string,
): boolean {
  if (abilityId === 'lunar_export') {
    return isHelium3Enabled(state) && countLunarTerritories(state, playerId) > 0;
  }
  if (abilityId === 'orbital_drop') {
    if (!areMoonPowersEnabled(state)) return false;
    const required = TERRITORY_ABILITY_DEFS.orbital_drop?.requiresMoonTiles ?? 0;
    return countLunarTerritories(state, playerId) >= required;
  }
  return false;
}

export interface MoonPowerGate {
  /** Lunar tiles the player must hold at the moment of use. */
  moonTiles: number;
  /** He-3 the use consumes, charged only after the effect succeeds. */
  helium3Cost: number;
}

/**
 * The Moon gate on an ability, or null when it has none or Phase 2 is off.
 *
 * Off, `dyson_beam` resolves exactly as it does today — no foothold, no fuel.
 * That is what makes this a dark launch rather than a nerf that ships early.
 */
export function moonPowerGate(state: GameState, abilityId: string): MoonPowerGate | null {
  if (!areMoonPowersEnabled(state)) return null;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def) return null;
  const moonTiles = def.requiresMoonTiles ?? 0;
  const helium3Cost = def.helium3Cost ?? 0;
  if (moonTiles <= 0 && helium3Cost <= 0) return null;
  return { moonTiles, helium3Cost };
}

/**
 * Validate a Moon-gated use. Returns an error message, or null when the use may
 * proceed. Charges nothing — the cost is taken only once the effect succeeds.
 */
export function checkMoonPowerRequirement(
  state: GameState,
  playerId: string,
  abilityId: string,
): string | null {
  // An ability that exists only under Phase 2 must not resolve without it, on
  // any path — the socket already refuses it, this is the engine's own guard.
  if (abilityId === 'orbital_drop' && !areMoonPowersEnabled(state)) {
    return 'Orbital Drop is not enabled in this game';
  }
  const gate = moonPowerGate(state, abilityId);
  if (!gate) return null;

  const label = TERRITORY_ABILITY_DEFS[abilityId]?.label ?? abilityId;
  if (gate.moonTiles > 0) {
    const held = countLunarTerritories(state, playerId);
    if (held < gate.moonTiles) {
      return gate.moonTiles === 1
        ? `${label} needs a Moon territory`
        : `${label} needs ${gate.moonTiles} Moon territories (you hold ${held})`;
    }
  }
  if (gate.helium3Cost > 0) {
    const stock = state.players.find((p) => p.player_id === playerId)?.helium3 ?? 0;
    if (stock < gate.helium3Cost) {
      return `${label} needs ${gate.helium3Cost} Helium-3 (you have ${stock})`;
    }
  }
  return null;
}

/**
 * Charge the He-3 cost of a Moon-gated ability. Called only after the effect
 * has succeeded, so a use rejected further down (wrong phase, invalid target)
 * costs the player nothing. Returns what was spent.
 */
export function spendMoonPowerCost(
  state: GameState,
  playerId: string,
  abilityId: string,
): number {
  const gate = moonPowerGate(state, abilityId);
  if (!gate || gate.helium3Cost <= 0) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const spent = Math.min(gate.helium3Cost, player.helium3 ?? 0);
  player.helium3 = (player.helium3 ?? 0) - spent;
  return spent;
}
