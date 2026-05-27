import { useEffect, useRef, useState } from 'react';
import { inferWorldId } from '@erasofempire/shared';
import { MAP_VISUAL_KIND_LABEL } from '../utils/mapAmbientEffects';
import type { MapVisualEvent } from '../utils/mapVisualEvents';

export interface GalaxyPulseState {
  worldId: string | null;
  key: number;
  label: string | null;
}

interface GalaxyMapData {
  map_kind?: string;
  territories: Array<{ territory_id: string; name?: string; region_id: string }>;
}

/** Pulse galaxy overview world nodes when map visuals target a territory on that world. */
export function useGalaxyMapVisualPulse(
  mapVisualEvents: MapVisualEvent[],
  mapData: GalaxyMapData | null,
  enabled: boolean,
): GalaxyPulseState {
  const keyRef = useRef(0);
  const [pulse, setPulse] = useState<GalaxyPulseState>({
    worldId: null,
    key: 0,
    label: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const latest = mapVisualEvents[mapVisualEvents.length - 1];
    if (!latest || !mapData || mapData.map_kind !== 'galaxy') return;

    const tid = latest.territoryId;
    if (!tid || tid.startsWith('__')) return;

    const terr = mapData.territories.find((t) => t.territory_id === tid);
    if (!terr) return;

    keyRef.current += 1;
    const kindLabel = MAP_VISUAL_KIND_LABEL[latest.kind] ?? latest.kind;
    const terrName = terr.name ?? tid;

    setPulse({
      worldId: inferWorldId(terr),
      key: keyRef.current,
      label: `${kindLabel} — ${terrName}`,
    });
  }, [mapVisualEvents, mapData, enabled]);

  return pulse;
}
