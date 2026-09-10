/**
 * Helium-3 — the Space Age lunar economy (Moon Race, Phase 1).
 *
 * The Moon costs four techs and two builds to reach and, before this, paid a
 * +6 region bonus for holding all nine tiles and nothing at all for holding
 * three. Measured over 60 games on the shipped ruleset, the Corporate Enclave
 * faction reached the Moon in 95% of its games with the largest average
 * holding and won 17.5% against a 25% baseline: reaching the Moon was never
 * the bottleneck, profiting from it was.
 *
 * He-3 is the fix. Every owned lunar tile pays every turn, so three tiles is a
 * real position rather than a down payment on nine, and two players sharing
 * the Moon is a live state rather than a failed race.
 *
 * See docs/space-age-moon/README.md §3.
 */

import { inferWorldId } from '@borderfall/shared';
import type { GameState, PlayerState, TerritoryState } from '../../types';

/**
 * The two polar basins yield double. They are the Moon's hubs — North Polar
 * Basin touches three tiles — so making them the richest ground creates a
 * fight *inside* the Moon instead of a sweep across it.
 *
 * Keyed by territory id because these are authored, named places. Any other
 * lunar tile, including one a future map adds, yields the base rate.
 */
export const HELIUM3_POLE_TILES: ReadonlySet<string> = new Set([
  'moon_polar_north',
  'moon_polar_south',
]);

export const HELIUM3_PER_POLE = 2;
export const HELIUM3_PER_TILE = 1;

/**
 * A full Moon pays 11/turn, so an uncontested holder reaches this in under
 * three turns of not spending. The cap exists to stop a hoard becoming a
 * runaway nobody can answer, and to bound what the AI has to plan against.
 */
export const HELIUM3_STOCKPILE_CAP = 30;

/** Most He-3 one Lunar Export converts, 1:1 into tech points. */
export const LUNAR_EXPORT_MAX = 5;

/**
 * Phase 1 is flag-gated and baked into game settings at create, so the engine
 * stays pure and flipping the flag never re-rules a match already in progress.
 */
export function isHelium3Enabled(state: GameState): boolean {
  return state.settings.space_age_moon_helium3_enabled === true;
}

/**
 * Whether a territory is lunar ground.
 *
 * `inferWorldId` rather than a `region_id === 'lunar_surface'` check: territory
 * state denormalizes `region_id` at game start but the field is optional for
 * states snapshotted before that existed, and the shared helper already falls
 * back through `world_id`, `globe_id` and the `moon_` id prefix.
 *
 * The fields are copied across rather than passing the territory straight in:
 * every other caller of `inferWorldId` hands it a MAP territory, whose
 * `region_id` is required, while state's is optional. The helper's body already
 * tolerates the absence — widening the shared interface for this one caller
 * would relax it for the galaxy layout type that extends it too.
 */
export function isLunarTerritory(territory: TerritoryState): boolean {
  return inferWorldId({
    territory_id: territory.territory_id,
    region_id: territory.region_id ?? '',
    world_id: territory.world_id,
    globe_id: territory.globe_id,
  }) === 'moon';
}

/** He-3 a single lunar tile yields per turn. Zero for anything on Earth. */
export function helium3YieldOf(territory: TerritoryState): number {
  if (!isLunarTerritory(territory)) return 0;
  return HELIUM3_POLE_TILES.has(territory.territory_id) ? HELIUM3_PER_POLE : HELIUM3_PER_TILE;
}

/** Lunar tiles this player currently holds. */
export function lunarTerritoriesOwnedBy(state: GameState, playerId: string): TerritoryState[] {
  return Object.values(state.territories).filter(
    (t) => t.owner_id === playerId && isLunarTerritory(t),
  );
}

/** How many lunar tiles this player holds — the gate on the Moon-only powers. */
export function countLunarTerritories(state: GameState, playerId: string): number {
  return lunarTerritoriesOwnedBy(state, playerId).length;
}

/**
 * He-3 per turn before the stockpile cap is applied. Reads state alone, like
 * `collectProduction`, so no call site has to thread the map document through.
 */
export function getHelium3Income(state: GameState, playerId: string): number {
  if (!isHelium3Enabled(state)) return 0;
  return lunarTerritoriesOwnedBy(state, playerId).reduce(
    (sum, t) => sum + helium3YieldOf(t),
    0,
  );
}

/**
 * Credit a player's He-3 at the start of their turn, clamped to the stockpile
 * cap. Returns what was actually credited, which is less than the income when
 * the cap bites — callers report the credited figure so the HUD never shows
 * income the player did not receive.
 */
export function applyHelium3Income(state: GameState, playerId: string): number {
  const income = getHelium3Income(state, playerId);
  if (income <= 0) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return 0;
  const before = player.helium3 ?? 0;
  const after = Math.min(HELIUM3_STOCKPILE_CAP, before + income);
  player.helium3 = after;
  return after - before;
}

export interface LunarExportResult {
  ok: boolean;
  error?: string;
  /** He-3 spent, equal to the tech points gained. */
  converted?: number;
}

/**
 * Lunar Export — Phase 1's sink, so the resource is worth something before the
 * Phase 2 powers exist to spend it on. Converts up to `LUNAR_EXPORT_MAX` He-3
 * into tech points 1:1.
 *
 * Deliberately NOT gated on a tech. Holding lunar ground IS the credential:
 * the Lunar Pioneers faction reaches the Moon from turn one without
 * `sa_lunar_expansion`, and gating the export on that tech would lock the
 * Moon-native faction out of the Moon's own economy.
 */
export function applyLunarExport(state: GameState, playerId: string): LunarExportResult {
  if (!isHelium3Enabled(state)) {
    return { ok: false, error: 'The lunar economy is not enabled in this game' };
  }
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return { ok: false, error: 'Player not found' };
  if (countLunarTerritories(state, playerId) === 0) {
    return { ok: false, error: 'You need a Moon territory to export Helium-3' };
  }
  const available = player.helium3 ?? 0;
  if (available <= 0) return { ok: false, error: 'You have no Helium-3 to export' };

  const converted = Math.min(LUNAR_EXPORT_MAX, available);
  player.helium3 = available - converted;
  player.tech_points = (player.tech_points ?? 0) + converted;
  return { ok: true, converted };
}

/** Per-player He-3 snapshot for the HUD and for sim reporting. */
export function helium3Summary(
  state: GameState,
  player: PlayerState,
): { stock: number; income: number; tiles: number; atCap: boolean } {
  const stock = player.helium3 ?? 0;
  return {
    stock,
    income: getHelium3Income(state, player.player_id),
    tiles: countLunarTerritories(state, player.player_id),
    atCap: stock >= HELIUM3_STOCKPILE_CAP,
  };
}
