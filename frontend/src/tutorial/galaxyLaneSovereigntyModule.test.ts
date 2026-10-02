import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GALAXY_LANE_SOVEREIGNTY_STEPS,
  GALAXY_LANE_SOVEREIGNTY_STEP_IDS,
} from './modules/galaxyLaneSovereigntySteps';
import {
  getRecommendedTutorialModule,
  getTutorialSteps,
  isActionOnlyRequireAction,
  isTutorialStepCentered,
  shouldAdvanceTutorialOnState,
} from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES, isGalaxyTutorialModule } from './types';
import { phaseAdvanceLabel } from '../constants/phaseLabels';

/** The board the lesson plays on; the cards name its systems and worlds. */
const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string }>;
  connections: Array<{ from: string; to: string; type: string }>;
};

describe('Galactic Age · Lane Sovereignty lesson', () => {
  const byId = (id: string) => GALAXY_LANE_SOVEREIGNTY_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''}`;
  };
  const nameOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.name]));

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_LANE_SOVEREIGNTY_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_LANE_SOVEREIGNTY_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gls_')).toBe(true);
  });

  it('is registered as a flag-gated galaxy lesson that completes on the win', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_lane_sovereignty');
    expect(meta).toBeDefined();
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBe(true);
    expect(meta?.estimatedMinutes).toBeGreaterThan(0);
    expect(isGalaxyTutorialModule('galaxy_lane_sovereignty')).toBe(true);
    expect(GALAXY_TUTORIAL_MODULE_IDS).toContain('galaxy_lane_sovereignty');
    expect(getTutorialSteps('galaxy_lane_sovereignty')).toBe(GALAXY_LANE_SOVEREIGNTY_STEPS);
  });

  it('only uses gates the game actually advances on', () => {
    for (const step of GALAXY_LANE_SOVEREIGNTY_STEPS) {
      if (!step.requireAction) continue;
      expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
  });

  it('makes the player do the thing: chart, research, cross a lane, hold, win', () => {
    const gates = GALAXY_LANE_SOVEREIGNTY_STEPS.map((s) => s.requireAction).filter(Boolean);
    expect(gates).toEqual([
      'galaxy_chart_opened',
      'tech_researched',
      'end_phase',
      'territory_captured',
      'my_next_turn',
      'my_next_turn',
      'game_won',
    ]);
    expect(byId('gls_charts')?.actionOpenTechTree).toBe(true);
  });

  it('names the winning lane end to end, on systems that exist and border across a lane', () => {
    const cross = byId('gls_cross');
    expect(cross?.targetTerritoryId).toBe('nexus_antenna_spire');
    expect(byId('gls_draft')?.targetTerritoryId).toBe('rust_hematite_span');
    const source = nameOf.get('rust_hematite_span');
    const target = nameOf.get('nexus_antenna_spire');
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    for (const id of ['gls_draft', 'gls_cross']) expect(text(id)).toContain(source!);
    for (const id of ['gls_draft', 'gls_cross']) expect(text(id)).toContain(target!);
    const lane = galaxy.connections.find(
      (c) => c.type === 'orbit'
        && ((c.from === 'rust_hematite_span' && c.to === 'nexus_antenna_spire')
          || (c.from === 'nexus_antenna_spire' && c.to === 'rust_hematite_span')),
    );
    expect(lane).toBeDefined();
    // The skip copy sends the player to the same two systems.
    const last = GALAXY_LANE_SOVEREIGNTY_STEPS[GALAXY_LANE_SOVEREIGNTY_STEPS.length - 1];
    expect(last.skippedMessage).toContain(source!);
    expect(last.skippedMessage).toContain(target!);
  });

  it('names the worlds as the board labels them', () => {
    const welcome = text('gls_welcome');
    for (const w of galaxy.worlds) expect(welcome).toContain(w.display_name);
  });

  it('teaches the real numbers: 5 of 8 lanes, 3 turns, 5 in a duel or 2v2, 2 dice on a lane', () => {
    const welcome = text('gls_welcome');
    expect(welcome).toMatch(/5 of the 8 lanes/);
    expect(welcome).toMatch(/3 turns running/);
    expect(welcome).toMatch(/duel or a 2v2 needs 5/);
    expect(text('gls_charts')).toMatch(/2 dice/);
    expect(text('gls_chart')).toContain('corridors 4 of 5');
    expect(text('gls_chart')).toContain('held 0 of 3 rounds');
  });

  it('names real controls: the Galaxy chart, the phase buttons, the tech tree', () => {
    expect(text('gls_chart')).toContain('Galaxy chart');
    expect(text('gls_draft')).toContain(phaseAdvanceLabel('draft'));
    expect(text('gls_hold_1')).toContain(phaseAdvanceLabel('attack'));
    expect(text('gls_hold_1')).toContain(phaseAdvanceLabel('fortify'));
    expect(text('gls_hold_2')).toContain(phaseAdvanceLabel('fortify'));
    expect(text('gls_charts')).toContain('Lane Charts');
    for (const step of GALAXY_LANE_SOVEREIGNTY_STEPS) {
      const t = `${step.message} ${step.hint ?? ''}`;
      expect(t).not.toMatch(/right-hand sidebar/);
    }
  });

  it('docks the board-pointing cards clear of the systems they name', () => {
    expect(byId('gls_draft')?.cardPosition).toBe('aside');
    expect(byId('gls_cross')?.cardPosition).toBe('aside');
    expect(isTutorialStepCentered(byId('gls_welcome'))).toBe(true);
    expect(isTutorialStepCentered(byId('gls_complete'))).toBe(true);
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_LANE_SOVEREIGNTY_STEPS[0].skippable).toBe(true);
    const last = GALAXY_LANE_SOVEREIGNTY_STEPS[GALAXY_LANE_SOVEREIGNTY_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
    expect(last.skippedTitle).toBeTruthy();
    const skipped = last.skippedMessage!.toLowerCase();
    expect(skipped).not.toMatch(/you crossed|you held|you completed/);
    expect(skipped).toContain('5 of the 8');
    expect(skipped).toContain(phaseAdvanceLabel('draft').toLowerCase());
  });

  it('keeps every action step ahead of the completion card', () => {
    const lastGate = GALAXY_LANE_SOVEREIGNTY_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBe(GALAXY_LANE_SOVEREIGNTY_STEPS.length - 2);
  });

  it('holds a my_next_turn card through the player\'s own phases and advances only when the turn comes back', () => {
    const step = byId('gls_hold_1');
    const players = [{ player_id: 'u1' }, { player_id: 'ai_1' }, { player_id: 'ai_2' }];
    const base = {
      step, myPlayerId: 'u1', players, isMyDraftTurn: false, draftLeft: -1,
    };
    // The player's own attack → fortify: same seat, no advance.
    expect(shouldAdvanceTutorialOnState({
      ...base, prevPhase: 'attack', nextPhase: 'fortify', playerChanged: false, prevPlayerIndex: 0, newPlayerIndex: 0,
    })).toBe(false);
    // Hand-off to the first rival: a change, but not to the player.
    expect(shouldAdvanceTutorialOnState({
      ...base, prevPhase: 'fortify', nextPhase: 'draft', playerChanged: true, prevPlayerIndex: 0, newPlayerIndex: 1,
    })).toBe(false);
    // Rival to rival: still not the player.
    expect(shouldAdvanceTutorialOnState({
      ...base, prevPhase: 'fortify', nextPhase: 'draft', playerChanged: true, prevPlayerIndex: 1, newPlayerIndex: 2,
    })).toBe(false);
    // Back round to the player: advance.
    expect(shouldAdvanceTutorialOnState({
      ...base, prevPhase: 'fortify', nextPhase: 'draft', playerChanged: true, prevPlayerIndex: 2, newPlayerIndex: 0, isMyDraftTurn: true, draftLeft: 9,
    })).toBe(true);
  });
});

describe('the galaxy track in the recommended-next logic', () => {
  beforeEach(() => localStorage.clear());
  const allCore = ['core', 'advanced_settings', 'faction_ability', 'tech_tree', 'era_advancement'];

  it('is never recommended while the flag is off', () => {
    localStorage.setItem('borderfall_tutorial_modules_completed_v2', JSON.stringify(allCore));
    expect(getRecommendedTutorialModule({ galaxyEnabled: false })).toBeNull();
  });

  it('comes after every core lesson, once the flag is on', () => {
    localStorage.setItem('borderfall_tutorial_modules_completed_v2', JSON.stringify(allCore.slice(0, 4)));
    expect(getRecommendedTutorialModule({ galaxyEnabled: true })).toBe('era_advancement');
    localStorage.setItem('borderfall_tutorial_modules_completed_v2', JSON.stringify(allCore));
    expect(getRecommendedTutorialModule({ galaxyEnabled: true })).toBe('galaxy_lane_sovereignty');
    localStorage.setItem('borderfall_tutorial_modules_completed_v2', JSON.stringify([...allCore, 'galaxy_lane_sovereignty']));
    expect(getRecommendedTutorialModule({ galaxyEnabled: true })).toBeNull();
  });
});
