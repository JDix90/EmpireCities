import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GALAXY_PRIMER_STEPS, GALAXY_PRIMER_STEP_IDS } from './modules/galaxyPrimerSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES } from './types';
import { TUTORIAL_STEP_LISTS } from './localize';
import {
  describeLaneDice,
  describeWorldRules,
  GALAXY_LANE_BASE_ATTACK_DICE,
  laneAttackDiceCap,
} from '../utils/galaxyLanes';
import type { GameState } from '../store/gameStore';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string; rules?: Record<string, unknown> }>;
  connections: Array<{ from: string; to: string; type: string; source?: string }>;
};

describe('Galactic Age · the primer', () => {
  const byId = (id: string) => GALAXY_PRIMER_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''} ${step?.whyItMatters ?? ''}`;
  };
  const all = GALAXY_PRIMER_STEPS.map((s) => text(s.id)).join(' ');
  const worldName = (id: string) => galaxy.worlds.find((w) => w.world_id === id)!.display_name;

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_PRIMER_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_PRIMER_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gpr_')).toBe(true);
  });

  it('is the first galaxy lesson, flag-gated, completed by reading rather than winning', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_primer');
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBeFalsy();
    expect(GALAXY_TUTORIAL_MODULE_IDS[0]).toBe('galaxy_primer');
    expect(getTutorialSteps('galaxy_primer')).toBe(GALAXY_PRIMER_STEPS);
    const last = GALAXY_PRIMER_STEPS[GALAXY_PRIMER_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
  });

  it('gates on one thing only: opening the Galaxy chart', () => {
    for (const step of GALAXY_PRIMER_STEPS) {
      if (step.requireAction) expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
    expect(GALAXY_PRIMER_STEPS.map((s) => s.requireAction).filter(Boolean)).toEqual(['galaxy_chart_opened']);
    expect(byId('gpr_chart')?.requireAction).toBe('galaxy_chart_opened');
    for (const id of ['gpr_welcome', 'gpr_worlds', 'gpr_boards', 'gpr_lanes', 'gpr_wins']) {
      expect(isTutorialStepCentered(byId(id)), id).toBe(true);
    }
    expect(isTutorialStepCentered(byId('gpr_chart'))).toBe(false);
    // The primer is the start of the track: it links to no other lesson.
    for (const step of GALAXY_PRIMER_STEPS) expect(step.linkModule).toBeUndefined();
  });

  it('is linked from the welcome card of every other galaxy lesson', () => {
    for (const id of GALAXY_TUTORIAL_MODULE_IDS) {
      if (id === 'galaxy_primer') continue;
      const first = TUTORIAL_STEP_LISTS[id][0];
      expect(first?.linkModule, id).toBe('galaxy_primer');
      expect(first?.skippable, id).toBe(true);
    }
  });

  it('names the worlds, the lanes and the chart as the board labels them', () => {
    const lanes = galaxy.connections.filter((c) => c.type === 'orbit' && !c.source);
    expect(lanes.length).toBe(8);
    expect(galaxy.worlds.length).toBe(4);
    for (const w of galaxy.worlds) expect(text('gpr_welcome')).toContain(w.display_name);
    expect(text('gpr_welcome')).toContain(`**${lanes.length} hyperspace lanes**`);
    expect(text('gpr_welcome')).toContain(`**${GALAXY_LANE_BASE_ATTACK_DICE} dice** (${GALAXY_LANE_BASE_ATTACK_DICE + 1} with **Lane Charts**)`);
    // The chart's legend (GalaxyStrategicView) and the view controls (GamePage).
    const chart = text('gpr_chart');
    for (const line of ['Corridor · both gateways yours', 'Open · you hold one end', 'Closed · take a gateway first', 'Sealed · Emergency Seal, 1 round']) {
      expect(chart).toContain(line);
    }
    for (const control of ['Galaxy chart', 'Split', 'Enter world →', 'Gateway']) expect(chart).toContain(control);
    // The Gateway card's dice line, as the territory panel renders it for a seat without Lane Charts.
    const state = {
      settings: { galaxy_corridors_enabled: true, tech_trees_enabled: true },
      players: [{ player_id: 'me', unlocked_techs: [] }],
      territories: {},
    } as unknown as GameState;
    expect(chart).toContain(`**${describeLaneDice(laneAttackDiceCap(state, 'me'))}**`);
  });

  it('states every world rule exactly as the Bonuses panel does', () => {
    const worlds = text('gpr_worlds');
    for (const w of galaxy.worlds) {
      expect(worlds).toContain(`**${w.display_name}**`);
      const lines = describeWorldRules(w.rules as Parameters<typeof describeWorldRules>[0]);
      expect(lines.length, w.world_id).toBeGreaterThan(0);
      for (const line of lines) expect(worlds, w.world_id).toContain(line);
    }
    for (const kit of ['Stellar Mandate', 'Forge Syndicate', 'Helion Navigators', 'Void Custodians']) {
      expect(worlds).toContain(`**${kit}**`);
    }
  });

  it('teaches the rules the engine applies around the wins', () => {
    const wins = text('gpr_wins');
    const total = galaxy.territories.length;
    expect(wins).toContain(`60% of ${total} is ${Math.ceil((total * 60) / 100)}`);
    expect(wins).toMatch(/hold 5 of the 8 charted lanes/);
    expect(wins).toMatch(/3 turns running — 5 in a duel or a 2v2/);
    expect(wins).toMatch(/never name ground behind a hyperspace gate/);
    expect(wins).toMatch(/only draw an eliminate mission/);
    expect(wins).toMatch(/Last Commander Standing, judged at once/);
    expect(wins).toMatch(/Space to Stars/);
    expect(wins).toMatch(/Every win but Domination is judged from round 2/);
    expect(wins).toContain('Objectives');
    expect(text('gpr_boards')).toMatch(/75%/);
    expect(text('gpr_boards')).toMatch(/plays without secret missions/);
    expect(text('gpr_lanes')).toMatch(/never carries an attack/);
    expect(text('gpr_lanes')).toMatch(/counts the eight charted lanes only/);
    for (const name of ['Nebula Closure', 'Lane Surge', 'Emergency Seal', 'Jump Gates', 'Blockade Runner']) {
      expect(text('gpr_lanes')).toContain(name);
    }
    for (const name of ['Home Worlds', 'Colonies', 'Schism', 'Concord', 'Civil War', 'Allied', 'Lane Crown', '2v2']) {
      expect(text('gpr_boards')).toContain(name);
    }
    for (const w of galaxy.worlds) expect(text('gpr_boards')).toContain(worldName(w.world_id));
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_PRIMER_STEPS[0].skippable).toBe(true);
    const last = GALAXY_PRIMER_STEPS[GALAXY_PRIMER_STEPS.length - 1];
    expect(last.skippedMessage!.toLowerCase()).toMatch(/skipped the reading/);
    expect(last.skippedMessage).toContain('Back to lobby');
    expect(all).not.toMatch(/right-hand sidebar/);
  });
});
