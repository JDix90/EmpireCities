/**
 * The model against the engine, whole games.
 *
 * The same day, the same scripted opponent, the same obvious line for the
 * human: once through the abstract model (exact expectation) and once through
 * the real engine (executeLandAttack, advanceToNextPlayer, the simulator's own
 * capture/hold lines) with seeded dice. Their win rates must agree within
 * sampling error. This is the check the design brief names as the main
 * correctness risk: the model drifting from the rules it claims to mirror.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap } from '../../../types';
import { scheduleDay } from '../dailySchedule';
import { buildState, captureLine, holdLine, resolution } from '../puzzleSim';
import { advanceToNextPlayer } from '../../state/gameStateManager';
import { createSeededRng, hashStringToSeed } from '../../victory/missions';
import { contextFromSpec, inferPlan, stateFromSpec } from './bridge';
import { compilePlan } from './opponent';
import { runScriptedAiTurn } from './engineOpponent';
import { obviousLine } from './obvious';
import { Solver } from './solver';
import type { DailyPuzzleSpec } from '../dailyPuzzleTypes';

const HUMAN_ID = 'sim_human';
const AI_ID = 'ai_1';

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  if (!mapCache.has(mapId)) {
    mapCache.set(mapId, JSON.parse(readFileSync(join(__dirname, `../../../../../database/maps/${mapId}.json`), 'utf-8')) as GameMap);
  }
  return mapCache.get(mapId)!;
}

async function engineWinRate(spec: DailyPuzzleSpec, map: GameMap, games: number): Promise<number> {
  const ctx = contextFromSpec(spec, map);
  const plan = inferPlan(spec, ctx);
  let solved = 0;
  for (let i = 0; i < games; i++) {
    const rng = createSeededRng(hashStringToSeed(`parity:${spec.seed}:${i}`));
    const dieRoll = () => Math.floor(rng() * 6) + 1;
    const state = buildState(spec, map);
    let outcome = resolution(state, map, spec);
    let guard = 0;
    while (!outcome && guard < (spec.max_turns + 2) * 2 + 4) {
      guard += 1;
      const player = state.players[state.current_player_index];
      if (!player.is_eliminated) {
        if (player.player_id === HUMAN_ID) {
          if (spec.archetype === 'hold_territory') holdLine(state, map, spec);
          else captureLine(state, map, spec, dieRoll);
        } else {
          await runScriptedAiTurn(state, map, ctx, plan, HUMAN_ID, AI_ID, { dieRoll });
        }
      }
      outcome = resolution(state, map, spec);
      if (outcome) break;
      advanceToNextPlayer(state, map);
      outcome = resolution(state, map, spec);
    }
    if (outcome === 'solved') solved += 1;
  }
  return solved / games;
}

function modelWinRate(spec: DailyPuzzleSpec, map: GameMap): number {
  const ctx = contextFromSpec(spec, map);
  const plan = inferPlan(spec, ctx);
  const solver = new Solver({ ctx, plan: compilePlan(ctx, plan) }, 2_000_000);
  return solver.policyValue(stateFromSpec(ctx, spec), obviousLine);
}

// A capture day, a hold day and a hard capture day from the live schedule —
// three eras, one with legion reroll, one with rifle doctrine.
const DAYS = ['2026-09-21', '2026-09-23', '2026-09-26'];
const GAMES = 400;
// Two standard errors at p≈0.5 and N=400 is ≈5 points; the policies also
// differ in tiny ways (which reserve a tie picks), so allow 7.
const TOLERANCE = 0.07;

describe('puzzle model vs engine — the obvious line against the scripted opponent', { timeout: 300_000 }, () => {
  for (const date of DAYS) {
    it(`${date}: win rates agree within ${TOLERANCE * 100} points`, async () => {
      const day = await scheduleDay(date, { loadMap });
      const spec = day.spec;
      const map = (await loadMap(spec.map_id))!;
      const model = modelWinRate(spec, map);
      const engine = await engineWinRate(spec, map, GAMES);
      expect(Math.abs(model - engine)).toBeLessThan(TOLERANCE);
    });
  }
});
