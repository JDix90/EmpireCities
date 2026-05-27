import type { EventCard } from '../components/game/EventCardModal';
import type { MapVisualEvent } from './mapVisualEvents';

/** Client-side mirror of backend buildEventMapVisual for reconnect backup. */
export function buildMapVisualFromEventCard(
  card: EventCard,
): Omit<MapVisualEvent, 'id'> | null {
  const summary = card.result_summary;
  if (!summary?.length) return null;

  const isGlobal = summary.some((row) => row.territory_id === '__global__');
  const draftRow = summary.find((row) => row.territory_id === '__draft_pool__');
  const mapTerritories = summary.filter(
    (row) => row.territory_id && !row.territory_id.startsWith('__'),
  );

  if (!isGlobal && mapTerritories.length === 0 && !draftRow) return null;

  const primaryTerritoryId = mapTerritories[0]?.territory_id ?? '__global__';

  return {
    kind: 'event',
    territoryId: primaryTerritoryId,
    variant: card.effect?.type ?? card.card_id,
    cardId: card.card_id,
    regionId: card.effect?.target === 'region' ? card.effect.target_id : undefined,
    global: isGlobal,
    affectedTerritories: mapTerritories.length > 0
      ? mapTerritories.map((row) => ({ territory_id: row.territory_id, delta: row.delta }))
      : undefined,
    units: draftRow?.delta,
  };
}

/** Push a local map visual when server event was missed (reconnect / tab background). */
export function scheduleEventCardMapVisualBackup(
  card: EventCard,
  hasServerVisual: (cardId: string) => boolean,
  pushLocal: (payload: Omit<MapVisualEvent, 'id'> & { id?: string }) => void,
  seenCardIds: Set<string>,
  delayMs = 200,
): void {
  if (!card.result_summary?.length) return;
  const cardId = card.card_id;
  window.setTimeout(() => {
    if (seenCardIds.has(cardId)) return;
    if (hasServerVisual(cardId)) {
      seenCardIds.add(cardId);
      return;
    }
    const local = buildMapVisualFromEventCard(card);
    if (!local) return;
    seenCardIds.add(cardId);
    pushLocal({ ...local, id: `event-backup-${cardId}` });
  }, delayMs);
}

export function markEventCardVisualSeen(
  payload: MapVisualEvent,
  seenCardIds: Set<string>,
): void {
  if (payload.kind === 'event' && payload.cardId) {
    seenCardIds.add(payload.cardId);
  }
}
