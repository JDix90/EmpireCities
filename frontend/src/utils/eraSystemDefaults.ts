/**
 * Era-aware defaults for the Configure New Game form.
 *
 * Some rules eras have headline mechanics that only function when certain
 * Advanced Features are enabled — most visibly Space Age, whose Moon is
 * reached through the Lunar Expansion tech ladder plus a Launch Pad building.
 * With Economy and Tech Trees left at their off defaults, the Moon is
 * unreachable for every player and the "Control every territory" domination
 * objective can never be met (the 9 lunar territories stay neutral forever).
 *
 * Selecting such an era pre-checks the systems it needs. The player can still
 * switch them back off (the form then shows the era's warning copy), and
 * switching to an era without requirements reverts only the toggles this
 * module enabled — never a choice the player made by hand.
 */

export type EraSystemKey = 'economy' | 'tech_trees';

export const ERA_SYSTEM_KEYS: readonly EraSystemKey[] = ['economy', 'tech_trees'];

interface EraSystemRequirement {
  systems: readonly EraSystemKey[];
  /** Shown in the form when a required system is switched off anyway. */
  warning: string;
}

export const ERA_REQUIRED_SYSTEMS: Record<string, EraSystemRequirement> = {
  space_age: {
    systems: ['economy', 'tech_trees'],
    warning:
      'Space Age needs Economy & Buildings and Technology Trees: Moon access is unlocked by the ' +
      'Lunar Expansion tech ladder plus a Launch Pad building. Without them the Moon is unreachable ' +
      'and full domination is impossible.',
  },
  galaxy_age: {
    systems: ['economy', 'tech_trees'],
    warning:
      'Galactic Age needs Economy & Buildings and Technology Trees: hyperspace travel is unlocked by ' +
      'the Hyperspace Chart tech or the Hyperlane Anchor wonder. Without them rival worlds are unreachable.',
  },
};

export function requiredSystemsForEra(eraId: string): readonly EraSystemKey[] {
  return ERA_REQUIRED_SYSTEMS[eraId]?.systems ?? [];
}

/** Warning copy when the era needs systems that are currently off; null otherwise. */
export function missingEraSystemsWarning(
  eraId: string,
  current: Record<EraSystemKey, boolean>,
): string | null {
  const requirement = ERA_REQUIRED_SYSTEMS[eraId];
  if (!requirement) return null;
  return requirement.systems.some((key) => !current[key]) ? requirement.warning : null;
}

/** Create-API settings key for each system. */
const SYSTEM_SETTING_KEYS = {
  economy: 'economy_enabled',
  tech_trees: 'tech_trees_enabled',
} as const satisfies Record<EraSystemKey, string>;

/**
 * Merge the systems an era requires into a create-game settings payload.
 *
 * For one-click flows that never show the Advanced Features form — Quick
 * Match's random era rotation above all — landing on an orbit-gated era must
 * still produce a game where its headline mechanic works: a Space Age quick
 * match without Economy + Tech Trees has an unreachable Moon and an
 * unwinnable domination objective. Eras without requirements pass through
 * untouched, so classic quick matches stay classic.
 */
export function withRequiredEraSystems<T extends Record<string, unknown>>(
  eraId: string,
  settings: T,
): T & { economy_enabled?: boolean; tech_trees_enabled?: boolean } {
  const required = requiredSystemsForEra(eraId);
  if (required.length === 0) return settings;
  const merged: Record<string, unknown> = { ...settings };
  for (const key of required) merged[SYSTEM_SETTING_KEYS[key]] = true;
  return merged as T & { economy_enabled?: boolean; tech_trees_enabled?: boolean };
}

export interface EraSystemTransition {
  /** Toggles to switch on for the newly selected era. */
  enable: EraSystemKey[];
  /** Auto-enabled toggles to revert now that the era no longer needs them. */
  disable: EraSystemKey[];
  /** Which of the now-on toggles this module owns (i.e. may revert later). */
  nextAutoEnabled: Set<EraSystemKey>;
}

/**
 * Compute toggle changes when the selected rules era changes.
 *
 * `autoEnabled` is the set of systems a previous transition switched on that
 * the player hasn't touched since — only those may be switched back off. A
 * system the player enabled by hand is never auto-marked, so it survives any
 * era change; the caller clears a key from the set when its checkbox is
 * toggled manually.
 */
export function transitionEraSystemDefaults(args: {
  nextEra: string;
  current: Record<EraSystemKey, boolean>;
  autoEnabled: ReadonlySet<EraSystemKey>;
}): EraSystemTransition {
  const required = new Set(requiredSystemsForEra(args.nextEra));
  const enable: EraSystemKey[] = [];
  const disable: EraSystemKey[] = [];
  const nextAutoEnabled = new Set<EraSystemKey>();

  for (const key of ERA_SYSTEM_KEYS) {
    if (required.has(key)) {
      if (!args.current[key]) {
        enable.push(key);
        nextAutoEnabled.add(key);
      } else if (args.autoEnabled.has(key)) {
        // Hopping between two eras that both need it: keep ownership so a
        // later switch to an era without requirements still reverts it.
        nextAutoEnabled.add(key);
      }
    } else if (args.autoEnabled.has(key) && args.current[key]) {
      disable.push(key);
    }
  }

  return { enable, disable, nextAutoEnabled };
}
