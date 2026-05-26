import { useCallback, useRef, useState } from 'react';
import type { MapVisualEvent } from '../utils/mapVisualEvents';
import { normalizeMapVisualEvent } from '../utils/mapVisualEvents';

export interface UseMapVisualEventsResult {
  mapVisualEvents: MapVisualEvent[];
  /** @deprecated Use mapVisualEvents — kept for GlobeMap prop compatibility during migration */
  globeEvents: Array<MapVisualEvent & { type: MapVisualEvent['kind']; strikeAbilityId?: string }>;
  handleMapVisualEvent: (payload: Omit<MapVisualEvent, 'id'> & { id?: string }) => void;
  /** Push a local event (replay diff inference — no socket). */
  pushMapVisualLocal: (payload: Omit<MapVisualEvent, 'id'> & { id?: string }) => void;
  onMapVisualDone: (eventId: string) => void;
  clearMapVisuals: () => void;
}

/** Queue map visual events from server broadcasts for globe + 2D renderers. */
export function useMapVisualEvents(): UseMapVisualEventsResult {
  const [events, setEvents] = useState<MapVisualEvent[]>([]);
  const counterRef = useRef(0);

  const enqueue = useCallback((payload: Omit<MapVisualEvent, 'id'> & { id?: string }) => {
    const id = payload.id ?? `mv-local-${++counterRef.current}-${Date.now()}`;
    const normalized = normalizeMapVisualEvent({ ...payload, id });
    setEvents((prev) => [...prev, normalized]);
  }, []);

  const handleMapVisualEvent = useCallback((payload: Omit<MapVisualEvent, 'id'> & { id?: string }) => {
    enqueue(payload);
  }, [enqueue]);

  const pushMapVisualLocal = handleMapVisualEvent;

  const onMapVisualDone = useCallback((eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  }, []);

  const clearMapVisuals = useCallback(() => {
    setEvents([]);
  }, []);

  const globeEvents = events.map((e) => ({
    ...e,
    type: e.kind,
    strikeAbilityId: e.kind === 'strike' ? e.variant : undefined,
  }));

  return {
    mapVisualEvents: events,
    globeEvents,
    handleMapVisualEvent,
    pushMapVisualLocal,
    onMapVisualDone,
    clearMapVisuals,
  };
}
