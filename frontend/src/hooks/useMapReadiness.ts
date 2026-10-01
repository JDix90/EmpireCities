import { useEffect, type MutableRefObject } from 'react';

/**
 * What the turn-ready ack (B-06) waits for on screen. The 2D map and the galaxy
 * chart draw at once, and so does Split in the 2D view, its panes flat maps.
 * The globe reports when it is ready through react-globe.gl's onGlobeReady, once
 * for each globe that mounts; Split in the Globe view reports once every pane's
 * globe is drawn (GalaxySplitView).
 */
export type MapReadinessSurface = 'instant' | 'globe';

/**
 * The surface the game page shows, or null before the map has loaded.
 * `galaxyChart`: a galaxy board is showing its chart, every world at once with
 * no globe. Split is not the chart: in the Globe view its panes are globes.
 */
export function mapReadinessSurface(
  mapData: { map_id: string; map_kind?: string } | null | undefined,
  mapView: '2d' | 'globe',
  galaxyChart: boolean,
): MapReadinessSurface | null {
  if (!mapData) return null;
  if (mapView === '2d') return 'instant';
  if (mapData.map_kind === 'galaxy' && galaxyChart) return 'instant';
  return 'globe';
}

/**
 * Keeps the turn-ready ack's readiness flag in step with the surface on screen.
 * A surface that draws at once is ready at once, and `onReady` runs. A globe
 * that has just been shown is not ready until its onGlobeReady; the caller
 * wires that to set the flag.
 *
 * This is keyed on the surface, not on the map object. A map that changes under
 * a live globe (a Launch Pad lane, a territory unlock, a board transform) does
 * not remount the globe, so onGlobeReady does not fire again. Marking the globe
 * not ready on those changes stopped the ack for the rest of the game.
 */
export function useMapReadiness(
  surface: MapReadinessSurface | null,
  readyRef: MutableRefObject<boolean>,
  onReady: () => void,
): void {
  useEffect(() => {
    if (!surface) return;
    if (surface === 'instant') {
      readyRef.current = true;
      onReady();
    } else {
      readyRef.current = false;
    }
  }, [surface, readyRef, onReady]);
}
