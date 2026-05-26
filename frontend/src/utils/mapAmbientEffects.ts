/** Ambient (non-event) map polish: phase tint, turn-holder glow, contested borders. */

export type AmbientGamePhase = 'draft' | 'attack' | 'fortify' | 'territory_select' | 'game_over' | string;

export interface ContestedBorder {
  fromId: string;
  toId: string;
  sea: boolean;
}

const PHASE_TINT_CLASS: Record<string, string> = {
  draft: 'map-phase-tint-draft',
  attack: 'map-phase-tint-attack',
  fortify: 'map-phase-tint-fortify',
};

/** CSS class for a subtle phase-colored overlay on the map container. */
export function phaseTintClass(phase: AmbientGamePhase | undefined, enabled: boolean): string | undefined {
  if (!enabled || !phase) return undefined;
  return PHASE_TINT_CLASS[phase];
}

export function turnHolderTerritoryIds(
  territories: Record<string, { owner_id?: string | null }>,
  currentPlayerId: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!currentPlayerId) return ids;
  for (const [tid, t] of Object.entries(territories)) {
    if (t.owner_id === currentPlayerId) ids.add(tid);
  }
  return ids;
}

/** Enemy-adjacent frontiers for the current turn holder during attack phase. */
export function computeContestedBorders(
  territories: Record<string, { owner_id?: string | null }>,
  connections: Array<{ from: string; to: string; type?: string }>,
  currentPlayerId: string | null | undefined,
  phase: AmbientGamePhase | undefined,
): ContestedBorder[] {
  if (!currentPlayerId || phase !== 'attack') return [];

  const owned = turnHolderTerritoryIds(territories, currentPlayerId);
  if (owned.size === 0) return [];

  const seen = new Set<string>();
  const out: ContestedBorder[] = [];

  for (const conn of connections) {
    const aOwned = owned.has(conn.from);
    const bOwned = owned.has(conn.to);
    if (aOwned === bOwned) continue;

    const fromId = aOwned ? conn.from : conn.to;
    const toId = aOwned ? conn.to : conn.from;
    const neighborOwner = territories[toId]?.owner_id;
    if (!neighborOwner || neighborOwner === currentPlayerId) continue;

    const key = [fromId, toId].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      fromId,
      toId,
      sea: conn.type === 'sea' || conn.type === 'orbit',
    });
  }

  return out;
}

export const MAP_VISUAL_KIND_LABEL: Record<string, string> = {
  reinforce: 'Reinforcements',
  combat: 'Combat',
  capture: 'Capture',
  fortify: 'Fortify',
  strike: 'Strike',
  naval: 'Naval combat',
  influence: 'Influence',
  event: 'Event',
};
