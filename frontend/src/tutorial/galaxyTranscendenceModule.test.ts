import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GALAXY_TRANSCENDENCE_STEPS,
  GALAXY_TRANSCENDENCE_STEP_IDS,
} from './modules/galaxyTranscendenceSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES } from './types';
import { ERA_WONDERS } from '../constants/eraWonders';
import { phaseAdvanceLabel } from '../constants/phaseLabels';

/** The board the lesson plays on; the cards name its systems and worlds. */
const board = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_ascension_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string }>;
};

describe('Galactic Age · Transcendence lesson', () => {
  const byId = (id: string) => GALAXY_TRANSCENDENCE_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''}`;
  };
  const nameOf = new Map(board.territories.map((t) => [t.territory_id, t.name]));

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_TRANSCENDENCE_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_TRANSCENDENCE_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gtr_')).toBe(true);
  });

  it('is registered as a flag-gated galaxy lesson that completes on the win', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_transcendence');
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBe(true);
    expect(GALAXY_TUTORIAL_MODULE_IDS).toContain('galaxy_transcendence');
    expect(getTutorialSteps('galaxy_transcendence')).toBe(GALAXY_TRANSCENDENCE_STEPS);
  });

  it('only uses gates the game actually advances on, in the order the climb happens', () => {
    for (const step of GALAXY_TRANSCENDENCE_STEPS) {
      if (step.requireAction) expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
    expect(GALAXY_TRANSCENDENCE_STEPS.map((s) => s.requireAction).filter(Boolean)).toEqual([
      'tech_researched',
      'building_built',
      'era_advanced',
      'galaxy_chart_opened',
      'wonder_built',
      'game_won',
    ]);
    expect(byId('gtr_research')?.actionOpenTechTree).toBe(true);
  });

  it('names the systems it points at as the board labels them', () => {
    expect(byId('gtr_build')?.targetTerritoryId).toBe('oc_australia');
    expect(text('gtr_build')).toContain(nameOf.get('oc_australia')!);
    expect(text('gtr_research')).toContain(nameOf.get('africa_south')!);
    const arrive = text('gtr_arrive');
    for (const w of board.worlds.filter((w) => !['earth', 'moon'].includes(w.world_id))) {
      expect(arrive).toContain(w.display_name);
    }
  });

  it('names the wonder the galaxy era defines, at its cost', () => {
    const anchor = ERA_WONDERS.galaxy_age;
    expect(text('gtr_wonder')).toContain(anchor.name);
    expect(text('gtr_wonder')).toContain(`${anchor.cost} PP`);
    expect(GALAXY_TRANSCENDENCE_STEPS[GALAXY_TRANSCENDENCE_STEPS.length - 1].skippedMessage).toContain(anchor.name);
  });

  it('teaches the real gate and the real costs of advancing', () => {
    const welcome = text('gtr_welcome');
    expect(welcome).toMatch(/2 tier-1, 2 tier-2 and 1 tier-3/);
    expect(welcome).toMatch(/3 buildings/);
    expect(welcome).toMatch(/judged from round 2/);
    expect(text('gtr_gate')).toMatch(/30%/);
    expect(text('gtr_gate')).toContain('Pathfinder Gate');
    expect(text('gtr_gate')).toContain('Advance to Galactic Age');
  });

  it('names real controls: the gate rail, the Build section, the Galaxy chart, the phase buttons', () => {
    expect(text('gtr_research')).toContain('Advancement gate');
    expect(text('gtr_build')).toContain('Build');
    expect(text('gtr_arrive')).toContain('Galaxy chart');
    expect(text('gtr_win')).toContain(phaseAdvanceLabel('fortify'));
    for (const step of GALAXY_TRANSCENDENCE_STEPS) {
      expect(`${step.message} ${step.hint ?? ''}`).not.toMatch(/right-hand sidebar/);
    }
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_TRANSCENDENCE_STEPS[0].skippable).toBe(true);
    expect(isTutorialStepCentered(byId('gtr_welcome'))).toBe(true);
    const last = GALAXY_TRANSCENDENCE_STEPS[GALAXY_TRANSCENDENCE_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
    expect(last.skippedTitle).toBeTruthy();
    const skipped = last.skippedMessage!.toLowerCase();
    expect(skipped).not.toMatch(/you cleared|you arrived|you raised/);
    expect(skipped).toContain(phaseAdvanceLabel('draft').toLowerCase());
    const lastGate = GALAXY_TRANSCENDENCE_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBe(GALAXY_TRANSCENDENCE_STEPS.length - 2);
  });
});
