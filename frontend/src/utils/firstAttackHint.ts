/**
 * The suggested first attack (`first_attack_hint_enabled`): in a first match's
 * attack phase, until the player has made an attack, the coach tip names one
 * attack (where from, what at, how many against how many) and the map rings
 * the territory to tap.
 *
 * The attack tip asked the player to judge a move ("Tap your biggest stack,
 * then tap a neighbour with fewer units"). In first matches, about a third of
 * desktop players and half of phone players who reached the attack phase then
 * left without touching anything: no territory opened, no turn ended. This
 * makes the choice for them, so the first attack is one move to take rather
 * than one to work out.
 */
import type { GameState } from '../store/gameStore';
import { canAttackFrom, listNeighborTargets, type MapConnection } from './mapAdjacencyTargets';
import { trucePartnerOwning } from './truces';

export interface FirstAttackHint {
  fromId: string;
  fromName: string;
  fromUnits: number;
  toId: string;
  toName: string;
  toUnits: number;
}

/** Which end of the suggested attack the player has open: its source, its target, or neither. */
export type FirstAttackOpen = 'from' | 'to' | null;

/** The stronger suggestion of two: the bigger margin, then the bigger stack, then the weaker target, then by name. */
function better(a: FirstAttackHint, b: FirstAttackHint): boolean {
  const margin = (a.fromUnits - a.toUnits) - (b.fromUnits - b.toUnits);
  if (margin !== 0) return margin > 0;
  if (a.fromUnits !== b.fromUnits) return a.fromUnits > b.fromUnits;
  if (a.toUnits !== b.toUnits) return a.toUnits < b.toUnits;
  return a.fromName.localeCompare(b.fromName) < 0
    || (a.fromName === b.fromName && a.toName.localeCompare(b.toName) < 0);
}

/**
 * The attack to suggest, or null when there is none worth suggesting.
 *
 * Every candidate is a row the territory panel itself offers
 * (`listNeighborTargets`), so the suggestion is never an attack the server
 * refuses: no sea crossing without a fleet, no side protected by a team
 * ceasefire. It must also be a fair fight to start with: the source
 * outnumbers the target, as the tip it replaces asks. Targets behind a truce
 * (attacking one breaks it), off-world targets and hidden garrisons are left
 * out.
 */
export function suggestFirstAttack(
  gameState: GameState | null | undefined,
  connections: MapConnection[],
  viewerId: string | null | undefined,
  territoryNames: Map<string, string>,
): FirstAttackHint | null {
  if (!gameState || !viewerId || gameState.phase !== 'attack') return null;
  let best: FirstAttackHint | null = null;
  for (const [fromId, from] of Object.entries(gameState.territories)) {
    if (!canAttackFrom(gameState, fromId, viewerId)) continue;
    const fromUnits = from.unit_count ?? 0;
    for (const row of listNeighborTargets(gameState, connections, fromId, territoryNames, { attackSource: fromId })) {
      if (row.needsFleet || row.isOrbit || row.unitCount < 0) continue;
      if (fromUnits <= row.unitCount) continue;
      if (trucePartnerOwning(gameState, viewerId, row.territoryId)) continue;
      const candidate: FirstAttackHint = {
        fromId,
        fromName: territoryNames.get(fromId) ?? fromId,
        fromUnits,
        toId: row.territoryId,
        toName: row.name,
        toUnits: row.unitCount,
      };
      if (!best || better(candidate, best)) best = candidate;
    }
  }
  return best;
}

/** Which end of the suggestion the player has open in the territory panel. */
export function firstAttackOpen(
  hint: FirstAttackHint,
  selectedTerritory: string | null | undefined,
  attackSource: string | null | undefined,
): FirstAttackOpen {
  if (selectedTerritory === hint.toId) return 'to';
  if (selectedTerritory === hint.fromId || attackSource === hint.fromId) return 'from';
  return null;
}

/**
 * The coach tip for the suggestion, following the panel: with the source
 * open its attack rows list the target, with the target open the panel offers
 * "Attack from <source>".
 */
export function firstAttackTipText(hint: FirstAttackHint, open: FirstAttackOpen): string {
  if (open === 'from') return `Tap ${hint.toName} in the panel to attack it.`;
  if (open === 'to') return `Press Attack from ${hint.fromName}.`;
  // The ring is a pointer, not something to promise: it is a thin pulse, and
  // on a hot phone the globe holds it still. The numbers match the army counts.
  return `Attack ${hint.toName} from ${hint.fromName}: your ${hint.fromUnits} against their ${hint.toUnits}. Tap ${hint.fromName}.`;
}

/** The territory the map rings: the source until it is open, then the target. */
export function firstAttackRingId(hint: FirstAttackHint, open: FirstAttackOpen): string {
  return open ? hint.toId : hint.fromId;
}
