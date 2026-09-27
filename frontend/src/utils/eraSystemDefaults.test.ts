import { describe, it, expect } from 'vitest';
import {
  transitionEraSystemDefaults,
  missingEraSystemsWarning,
  lockedSystemsForEra,
  lockedEraSystemsNotice,
  requiredSystemsForEra,
  withRequiredEraSystems,
} from './eraSystemDefaults';

const off = { economy: false, tech_trees: false, factions: false };
const on = { economy: true, tech_trees: true, factions: true };

describe('requiredSystemsForEra', () => {
  it('requires economy + tech trees for the orbit-gated eras', () => {
    expect(requiredSystemsForEra('space_age')).toEqual(['economy', 'tech_trees']);
    // Galactic Age also needs factions: the one-faction-per-world start only
    // happens when four players each take a different galaxy faction.
    expect(requiredSystemsForEra('galaxy_age')).toEqual(['economy', 'tech_trees', 'factions']);
  });

  it('requires nothing for classic eras', () => {
    for (const era of ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern', 'acw', 'risorgimento']) {
      expect(requiredSystemsForEra(era)).toEqual([]);
    }
  });
});

describe('transitionEraSystemDefaults', () => {
  it('enables missing required systems when selecting Space Age and marks them auto-owned', () => {
    const t = transitionEraSystemDefaults({ nextEra: 'space_age', current: off, autoEnabled: new Set() });
    expect(t.enable).toEqual(['economy', 'tech_trees']);
    expect(t.disable).toEqual([]);
    expect([...t.nextAutoEnabled].sort()).toEqual(['economy', 'tech_trees']);
  });

  it('does not claim ownership of systems the player already enabled by hand', () => {
    const t = transitionEraSystemDefaults({ nextEra: 'space_age', current: on, autoEnabled: new Set() });
    expect(t.enable).toEqual([]);
    expect(t.nextAutoEnabled.size).toBe(0);

    // Switching away later must not revert the player's own choices.
    const back = transitionEraSystemDefaults({ nextEra: 'ww2', current: on, autoEnabled: t.nextAutoEnabled });
    expect(back.disable).toEqual([]);
  });

  it('reverts auto-enabled systems when switching to an era without requirements', () => {
    const enter = transitionEraSystemDefaults({ nextEra: 'space_age', current: off, autoEnabled: new Set() });
    const leave = transitionEraSystemDefaults({ nextEra: 'ww2', current: on, autoEnabled: enter.nextAutoEnabled });
    expect(leave.enable).toEqual([]);
    expect(leave.disable).toEqual(['economy', 'tech_trees']);
    expect(leave.nextAutoEnabled.size).toBe(0);
  });

  it('keeps ownership when hopping between two eras that both require the systems', () => {
    const enter = transitionEraSystemDefaults({ nextEra: 'space_age', current: off, autoEnabled: new Set() });
    const hop = transitionEraSystemDefaults({ nextEra: 'galaxy_age', current: on, autoEnabled: enter.nextAutoEnabled });
    expect(hop.enable).toEqual([]);
    expect(hop.disable).toEqual([]);
    expect([...hop.nextAutoEnabled].sort()).toEqual(['economy', 'tech_trees']);

    // ...and still reverts once the requirement finally goes away.
    const leave = transitionEraSystemDefaults({ nextEra: 'ancient', current: on, autoEnabled: hop.nextAutoEnabled });
    expect(leave.disable).toEqual(['economy', 'tech_trees']);
  });

  it('does not revert a system the player manually re-enabled after unchecking (ownership cleared by caller)', () => {
    // Player unchecked economy while in Space Age (caller removed it from the set),
    // then re-checked it by hand: it stays theirs on the way out.
    const autoEnabled = new Set<'economy' | 'tech_trees'>(['tech_trees']);
    const leave = transitionEraSystemDefaults({ nextEra: 'modern', current: on, autoEnabled });
    expect(leave.disable).toEqual(['tech_trees']);
  });

  it('re-enables a required system the player switched off when re-entering the era', () => {
    const t = transitionEraSystemDefaults({
      nextEra: 'space_age',
      current: { economy: true, tech_trees: false, factions: false },
      autoEnabled: new Set(['economy']),
    });
    expect(t.enable).toEqual(['tech_trees']);
    expect([...t.nextAutoEnabled].sort()).toEqual(['economy', 'tech_trees']);
  });
});

describe('withRequiredEraSystems', () => {
  const quickMatchSettings = {
    turn_timer_seconds: 300,
    card_set_escalating: true,
    diplomacy_enabled: true,
    max_turns: 150,
  };

  it('adds the required system flags when the rotation lands on Space Age', () => {
    const merged = withRequiredEraSystems('space_age', quickMatchSettings);
    expect(merged).toEqual({
      ...quickMatchSettings,
      economy_enabled: true,
      tech_trees_enabled: true,
    });
  });

  it('passes classic eras through untouched — no system keys added', () => {
    const merged = withRequiredEraSystems('ww2', quickMatchSettings);
    expect(merged).toEqual(quickMatchSettings);
    expect('economy_enabled' in merged).toBe(false);
    expect('tech_trees_enabled' in merged).toBe(false);
  });

  it('overrides an explicitly disabled required system (the era cannot function without it)', () => {
    const merged = withRequiredEraSystems('galaxy_age', {
      ...quickMatchSettings,
      economy_enabled: false,
    });
    expect(merged.economy_enabled).toBe(true);
    expect(merged.tech_trees_enabled).toBe(true);
  });

  it('does not mutate the input settings object', () => {
    const input = { ...quickMatchSettings };
    withRequiredEraSystems('space_age', input);
    expect(input).toEqual(quickMatchSettings);
  });
});

describe('missingEraSystemsWarning', () => {
  it('warns when a required system is off for an unlocked era', () => {
    expect(missingEraSystemsWarning('space_age', { economy: true, tech_trees: false, factions: false })).toMatch(/Moon/);
  });

  it('stays quiet when requirements are met or the era has none', () => {
    expect(missingEraSystemsWarning('space_age', on)).toBeNull();
    expect(missingEraSystemsWarning('ww2', off)).toBeNull();
  });

  it('never warns for a locked era — its systems cannot be off, and the notice explains them', () => {
    expect(missingEraSystemsWarning('galaxy_age', off)).toBeNull();
  });
});

describe('locked eras', () => {
  it('locks all three Galactic Age systems, and nothing for any other era', () => {
    expect([...lockedSystemsForEra('galaxy_age')].sort()).toEqual(['economy', 'factions', 'tech_trees']);
    for (const era of ['space_age', 'ancient', 'ww2', 'modern', 'acw']) {
      expect(lockedSystemsForEra(era).size).toBe(0);
    }
  });

  it('shows the Galactic Age explanation up front, and no notice for unlocked eras', () => {
    const notice = lockedEraSystemsNotice('galaxy_age');
    expect(notice).toMatch(/^Galactic Age always plays with Economy & Buildings, Technology Trees and Asymmetric Factions/);
    expect(notice).toMatch(/[Hh]yperspace/);
    // The lock makes the old "without factions" outcome impossible, so the copy no longer describes it.
    expect(notice).not.toMatch(/[Ww]ithout factions/);
    expect(lockedEraSystemsNotice('space_age')).toBeNull();
    expect(lockedEraSystemsNotice('ww2')).toBeNull();
  });
});
