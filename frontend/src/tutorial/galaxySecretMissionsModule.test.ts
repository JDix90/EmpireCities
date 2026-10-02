import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GALAXY_SECRET_MISSIONS_STEPS,
  GALAXY_SECRET_MISSIONS_STEP_IDS,
} from './modules/galaxySecretMissionsSteps';
import {
  getTutorialSteps,
  isActionOnlyRequireAction,
  isOwnMissionVisiblyComplete,
  isTutorialStepCentered,
  shouldAdvanceTutorialOnState,
} from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES } from './types';
import { phaseAdvanceLabel } from '../constants/phaseLabels';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string; requires_orbit_access?: boolean }>;
  connections: Array<{ from: string; to: string; type: string }>;
};

describe('Galactic Age · Secret Missions lesson', () => {
  const byId = (id: string) => GALAXY_SECRET_MISSIONS_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''} ${step?.whyItMatters ?? ''}`;
  };
  const nameOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.name]));
  const lane = (a: string, b: string) => galaxy.connections.some(
    (c) => c.type === 'orbit' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)),
  );

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_SECRET_MISSIONS_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_SECRET_MISSIONS_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gsm_')).toBe(true);
  });

  it('is registered as a flag-gated galaxy lesson that completes on the win', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_secret_missions');
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBe(true);
    expect(GALAXY_TUTORIAL_MODULE_IDS).toContain('galaxy_secret_missions');
    expect(getTutorialSteps('galaxy_secret_missions')).toBe(GALAXY_SECRET_MISSIONS_STEPS);
  });

  it('gates on the captures and the mission, in an order that cannot strand the player', () => {
    for (const step of GALAXY_SECRET_MISSIONS_STEPS) {
      if (step.requireAction) expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
    expect(GALAXY_SECRET_MISSIONS_STEPS.map((s) => s.requireAction).filter(Boolean)).toEqual([
      'end_phase', 'territory_captured', 'mission_complete', 'game_won',
    ]);
    // The first capture card names a system to highlight but accepts either
    // gateway, and the second waits on the mission itself, so a player who
    // takes Pacific Rim first is never asked for a system they already hold.
    expect(byId('gsm_first')?.targetTerritoryId).toBe('sol_guinea');
    expect(byId('gsm_second')?.requireAction).toBe('mission_complete');
  });

  it('names the mission\'s two systems and the two lanes that reach them, as the board has them', () => {
    expect(byId('gsm_draft')?.targetTerritoryId).toBe('verdan_chlorophage_span');
    expect(lane('verdan_chlorophage_span', 'sol_guinea')).toBe(true);
    expect(lane('verdan_greenfire_vault', 'sol_pacific_rim')).toBe(true);
    const mission = `Own ${nameOf.get('sol_guinea')} and ${nameOf.get('sol_pacific_rim')}`;
    expect(text('gsm_welcome')).toContain(mission);
    expect(text('gsm_objectives')).toContain(mission);
    for (const id of ['verdan_chlorophage_span', 'sol_guinea']) expect(text('gsm_first')).toContain(nameOf.get(id)!);
    for (const id of ['verdan_greenfire_vault', 'sol_pacific_rim']) expect(text('gsm_second')).toContain(nameOf.get(id)!);
    const last = GALAXY_SECRET_MISSIONS_STEPS[GALAXY_SECRET_MISSIONS_STEPS.length - 1];
    for (const id of ['verdan_chlorophage_span', 'sol_guinea', 'verdan_greenfire_vault', 'sol_pacific_rim']) {
      expect(last.skippedMessage).toContain(nameOf.get(id)!);
    }
  });

  it('teaches the galaxy\'s own mission rules: Sol is the one world a mission can name', () => {
    const gated = galaxy.worlds.filter((w) => w.requires_orbit_access).map((w) => w.world_id).sort();
    expect(gated).toEqual(['nexus_station', 'rust', 'verdan']);
    const welcome = text('gsm_welcome');
    expect(welcome).toMatch(/every world but Sol III/);
    expect(welcome).toMatch(/holds all of Sol can only ever draw an eliminate mission/);
    expect(welcome).toMatch(/judged from round 2/);
  });

  it('teaches the alliance rule with the numbers the engine uses', () => {
    const alliance = text('gsm_alliance');
    expect(alliance).toMatch(/four or more seats with at least two humans/);
    expect(alliance).toMatch(/one deal in five/);
    expect(alliance).toMatch(/plus 7%/);
    // ceil(64 dealt × (1/4 + 7/100)) on the four-seat galaxy board.
    expect(alliance).toContain('21 each');
    expect(alliance).toMatch(/Team games drop missions/);
  });

  it('names real controls and the phase buttons', () => {
    expect(text('gsm_objectives')).toContain('Objectives');
    expect(text('gsm_draft')).toContain(phaseAdvanceLabel('draft'));
    expect(text('gsm_win')).toContain(phaseAdvanceLabel('attack'));
    expect(text('gsm_win')).toContain(phaseAdvanceLabel('fortify'));
    expect(text('gsm_first')).toContain('Attack until captured');
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_SECRET_MISSIONS_STEPS[0].skippable).toBe(true);
    expect(isTutorialStepCentered(byId('gsm_welcome'))).toBe(true);
    expect(isTutorialStepCentered(byId('gsm_alliance'))).toBe(true);
    const last = GALAXY_SECRET_MISSIONS_STEPS[GALAXY_SECRET_MISSIONS_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
    expect(last.skippedMessage!.toLowerCase()).not.toMatch(/you read|you took|you won/);
    expect(last.skippedMessage).toContain(phaseAdvanceLabel('draft'));
    const lastGate = GALAXY_SECRET_MISSIONS_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBe(GALAXY_SECRET_MISSIONS_STEPS.length - 2);
  });
});

describe('the mission_complete gate', () => {
  const territories = {
    sol_guinea: { owner_id: 'u1' },
    sol_pacific_rim: { owner_id: 'ai_1' },
  };
  const mission = { kind: 'capture_territories', territory_ids: ['sol_guinea', 'sol_pacific_rim'] };

  it('reads a capture mission off the board the viewer can see', () => {
    expect(isOwnMissionVisiblyComplete({ mission, myPlayerId: 'u1', territories })).toBe(false);
    expect(isOwnMissionVisiblyComplete({
      mission, myPlayerId: 'u1', territories: { ...territories, sol_pacific_rim: { owner_id: 'u1' } },
    })).toBe(true);
    expect(isOwnMissionVisiblyComplete({ mission: { kind: 'eliminate_player' }, myPlayerId: 'u1', territories })).toBe(false);
    expect(isOwnMissionVisiblyComplete({ mission: null, myPlayerId: 'u1', territories })).toBe(false);
  });

  it('advances the card only once the mission reads complete', () => {
    const step = GALAXY_SECRET_MISSIONS_STEPS.find((s) => s.id === 'gsm_second');
    const base = {
      step, prevPhase: 'attack', nextPhase: 'attack', playerChanged: false, prevPlayerIndex: 0, newPlayerIndex: 0,
      myPlayerId: 'u1', players: [{ player_id: 'u1' }, { player_id: 'ai_1' }], isMyDraftTurn: false, draftLeft: -1,
    };
    expect(shouldAdvanceTutorialOnState({ ...base, ownMissionComplete: false })).toBe(false);
    expect(shouldAdvanceTutorialOnState({ ...base })).toBe(false);
    expect(shouldAdvanceTutorialOnState({ ...base, ownMissionComplete: true })).toBe(true);
  });
});
