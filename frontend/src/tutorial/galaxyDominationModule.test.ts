import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GALAXY_DOMINATION_STEPS, GALAXY_DOMINATION_STEP_IDS } from './modules/galaxyDominationSteps';
import { getTutorialSteps, isActionOnlyRequireAction, isTutorialStepCentered } from './progression';
import { GALAXY_TUTORIAL_MODULE_IDS, TUTORIAL_MODULES } from './types';
import { phaseAdvanceLabel } from '../constants/phaseLabels';
import { describeWinConditions } from '../components/game/GameStartModal';
import type { GameState } from '../store/gameStore';

const galaxy = JSON.parse(readFileSync(resolve(process.cwd(), '../database/maps/era_galaxy.json'), 'utf8')) as {
  territories: Array<{ territory_id: string; name: string; world_id: string }>;
  worlds: Array<{ world_id: string; display_name: string }>;
  connections: Array<{ from: string; to: string; type: string }>;
};

/** The result screen's label for the condition (ActionModal's `victoryReasonLabel`). */
const LAST_STANDING_LABEL = 'Last Commander Standing — all opponents eliminated';

describe('Galactic Age · Domination lesson', () => {
  const byId = (id: string) => GALAXY_DOMINATION_STEPS.find((s) => s.id === id);
  const text = (id: string) => {
    const step = byId(id);
    return `${step?.message ?? ''} ${step?.detail ?? ''} ${step?.hint ?? ''} ${step?.whyItMatters ?? ''}`;
  };
  const nameOf = new Map(galaxy.territories.map((t) => [t.territory_id, t.name]));
  const worldName = (id: string) => galaxy.worlds.find((w) => w.world_id === id)!.display_name;

  it('ships the step list it means to, in order, with unique ids', () => {
    const ids = GALAXY_DOMINATION_STEPS.map((s) => s.id);
    expect(ids).toEqual([...GALAXY_DOMINATION_STEP_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('gdm_')).toBe(true);
  });

  it('is registered as a flag-gated galaxy lesson that completes on the win', () => {
    const meta = TUTORIAL_MODULES.find((m) => m.id === 'galaxy_domination');
    expect(meta?.galaxy).toBe(true);
    expect(meta?.completesOnVictory).toBe(true);
    expect(GALAXY_TUTORIAL_MODULE_IDS).toContain('galaxy_domination');
    expect(getTutorialSteps('galaxy_domination')).toBe(GALAXY_DOMINATION_STEPS);
  });

  it('gates on the draft, the capture that ends the game, and the win', () => {
    for (const step of GALAXY_DOMINATION_STEPS) {
      if (step.requireAction) expect(isActionOnlyRequireAction(step.requireAction), step.id).toBe(true);
    }
    expect(GALAXY_DOMINATION_STEPS.map((s) => s.requireAction).filter(Boolean)).toEqual([
      'end_phase', 'territory_captured', 'game_won',
    ]);
    expect(byId('gdm_draft')?.targetTerritoryId).toBe('verdan_glowmire_shelf');
    expect(byId('gdm_take')?.targetTerritoryId).toBe('verdan_greenfire_vault');
  });

  it('names the systems and worlds as the board labels them, with the attack by ground', () => {
    const source = nameOf.get('verdan_glowmire_shelf')!;
    const target = nameOf.get('verdan_greenfire_vault')!;
    const link = galaxy.connections.find(
      (c) => (c.from === 'verdan_glowmire_shelf' && c.to === 'verdan_greenfire_vault')
        || (c.from === 'verdan_greenfire_vault' && c.to === 'verdan_glowmire_shelf'),
    );
    expect(link).toBeDefined();
    expect(link?.type).not.toBe('orbit');
    // Greenfire Vault is a gateway, as the welcome card says: a lane runs to Pacific Rim.
    expect(galaxy.connections.some(
      (c) => c.type === 'orbit' && [c.from, c.to].includes('verdan_greenfire_vault') && [c.from, c.to].includes('sol_pacific_rim'),
    )).toBe(true);
    for (const id of ['gdm_draft', 'gdm_take']) {
      expect(text(id)).toContain(source);
      expect(text(id)).toContain(target);
    }
    expect(text('gdm_welcome')).toContain(target);
    expect(text('gdm_welcome')).toContain(nameOf.get('sol_pacific_rim')!);
    expect(text('gdm_take')).toMatch(/ground attack/);
    const last = GALAXY_DOMINATION_STEPS[GALAXY_DOMINATION_STEPS.length - 1];
    for (const name of [source, target]) expect(last.skippedMessage).toContain(name);
    for (const w of ['sol', 'verdan', 'rust', 'nexus_station']) {
      expect(text('gdm_welcome')).toContain(worldName(w));
    }
  });

  it('carries the counts of the board: every system, and the colonies that never need taking', () => {
    const total = galaxy.territories.length;
    const colonies = galaxy.territories.filter((t) => t.world_id === 'rust' || t.world_id === 'nexus_station').length;
    const verdan = galaxy.territories.filter((t) => t.world_id === 'verdan').length;
    expect(text('gdm_welcome')).toContain(`all **${total}** systems`);
    expect(text('gdm_welcome')).toContain(`the **${colonies}** colony garrisons`);
    expect(text('gdm_win')).toContain(`**${colonies}** neutral systems`);
    // "the other fifteen": every Verdan system but the Navigators' last.
    expect(verdan - 1).toBe(15);
    expect(text('gdm_welcome')).toMatch(/the other fifteen/);
  });

  it('teaches what the engine does: last standing first, judged at once, never Total Domination', () => {
    const settings = { allowed_victory_conditions: ['domination'] } as unknown as GameState['settings'];
    const briefing = describeWinConditions(settings).conditions[0]!;
    expect(text('gdm_welcome')).toContain(`**${briefing}**`);
    expect(text('gdm_welcome')).toMatch(/judged at once rather than from round 2/);
    expect(text('gdm_welcome')).toMatch(/never reads Total Domination/);
    expect(text('gdm_rules')).toContain(`**${LAST_STANDING_LABEL}**`);
    expect(text('gdm_win')).toContain(`**${LAST_STANDING_LABEL}**`);
    expect(text('gdm_rules')).toMatch(/judged in round 1 too/);
    expect(text('gdm_rules')).toMatch(/resignation is an elimination/);
    expect(text('gdm_take')).toMatch(/No waiting for round 2/);
    expect(text('gdm_draft')).toMatch(/at least three units a turn/);
  });

  it('names real controls, screens and the phase buttons', () => {
    expect(text('gdm_rules')).toContain('Status');
    expect(text('gdm_rules')).toContain('Player Eliminated');
    expect(text('gdm_win')).toContain('Victory!');
    expect(text('gdm_draft')).toContain(phaseAdvanceLabel('draft'));
    expect(text('gdm_take')).toContain('Attack until captured');
    expect(byId('gdm_draft')?.cardPosition).toBe('aside');
    expect(byId('gdm_take')?.cardPosition).toBe('aside');
    // The game ends on the capture, so no card asks for the later phase buttons.
    expect(text('gdm_win')).not.toContain(phaseAdvanceLabel('attack'));
  });

  it('offers Skip on its first card and carries honest skip copy on its last', () => {
    expect(GALAXY_DOMINATION_STEPS[0].skippable).toBe(true);
    expect(isTutorialStepCentered(byId('gdm_welcome'))).toBe(true);
    expect(isTutorialStepCentered(byId('gdm_rules'))).toBe(true);
    const last = GALAXY_DOMINATION_STEPS[GALAXY_DOMINATION_STEPS.length - 1];
    expect(last.variant).toBe('module_complete');
    expect(last.skippedMessage!.toLowerCase()).not.toMatch(/you eliminated|you took/);
    expect(last.skippedMessage).toContain(phaseAdvanceLabel('draft'));
    const lastGate = GALAXY_DOMINATION_STEPS.map((s) => !!s.requireAction).lastIndexOf(true);
    expect(lastGate).toBe(GALAXY_DOMINATION_STEPS.length - 2);
  });
});
