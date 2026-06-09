import {
  CONNECTION_HINT_LABELS,
  getConnectionHintPreference,
  setConnectionHintPreference,
  type ConnectionHintPreference,
} from './userPreferences';

export type { ConnectionHintPreference };
export { CONNECTION_HINT_LABELS, getConnectionHintPreference };
export const persistConnectionHintPreference = setConnectionHintPreference;

/** Effective rendering mode after applying user preference and map context. */
export type ResolvedConnectionHintMode = 'full' | 'borders' | 'off';

export function resolveConnectionHintMode(options: {
  preference: ConnectionHintPreference;
  isDenseMap: boolean;
  reducedEffects?: boolean;
  /** Globe arc overlays steal clicks more often than the 2D map. */
  globeView?: boolean;
}): ResolvedConnectionHintMode {
  const { preference, isDenseMap, reducedEffects = false, globeView = false } = options;

  switch (preference) {
    case 'off':
      return 'off';
    case 'borders':
      return 'borders';
    case 'full':
      return 'full';
    case 'auto':
    default:
      if (reducedEffects || isDenseMap || globeView) return 'borders';
      return 'full';
  }
}

/** Whether animated / pickable connection arcs should render. */
export function shouldRenderConnectionArcs(mode: ResolvedConnectionHintMode): boolean {
  return mode === 'full';
}

/** Whether territory border highlights should emphasize valid neighbors. */
export function shouldEmphasizeAdjacencyBorders(mode: ResolvedConnectionHintMode): boolean {
  return mode === 'borders' || mode === 'off';
}
