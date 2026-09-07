import type { EraId, EraModifiers, GameState } from '../../types';
import { resolvePlayerEraId } from '../eraAdvancement/constants';

/**
 * Each era's signature rule — the doctrine you fight under while you are in it.
 *
 * These are set on `GameState.era_modifiers` at game creation from the game's
 * STARTING era, and nothing ever moved them again. In an era-advancement game
 * that meant the world never changed: a player who climbed Ancient → Modern
 * still had `legion_reroll` and never got `precision_strike`, because the game
 * started in Ancient. `getPlayerEraModifiers` below is what makes advancing
 * change the rules you play by; `state.era_modifiers` remains the answer for
 * every game with advancement switched off.
 *
 * The Space Age has no era modifier: its signature is orbit gating
 * (state/moonAccess.ts), not a doctrine flag.
 */
export const ERA_DEFAULTS: Partial<Record<EraId, EraModifiers>> = {
  ancient:      { legion_reroll: true },
  medieval:     {},
  discovery:    { sea_lanes: true },
  ww2:          { wartime_logistics: true },
  coldwar:      { influence_spread: true, influence_range: 1 },
  modern:       { precision_strike: true },
  acw:          { rifle_doctrine: true },
  risorgimento: { carbonari_network: true, influence_range: 1 },
  space_age:    {},
  galaxy_age:   {},
};

/** A fresh copy of one era's modifiers — never the shared literal. */
export function eraModifiersFor(eraId: EraId): EraModifiers {
  return { ...(ERA_DEFAULTS[eraId] ?? {}) };
}

/**
 * The era doctrine a given player currently fights under.
 *
 * With era advancement OFF this is exactly `state.era_modifiers` — every game
 * that does not climb behaves as it always has. With it ON, each player's
 * modifiers come from the era they have personally reached, so two players in
 * the same match can be under different rules. That asymmetry is the point:
 * it is what "the world changes as history advances" means at the rules layer,
 * and until now it was the one part of advancing that changed nothing.
 *
 * Modifiers SWAP rather than accumulate — you fight under your era's doctrine,
 * not every doctrine you have ever held. What carries forward from previous
 * eras is the tech echo (`era_advancement_tech_echo`), which is separately
 * modelled and decays.
 */
export function getPlayerEraModifiers(
  state: GameState,
  playerId: string | null | undefined,
): EraModifiers {
  if (!state.settings.era_advancement_enabled) return state.era_modifiers ?? {};
  if (!playerId) return state.era_modifiers ?? {};
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return state.era_modifiers ?? {};
  return eraModifiersFor(resolvePlayerEraId(state, player));
}
