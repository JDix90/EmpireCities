import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GALAXY_THRESHOLD_STEPS, GALAXY_THRESHOLD_STEP_IDS } from './modules/galaxyThresholdSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES } from './types';
import { phaseAdvanceLabel } from '../constants/phaseLabels';
import { mapControlProgress } from '../utils/mapControl';
import type { GameState } from '../store/gameStore';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string }>;
  connections: Array<{ from: string; to: string; type: string }>;
};

/** The lesson's board as the meter reads it: `held` of the galaxy's systems, at the lesson's 60%. */
function meterOn(held: number) {
  const territories: Record<string, { owner_id: string | null }> = {};
  galaxy.territories.forEach((t, i) => {
    territories[t.territory_id] = { owner_id: i < held ? 'me' : null };
  });
  const state = {
    settings: { allowed_victory_conditions: ['domination', 'threshold'], victory_threshold: 60 },
    territories,
    players: [{ player_id: 'me', territory_count: held, is_eliminated: false }],
  } as unknown as GameState;
  return mapControlProgress(state, 'me')!;
}

describe('Galactic Age · Territory Threshold lesson', () => {
  const byId = (id: string) => GALAXY_THRESHOLD_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''} ${step?.whyItMatters ?? ''}`;
  };
  const nameOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.name]));
  const worldName = (id: string) => galaxy.worlds.find((w) => w.world_id === id)!.display_name;

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_THRESHOLD_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_THRESHOLD_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gth_')).toBe(true);
  });

  it('is registered as a flag-gated galaxy lesson that completes on the win', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_threshold');
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBe(true);
    expect(GALAXY_TUTORIAL_MODULE_IDS).toContain('galaxy_threshold');
    expect(getTutorialSteps('galaxy_threshold')).toBe(GALAXY_THRESHOLD_STEPS);
  });

  it('gates on the draft, the one capture that matters, and the win', () => {
    for (const step of GALAXY_THRESHOLD_STEPS) {
      if (step.requireAction) expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
    expect(GALAXY_THRESHOLD_STEPS.map((s) => s.requireAction).filter(Boolean)).toEqual([
      'end_phase', 'territory_captured', 'game_won',
    ]);
    expect(byId('gth_draft')?.targetTerritoryId).toBe('verdan_saffron_mire');
    expect(byId('gth_take')?.targetTerritoryId).toBe('verdan_spore_reach');
  });

  it('names the systems and worlds as the board labels them, with the attack by ground', () => {
    const source = nameOf.get('verdan_saffron_mire')!;
    const target = nameOf.get('verdan_spore_reach')!;
    const link = galaxy.connections.find(
      (c) => (c.from === 'verdan_saffron_mire' && c.to === 'verdan_spore_reach')
        || (c.from === 'verdan_spore_reach' && c.to === 'verdan_saffron_mire'),
    );
    expect(link).toBeDefined();
    expect(link?.type).not.toBe('orbit');
    for (const id of ['gth_draft', 'gth_take']) {
      expect(text(id)).toContain(source);
      expect(text(id)).toContain(target);
    }
    expect(text('gth_take')).toMatch(/ground attack/);
    expect(text('gth_take')).toMatch(/full 3 dice/);
    const last = GALAXY_THRESHOLD_STEPS[GALAXY_THRESHOLD_STEPS.length - 1];
    for (const name of [source, target]) expect(last.skippedMessage).toContain(name);
    for (const w of ['sol', 'verdan', 'rust', 'nexus_station']) {
      expect(text('gth_welcome')).toContain(worldName(w));
    }
  });

  it('carries the numbers the meter will show, recomputed from the map and the tracker', () => {
    const total = galaxy.territories.length;
    // One short: the lesson opens on needed − 1, the need being the tracker's own ceil.
    const opening = meterOn(meterOn(0).needed - 1);
    expect(opening).toMatchObject({ total: 64, needed: 39, held: 38, heldPct: 59, remaining: 1, thresholdPct: 60 });
    const meter = text('gth_meter');
    // The top-bar chip and the Objectives entry, as MapControlTracker renders them.
    expect(meter).toContain(`${opening.heldPct}%/${opening.thresholdPct}%`);
    expect(meter).toContain(`Map control: ${opening.heldPct}% of ${opening.thresholdPct}% · ${opening.held} of ${opening.needed} territories`);
    expect(meter).toContain(`Hold ${opening.thresholdPct}% of the map — ${opening.needed} of its ${opening.total} territories — to win. ${opening.remaining} more to go.`);
    expect(text('gth_welcome')).toContain(`60% of ${total} is ${(total * 60) / 100}`);
    expect(text('gth_welcome')).toContain(`needs **${opening.needed}**`);
    // Won: the 39th system taken.
    const won = meterOn(opening.needed);
    expect(won).toMatchObject({ held: 39, heldPct: 60, remaining: 0 });
    expect(text('gth_win')).toContain(`${won.heldPct}% of ${won.thresholdPct}% · ${won.held} of ${won.needed} territories`);
    const last = GALAXY_THRESHOLD_STEPS[GALAXY_THRESHOLD_STEPS.length - 1];
    expect(last.skippedMessage).toContain(`${opening.held} of the ${opening.needed}`);
  });

  it('teaches the threshold rules the engine applies', () => {
    const rules = text('gth_meter');
    expect(rules).toMatch(/rounded down/);
    expect(rules).toMatch(/Judged from round 2/);
    expect(rules).toMatch(/side's systems count together/);
    expect(rules).toMatch(/75%/);
    expect(text('gth_welcome')).toMatch(/every\*\* system/);
    expect(text('gth_welcome')).toMatch(/neutral colonies included/);
    expect(text('gth_welcome')).toMatch(/90-turn limit/);
    expect(text('gth_draft')).toMatch(/a third of its listed value at two/);
    expect(text('gth_draft')).toMatch(/above 12 by one unit each round/);
  });

  it('names real controls and the phase buttons', () => {
    expect(text('gth_meter')).toContain('Objectives');
    expect(text('gth_meter')).toContain('Status tab');
    expect(text('gth_draft')).toContain(phaseAdvanceLabel('draft'));
    expect(text('gth_win')).toContain(phaseAdvanceLabel('attack'));
    expect(text('gth_win')).toContain(phaseAdvanceLabel('fortify'));
    expect(text('gth_take')).toContain('Attack until captured');
    expect(byId('gth_draft')?.cardPosition).toBe('aside');
    expect(byId('gth_take')?.cardPosition).toBe('aside');
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_THRESHOLD_STEPS[0].skippable).toBe(true);
    expect(isTutorialStepCentered(byId('gth_welcome'))).toBe(true);
    expect(isTutorialStepCentered(byId('gth_meter'))).toBe(true);
    const last = GALAXY_THRESHOLD_STEPS[GALAXY_THRESHOLD_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
    expect(last.skippedMessage!.toLowerCase()).not.toMatch(/you took|you crossed/);
    expect(last.skippedMessage).toContain(phaseAdvanceLabel('draft'));
    const lastGate = GALAXY_THRESHOLD_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBe(GALAXY_THRESHOLD_STEPS.length - 2);
  });
});
