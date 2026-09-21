import { describe, it, expect } from 'vitest';
import {
  buildShareLine,
  commitLabel,
  countBest,
  decisionsLine,
  describeProposal,
  describeStoredAction,
  verdictCopy,
  type PuzzleDecisionRecord,
} from './dailyPuzzleV2';

const nameOf = (id: string) => ({ persia: 'Persia', bactria: 'Bactria', mesopotamia: 'Mesopotamia' })[id] ?? id;

describe('dailyPuzzleV2 — words', () => {
  it('describes stored actions with territory names', () => {
    expect(describeStoredAction({ kind: 'assault', from: 'mesopotamia', to: 'persia', keep: 1 }, nameOf)).toBe('Attack Persia from Mesopotamia');
    expect(describeStoredAction({ kind: 'assault', from: 'mesopotamia', to: 'persia', keep: 3 }, nameOf)).toBe('Attack Persia from Mesopotamia, stopping with 3 left');
    expect(describeStoredAction({ kind: 'draft', to: 'persia' }, nameOf)).toBe('Draft everything onto Persia');
    expect(describeStoredAction({ kind: 'draft', to: 'persia', split: 'bactria' }, nameOf)).toBe('Draft half onto Persia and half onto Bactria');
    expect(describeStoredAction({ kind: 'fortify', from: 'persia', to: 'bactria', units: 'all_but_1' }, nameOf)).toBe('Move all but one from Persia into Bactria');
    expect(describeStoredAction({ kind: 'end_attack' }, nameOf)).toBe('Stop attacking');
    expect(describeStoredAction({ kind: 'end_turn' }, nameOf)).toBe('End the turn');
    expect(describeStoredAction(null, nameOf)).toBe('—');
  });

  it('asks the question the card opens with', () => {
    expect(describeProposal({ kind: 'attack', from: 'mesopotamia', to: 'persia' }, nameOf)).toBe('Attack Persia from Mesopotamia now?');
    expect(describeProposal({ kind: 'end_attack' }, nameOf)).toBe('Stop attacking?');
    expect(describeProposal({ kind: 'fortify', from: 'persia', to: 'bactria', units: 1 }, nameOf)).toBe('Move 1 unit from Persia into Bactria?');
  });

  it("phrases the verdict in the brief's words and prices the takeback", () => {
    const blunder = verdictCopy({ decision: true, silent: false, equity: 0.55, best_equity: 0.84, loss: 29, grade: 'blunder', takebacks: 0 });
    expect(blunder.body).toBe('That wins 55 % of futures. There is a 84 % line.');
    expect(blunder.tag).toBe('Blunder · gives up 29 points');
    expect(blunder.takebackNote).toMatch(/costs the star/);
    const best = verdictCopy({ decision: true, silent: false, equity: 0.84, best_equity: 0.84, loss: 0, grade: 'best', takebacks: 1 });
    expect(best.body).toBe('That wins 84 % of futures — the best line here.');
    expect(best.tag).toBe('Best move');
    expect(best.takebackNote).toMatch(/second takeback/);
    expect(verdictCopy({ decision: true, silent: false, takebacks: 2 }).takebackNote).toMatch(/full loss/);
  });

  it('builds the share line with the crown over the star', () => {
    const base = { date: '2026-09-21', accuracy: 94.4, star: true, crown: false, won: true, bestCount: 2, decisionCount: 2, url: 'https://borderfall.gg/daily' };
    expect(buildShareLine(base)).toBe('Borderfall Daily 2026-09-21 · ★ 94 % · 2/2 best · 🎲 won   https://borderfall.gg/daily');
    expect(buildShareLine({ ...base, crown: true, accuracy: 100 })).toContain('👑 100 %');
    expect(buildShareLine({ ...base, star: false, accuracy: 71, won: false, bestCount: 1 })).toBe('Borderfall Daily 2026-09-21 · 71 % · 1/2 best · 🎲 lost   https://borderfall.gg/daily');
  });

  it('counts the decisions graded best and phrases the day', () => {
    const rec = (grade: PuzzleDecisionRecord['grade']): PuzzleDecisionRecord =>
      ({ key: grade, turn: 1, phase: 'attack', best: { kind: 'end_attack' }, best_equity: 0.7, first: null, first_equity: 0.7, loss: 0, grade, takebacks: 0 });
    expect(countBest([rec('best'), rec('good'), rec('best')])).toBe(2);
    expect(decisionsLine({ version: 2, theme: 't', plan_prose: [], decisions_target: 2, verdicts: 'before_dice', intent: 'arrows', decisions: 3 }))
      .toBe('3 decisions decide this one · the board answers before the dice');
    expect(decisionsLine({ version: 2, theme: 't', plan_prose: [], decisions_target: 3, verdicts: 'silent', intent: 'prose', decisions: 0 }))
      .toBe('3 decisions decide this one · graded silently, revealed at the end');
  });

  it('names the commit button after the move, not the dice', () => {
    // Only an attack rolls: "Roll anyway" on a fortify read as a different move.
    expect(commitLabel({ kind: 'attack', from: 'persia', to: 'bactria' }, 'blunder')).toBe('Roll anyway');
    expect(commitLabel({ kind: 'fortify', from: 'persia', to: 'bactria', units: 3 }, 'inaccuracy')).toBe('Move anyway');
    expect(commitLabel({ kind: 'draft', to: 'persia' }, 'good')).toBe('Place anyway');
    expect(commitLabel({ kind: 'end_attack' }, 'blunder')).toBe('Stop anyway');
    expect(commitLabel({ kind: 'end_turn' }, 'blunder')).toBe('End turn anyway');
    // The board did not argue against the best move, so nothing is done "anyway".
    expect(commitLabel({ kind: 'fortify', from: 'persia', to: 'bactria', units: 3 }, 'best')).toBe('Move them');
    expect(commitLabel({ kind: 'attack', from: 'persia', to: 'bactria' }, 'best')).toBe('Roll');
    expect(commitLabel({ kind: 'end_turn' })).toBe('End the turn');
  });
});
