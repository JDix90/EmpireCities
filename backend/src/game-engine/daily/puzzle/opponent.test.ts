/**
 * Which territory a scripted plan's conditions read. On a capture, hold or
 * chain day the day's primary objective is the territory the plan is about;
 * a region's objective is the whole region in the map's order, whose first
 * territory is usually one the human already holds, so a region plan names
 * its garrison. The model (the solver's opponent) and the engine (the live
 * game's opponent) must read the same one.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../../types';
import { AI, HUMAN, PENDING, PHASE_DRAFT, type PuzzleContext, type PuzzleState } from './model';
import { compilePlan, describePlan, runAiTurn, type OpponentPlan } from './opponent';
import { runScriptedAiTurn } from './engineOpponent';

/** A region of two: `home` (human, first in the map's order) and `fort` (AI); `camp` (AI) sits outside it. */
function regionContext(): PuzzleContext {
  const ids = ['camp', 'fort', 'home'];
  return {
    ids,
    index: new Map(ids.map((id, i) => [id, i])),
    adj: [[1], [0, 2], [1]],
    seaEdges: new Set(),
    regions: [],
    doctrine: { legionReroll: false, rifleDoctrine: false },
    seaCap: 3,
    defenderBonus: [0, 0, 0],
    fortifyMoves: 1,
    maxAssaults: 3,
    objective: { kind: 'region', targets: [2, 1] },
    maxTurns: 2,
    playerCount: 2,
    startingPhase: 'attack',
  };
}

const steps: OpponentPlan['steps'] = [
  { kind: 'draft', to: 'fort', when: 'objective_ai' },
  { kind: 'draft', to: 'camp', when: 'objective_human' },
];
const named: OpponentPlan = { objective: 'fort', steps };
const unnamed: OpponentPlan = { steps };

function modelState(): PuzzleState {
  return {
    owner: [AI, AI, HUMAN],
    units: [3, 3, 5],
    side: HUMAN,
    phase: PHASE_DRAFT,
    turn: 1,
    draftLeft: 0,
    fortifyLeft: 1,
    assaults: 0,
    reachedTurn: -1,
    objectiveAttacked: false,
    aiTurns: 0,
    outcome: PENDING,
  };
}

/** Where the model's AI put its draft. */
function modelDraft(plan: OpponentPlan): string {
  const ctx = regionContext();
  const before = modelState();
  const [after] = runAiTurn(ctx, compilePlan(ctx, plan), before);
  const grew = ctx.ids.filter((_, i) => after.state.units[i] > before.units[i]);
  expect(grew).toHaveLength(1);
  return grew[0];
}

/** Where the engine's AI put its draft. */
async function engineDraft(plan: OpponentPlan): Promise<string> {
  const ctx = regionContext();
  const state = {
    territories: {
      camp: { owner_id: 'ai', unit_count: 3 },
      fort: { owner_id: 'ai', unit_count: 3 },
      home: { owner_id: 'human', unit_count: 5 },
    },
    draft_units_remaining: 3,
    phase: 'draft',
    turn_number: 1,
  } as unknown as GameState;
  const map = { connections: [] } as unknown as GameMap;
  let drafted: string | null = null;
  await runScriptedAiTurn(state, map, ctx, plan, 'human', 'ai', { onDraft: (to) => { drafted = to; } });
  expect(drafted).not.toBeNull();
  return drafted!;
}

describe('scripted opponent — the territory its conditions read', () => {
  it("defaults to the day's primary objective", () => {
    const ctx = regionContext();
    expect(compilePlan(ctx, unnamed).objective).toBe(ctx.objective.targets[0]);
    expect(compilePlan(ctx, named).objective).toBe(ctx.index.get('fort'));
  });

  it('a plan that names its garrison reinforces it while the AI holds it, in the model and in the engine', async () => {
    expect(modelDraft(named)).toBe('fort');
    expect(await engineDraft(named)).toBe('fort');
  });

  it("without the name, a region's first territory decides, and the human already holds it", async () => {
    expect(modelDraft(unnamed)).toBe('camp');
    expect(await engineDraft(unnamed)).toBe('camp');
  });

  it('names the garrison in the plan read to the player', () => {
    const ctx = regionContext();
    const name = (id: string) => id.toUpperCase();
    expect(describePlan(ctx, named, name)).toEqual(['While it holds FORT: reinforces FORT.', 'Once you take FORT: reinforces CAMP.']);
    expect(describePlan(ctx, unnamed, name)[0]).toBe('While it holds HOME and FORT: reinforces FORT.');
  });
});
