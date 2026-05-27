import type { MapVisualEvent } from './mapVisualEvents';

/** Snapshot diff can usually infer these animation types. */
export const REPLAY_MAP_FX_LIMITATIONS = [
  'Captures and ownership changes',
  'Reinforcement increases',
  'Combat unit losses',
] as const;

/** Not inferred from turn snapshots — may not animate in replay. */
export const REPLAY_MAP_FX_NOT_INFERRED = [
  'Tech strikes',
  'Event cards',
  'Naval combat',
  'Fortify transfers',
] as const;

interface ReplayTerritoryState {
  owner_id?: string | null;
  unit_count: number;
}

interface ReplayPlayer {
  player_id: string;
  color: string;
}

interface ReplaySnapshotState {
  territories: Record<string, ReplayTerritoryState>;
  players: ReplayPlayer[];
}

/** Infer map visual events from consecutive replay snapshots (best-effort v1). */
export function diffReplayMapVisuals(
  prev: ReplaySnapshotState | null | undefined,
  next: ReplaySnapshotState,
): Omit<MapVisualEvent, 'id'>[] {
  if (!prev) return [];

  const colorByPlayer = new Map(next.players.map((p) => [p.player_id, p.color]));
  const events: Omit<MapVisualEvent, 'id'>[] = [];
  const handledCapture = new Set<string>();

  for (const [tid, tState] of Object.entries(next.territories)) {
    const prevT = prev.territories[tid];
    if (!prevT) continue;

    if (prevT.owner_id !== tState.owner_id && tState.owner_id) {
      handledCapture.add(tid);
      events.push({
        kind: 'capture',
        territoryId: tid,
        captured: true,
        newOwnerColor: colorByPlayer.get(tState.owner_id),
        defenderColor: prevT.owner_id ? colorByPlayer.get(prevT.owner_id) : undefined,
        playerColor: colorByPlayer.get(tState.owner_id),
      });
      continue;
    }

    if (handledCapture.has(tid)) continue;

    if (
      prevT.owner_id &&
      prevT.owner_id === tState.owner_id &&
      tState.unit_count > prevT.unit_count
    ) {
      events.push({
        kind: 'reinforce',
        territoryId: tid,
        units: tState.unit_count - prevT.unit_count,
        totalAfter: tState.unit_count,
        playerId: tState.owner_id,
        playerColor: colorByPlayer.get(tState.owner_id),
      });
      continue;
    }

    if (
      prevT.owner_id === tState.owner_id &&
      tState.unit_count < prevT.unit_count
    ) {
      events.push({
        kind: 'combat',
        territoryId: tid,
        defenderLosses: prevT.unit_count - tState.unit_count,
        defenderColor: tState.owner_id ? colorByPlayer.get(tState.owner_id) : undefined,
      });
    }
  }

  return events;
}
