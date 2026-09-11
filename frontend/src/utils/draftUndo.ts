/**
 * Where the draft-phase Undo may be offered.
 *
 * `game:draft_undo` only ever reverses the MOST RECENT placement of the turn
 * (see the server handler in gameSocket.ts). Surfacing the button on every
 * territory during a multi-territory draft meant a stray tap on the wrong panel
 * quietly pulled units back out of somewhere else. The territory panel therefore
 * shows Undo only on the territory that last placement landed on — the one
 * whose count the player is looking at.
 */
export interface DraftDeployment {
  territory_id: string;
  units: number;
}

/** The territory the next Undo would revert units from, or null when nothing is undoable. */
export function draftUndoTerritoryId(
  deployments: ReadonlyArray<DraftDeployment> | null | undefined,
): string | null {
  if (!deployments || deployments.length === 0) return null;
  return deployments[deployments.length - 1]?.territory_id ?? null;
}

/** True when Undo belongs on `territoryId`'s panel right now. */
export function canUndoDraftOnTerritory(
  deployments: ReadonlyArray<DraftDeployment> | null | undefined,
  territoryId: string | null | undefined,
): boolean {
  if (!territoryId) return false;
  return draftUndoTerritoryId(deployments) === territoryId;
}
