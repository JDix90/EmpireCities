import { useEffect, useState } from 'react';
import { applyFrameBudget, frameCapFor, type FrameBudgetTier } from '../utils/frameBudget';
import { createHeatGovernor, defaultHeatSource, type HeatSource } from '../utils/deviceHeat';
import { isPhoneLayout } from '../utils/device';
import { isBatterySaver, subscribeUserPreferences } from '../utils/userPreferences';

export interface FrameBudgetState {
  /** The budget is on: a phone layout, or battery saver on any device. */
  active: boolean;
  tier: FrameBudgetTier | null;
  /** The frame rate the maps are held to, which the globe tunes its damping for. */
  fps: number;
  /** The reduced tier: 20 fps, and Lite mode's visual rules on top. */
  reduced: boolean;
  /** Reduced because the phone reported heat, rather than by battery saver. */
  heatSteppedDown: boolean;
}

/**
 * Whether the device's heat reports currently call for stepping down
 * (utils/deviceHeat.ts). Listens only while `enabled`, and reads false when a
 * device reports nothing.
 */
export function useHeatStepDown(enabled: boolean, source: HeatSource | null): boolean {
  const [stepped, setStepped] = useState(false);
  useEffect(() => {
    if (!enabled || !source) {
      setStepped(false);
      return undefined;
    }
    const governor = createHeatGovernor({ onChange: setStepped });
    const stop = source.subscribe((level) => governor.report(level));
    return () => {
      stop();
      governor.dispose();
    };
  }, [enabled, source]);
  return enabled && stepped;
}

/**
 * The frame budget for the game page (docs/MOBILE_UX_PLAN.md M-13), applied
 * to the document while the page is open:
 *
 * - a phone layout gets the standard tier, 30 fps;
 * - a phone that reports serious or critical heat steps down to the reduced
 *   tier, 20 fps with Lite mode's visuals, and back up once it has cooled;
 * - battery saver puts any device on the reduced tier, desktop included.
 */
export function useFrameBudget(opts: {
  phoneLayout: boolean;
  batterySaver: boolean;
  /** Injected in tests; the page uses the device's own source. */
  heatSource?: HeatSource | null;
}): FrameBudgetState {
  const { phoneLayout, batterySaver } = opts;
  const active = phoneLayout || batterySaver;
  // Heat only matters where the phone budget is on and battery saver has not
  // already reduced it; nothing listens otherwise.
  const heatSteppedDown = useHeatStepDown(
    phoneLayout && !batterySaver,
    opts.heatSource === undefined ? defaultHeatSource() : opts.heatSource,
  );
  const reduced = active && (batterySaver || heatSteppedDown);
  const tier: FrameBudgetTier | null = !active ? null : reduced ? 'reduced' : 'standard';
  useEffect(() => (tier ? applyFrameBudget(tier) : undefined), [tier]);
  return { active, tier, fps: frameCapFor(tier ?? 'standard'), reduced, heatSteppedDown };
}

/**
 * The frame budget for a page that watches a game rather than plays it
 * (spectating, replays; docs/MOBILE_UX_PLAN.md M-14). The same tiers as the
 * game page, for a page that does not already track the phone layout and the
 * battery saver setting: this follows both itself.
 */
export function usePageFrameBudget(opts: { heatSource?: HeatSource | null } = {}): FrameBudgetState {
  const [phoneLayout, setPhoneLayout] = useState(() => isPhoneLayout());
  const [batterySaver, setBatterySaverOn] = useState(() => isBatterySaver());
  useEffect(() => {
    const sync = () => setPhoneLayout(isPhoneLayout());
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  useEffect(() => subscribeUserPreferences(() => setBatterySaverOn(isBatterySaver())), []);
  return useFrameBudget({ phoneLayout, batterySaver, heatSource: opts.heatSource });
}
