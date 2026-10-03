// ============================================================
// Orbital infrastructure — buildings on a gateway survive capture
// ============================================================
//
// Galactic Age buildings, Phase 2 (docs/GALACTIC_AGE_BUILDINGS.md §4). The
// galaxy is fought over its gateway tiles — they change hands about 70 times
// a game (GALAXY-BALANCE §2) — and `onTerritoryCapture` razes everything but
// wonders, so the tiles the era is about were the worst tiles to build on.
// Under this rule a gateway's buildings pass to whoever takes it, the way a
// captured Jump Gate end already carries its lane (jumpGates.ts). Interior
// tiles keep today's rule; wonders keep theirs.
//
// Gateway membership is stamped onto state (`TerritoryState.gateway`) when a
// territory enters play — at init and at a Space to Stars unlock — because
// the capture hook holds state and no map. Only the AUTHORED lanes count,
// the set Lane Sovereignty is played on: a Jump Gate, a Lane Surge or a
// Colonies-board bridge (`source`-tagged) does not make a tile a gateway.
//
// Gated by `settings.galaxy_orbital_buildings`, baked at create from the
// `galaxy_orbital_buildings_enabled` flag, so a flip never re-rules a match
// in progress. Off, nothing here is read and no territory carries the stamp.

import type { GameMap, GameState, TerritoryState } from '../../types';
import { authoredLanes } from './galaxyRing';

/** True when this game plays the orbital-infrastructure rule. */
export function orbitalBuildingsEnabled(state: Pick<GameState, 'settings'>): boolean {
  return state.settings?.galaxy_orbital_buildings === true;
}

/** Both ends of every authored orbit lane: the tiles the rule applies to. */
export function authoredGatewayTerritoryIds(map: GameMap): Set<string> {
  const ids = new Set<string>();
  for (const c of authoredLanes(map)) {
    ids.add(c.from);
    ids.add(c.to);
  }
  return ids;
}

/**
 * Mark the gateway tiles among `territories` (in place). Territories not yet in
 * play are simply absent and get their stamp when they arrive. Idempotent.
 */
export function stampGatewayTerritories(
  territories: Record<string, TerritoryState>,
  map: GameMap,
  gateways: Set<string> = authoredGatewayTerritoryIds(map),
): void {
  for (const id of gateways) {
    const t = territories[id];
    if (t) t.gateway = true;
  }
}

/** Does a capture of `territory` leave its buildings standing for the captor? */
export function buildingsSurviveCapture(
  state: Pick<GameState, 'settings'>,
  territory: Pick<TerritoryState, 'gateway'>,
): boolean {
  return orbitalBuildingsEnabled(state) && territory.gateway === true;
}
