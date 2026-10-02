import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GALAXY_CAPITAL_STEPS, GALAXY_CAPITAL_STEP_IDS } from './modules/galaxyCapitalSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES } from './types';
import { phaseAdvanceLabel } from '../constants/phaseLabels';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string }>;
  connections: Array<{ from: string; to: string; type: string }>;
};

describe('Galactic Age · Capital lesson', () => {
  const byId = (id: string) => GALAXY_CAPITAL_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''} ${step?.whyItMatters ?? ''}`;
  };
  const nameOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.name]));
  const gateways = new Set(galaxy.connections.filter((c) => c.type === 'orbit').flatMap((c) => [c.from, c.to]));

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_CAPITAL_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_CAPITAL_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gcp_')).toBe(true);
  });

  it('is registered as a flag-gated galaxy lesson that completes on the win', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_capital');
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBe(true);
    expect(GALAXY_TUTORIAL_MODULE_IDS).toContain('galaxy_capital');
    expect(getTutorialSteps('galaxy_capital')).toBe(GALAXY_CAPITAL_STEPS);
  });

  it('gates on the draft, the one capture that matters, and the win', () => {
    for (const step of GALAXY_CAPITAL_STEPS) {
      if (step.requireAction) expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
    expect(GALAXY_CAPITAL_STEPS.map((s) => s.requireAction).filter(Boolean)).toEqual([
      'end_phase', 'territory_captured', 'game_won',
    ]);
    expect(byId('gcp_draft')?.targetTerritoryId).toBe('sol_guinea');
    expect(byId('gcp_cross')?.targetTerritoryId).toBe('verdan_chlorophage_span');
  });

  it('names both capitals as the board labels them, both on gateways, joined by the lane it points at', () => {
    const own = nameOf.get('sol_amazonia')!;
    const rival = nameOf.get('verdan_chlorophage_span')!;
    expect(gateways.has('sol_amazonia')).toBe(true);
    expect(gateways.has('verdan_chlorophage_span')).toBe(true);
    const lane = galaxy.connections.some(
      (c) => c.type === 'orbit'
        && ((c.from === 'sol_guinea' && c.to === 'verdan_chlorophage_span')
          || (c.from === 'verdan_chlorophage_span' && c.to === 'sol_guinea')),
    );
    expect(lane).toBe(true);
    for (const id of ['gcp_welcome', 'gcp_rules']) {
      expect(text(id)).toContain(own);
    }
    for (const id of ['gcp_welcome', 'gcp_cross']) {
      expect(text(id)).toContain(rival);
      expect(text(id)).toContain(nameOf.get('sol_guinea')!);
    }
    const last = GALAXY_CAPITAL_STEPS[GALAXY_CAPITAL_STEPS.length - 1];
    for (const name of [own, rival, nameOf.get('sol_guinea')!]) expect(last.skippedMessage).toContain(name);
    for (const w of galaxy.worlds.filter((w) => w.world_id === 'sol' || w.world_id === 'verdan')) {
      expect(text('gcp_welcome')).toContain(w.display_name);
    }
  });

  it('teaches the capital rules the engine applies', () => {
    const rules = text('gcp_rules');
    expect(rules).toContain('Your capital: Amazon Basin');
    expect(rules).toMatch(/judged from round 2/);
    expect(rules).toMatch(/cannot win by capitals until you retake it/);
    expect(rules).toMatch(/Only living rivals count/);
    expect(rules).toMatch(/every living capital/);
    expect(text('gcp_cross')).toMatch(/at most 2 dice/);
  });

  it('names real controls and the phase buttons', () => {
    expect(text('gcp_rules')).toContain('Objectives');
    expect(text('gcp_draft')).toContain(phaseAdvanceLabel('draft'));
    expect(text('gcp_win')).toContain(phaseAdvanceLabel('attack'));
    expect(text('gcp_win')).toContain(phaseAdvanceLabel('fortify'));
    expect(text('gcp_cross')).toContain('Attack until captured');
    expect(byId('gcp_draft')?.cardPosition).toBe('aside');
    expect(byId('gcp_cross')?.cardPosition).toBe('aside');
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_CAPITAL_STEPS[0].skippable).toBe(true);
    expect(isTutorialStepCentered(byId('gcp_welcome'))).toBe(true);
    expect(isTutorialStepCentered(byId('gcp_rules'))).toBe(true);
    const last = GALAXY_CAPITAL_STEPS[GALAXY_CAPITAL_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
    expect(last.skippedMessage!.toLowerCase()).not.toMatch(/you held|you took/);
    expect(last.skippedMessage).toContain(phaseAdvanceLabel('draft'));
    const lastGate = GALAXY_CAPITAL_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBe(GALAXY_CAPITAL_STEPS.length - 2);
  });
});
