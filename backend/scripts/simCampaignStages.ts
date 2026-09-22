/**
 * Headless campaign-stage harness: how hard is each stage, actually?
 *
 * Seat 0 is a fixed-strength stand-in for the player; seats 1..n are the
 * stage's own AI at its own difficulty, factions and count, under its own
 * victory condition, clock and starting-unit handicap. The stand-in never
 * changes, so a win rate is comparable ACROSS stages: it says which stage is
 * harder, not what a person would score against it.
 *
 * Everything the run samples hangs off SIM_SEED: combat dice, the planner's
 * jitter, and — through the game id — secret-mission assignment. Two runs of
 * the same config at the same seed are identical, which is what makes an A/B
 * between configs mean anything; production leaves `randomFactor` on
 * Math.random, and without seeding it a stage's win rate moved ten points
 * between runs of the same config. Absolute rates still shift a few points
 * between seeds, so compare a candidate against the baseline at the SAME seed
 * and check a result that matters across two or three of them.
 *
 * Output columns: the stage's config, win / loss / draw for seat 0, the average
 * turn the stage ended on, and a breakdown of HOW each side won — `P:` is the
 * player, `AI:` the opposition. That breakdown is the useful part. A stage
 * ending on turn 2 with `AI:threshold` means the victory line was crossed at
 * the deal; `AI:humans_eliminated` means the player is being wiped out rather
 * than out-raced; `AI:turn_limit` means the clock ran out with an AI ahead.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_HANDICAP=1 SIM_GAMES=300 pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_STAGES=last_defenders:5 SIM_MISSIONS=1 pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_STAGES=last_defenders:1 SIM_AI_COUNT=2 SIM_CLOCK=25 pnpm exec tsx scripts/simCampaignStages.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { AiDifficulty, EraId, GameMap, GameSettings, GameState, VictoryType } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  initializeGameState,
} from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import { aiAttackExchangeBudget, runAiAttackExchanges } from '../src/game-engine/ai/aiAttackGrind';
import { assignSecretMissions, createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { CAMPAIGN_PATHS, type PathEraConfig } from '../src/modules/campaign/campaignPaths';

/**
 * The era a stage actually runs under. `createEraGame` takes it from this list
 * BY INDEX, not from the stage's own `era` field — a stage naming a different
 * era there changes nothing about the game, which is how eight stages once
 * shipped locking factions that did not exist in the era they ran in. The
 * harness resolves it the same way so it measures the game the route builds.
 */
const CAMPAIGN_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'];

const GAMES = Number(process.env.SIM_GAMES ?? 100);
/** Clock for stages that declare none; the campaign route uses 100. */
const DEFAULT_MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 100);
const STANDIN = (process.env.SIM_STANDIN ?? 'medium') as AiDifficulty;
const SEED = process.env.SIM_SEED ?? 'campaign';
/** Apply each stage's `starting_unit_modifier` to seat 0, as the route does. */
const HANDICAP = process.env.SIM_HANDICAP === '1';
/** Break the result down by which secret mission seat 0 drew. */
const MISSIONS = process.env.SIM_MISSIONS === '1';
/** Restrict the sweep, e.g. `last_defenders:0,blood_empire:1` (path:index). */
const ONLY = (process.env.SIM_STAGES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Config overrides, for asking "what if" without editing campaignPaths.ts. */
const OVERRIDE_DIFFICULTY = process.env.SIM_DIFFICULTY as AiDifficulty | undefined;
const OVERRIDE_AI_COUNT = process.env.SIM_AI_COUNT == null ? null : Number(process.env.SIM_AI_COUNT);
const OVERRIDE_UNIT_MOD = process.env.SIM_UNIT_MOD == null ? null : Number(process.env.SIM_UNIT_MOD);
const OVERRIDE_THRESHOLD = process.env.SIM_THRESHOLD == null ? null : Number(process.env.SIM_THRESHOLD);
const OVERRIDE_CLOCK = process.env.SIM_CLOCK == null ? null : Number(process.env.SIM_CLOCK);
const OVERRIDE_VICTORY = (process.env.SIM_VICTORY ?? '')
  .split(',').map((v) => v.trim()).filter(Boolean) as VictoryType[];
/** Extra carry for seat 0, e.g. `survivor_bonus:2`. Merged over the path's own. */
const EXTRA_CARRY = (process.env.SIM_CARRY ?? '').split(',').map((c) => c.trim()).filter(Boolean)
  .reduce<Record<string, number>>((acc, pair) => {
    const [key, value] = pair.split(':');
    if (key) acc[key] = Number(value);
    return acc;
  }, {});
/** Ignore the path's opening carry, to reproduce a config as it shipped. */
const NO_CARRY = process.env.SIM_NO_CARRY === '1';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

const mapCache = new Map<string, GameMap>();
function loadMap(mapId: string): GameMap {
  const cached = mapCache.get(mapId);
  if (cached) return cached;
  const loaded = JSON.parse(
    readFileSync(join(__dirname, '../../database/maps', `${mapId}.json`), 'utf-8'),
  ) as GameMap;
  mapCache.set(mapId, loaded);
  return loaded;
}

/** The stage as this run will play it, after any SIM_* overrides. */
function resolveStage(stage: PathEraConfig): PathEraConfig {
  const aiCount = OVERRIDE_AI_COUNT ?? stage.ai_count;
  return {
    ...stage,
    ai_difficulty: OVERRIDE_DIFFICULTY ?? stage.ai_difficulty,
    ai_count: aiCount,
    ai_factions: OVERRIDE_AI_COUNT != null ? stage.ai_factions.slice(0, aiCount) : stage.ai_factions,
    allowed_victory_conditions: OVERRIDE_VICTORY.length > 0
      ? OVERRIDE_VICTORY
      : stage.allowed_victory_conditions,
    victory_threshold: OVERRIDE_THRESHOLD ?? stage.victory_threshold,
    max_turns: OVERRIDE_CLOCK ?? stage.max_turns,
    starting_unit_modifier: OVERRIDE_UNIT_MOD ?? stage.starting_unit_modifier,
  };
}

function ownedIds(state: GameState, pid: string): string[] {
  return Object.keys(state.territories).filter((t) => state.territories[t].owner_id === pid).sort();
}

/** One seat's full turn, mirroring processAiTurn's pure-engine sequence. */
async function playTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  rng: () => number,
): Promise<void> {
  state.phase = 'draft';
  const plan: AiAction[] = computeAiTurn(state, map, difficulty, { captureOddsScoring: true, rng });

  const remaining = state.draft_units_remaining ?? 0;
  if (remaining > 0) {
    const owned = ownedIds(state, pid);
    if (owned.length > 0) {
      const planned = plan.find(
        (a) => a.type === 'draft' && a.to && state.territories[a.to]?.owner_id === pid,
      )?.to;
      state.territories[planned ?? owned[0]].unit_count += remaining;
    }
    state.draft_units_remaining = 0;
  }

  state.phase = 'attack';
  const budget = { left: aiAttackExchangeBudget(difficulty, false) };
  for (const action of plan) {
    if (action.type !== 'attack' || !action.from || !action.to || action.from === '__influence__') continue;
    const fromId = action.from;
    const toId = action.to;
    const connection = map.connections.find(
      (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId),
    );
    await runAiAttackExchanges({
      state,
      attackerId: pid,
      fromId,
      toId,
      budget,
      canGrind: connection?.type !== 'sea',
      exchange: () => (executeLandAttack(state, pid, fromId, toId, { dieRoll, connection }) ? 'ok' : 'stop'),
    });
    if (budget.left <= 0) break;
  }

  state.phase = 'fortify';
  for (const action of plan) {
    if (action.type !== 'fortify' || !action.from || !action.to) continue;
    const from = state.territories[action.from];
    const to = state.territories[action.to];
    if (!from || !to || from.owner_id !== pid || to.owner_id !== pid) continue;
    const move = Math.min(action.units ?? from.unit_count - 1, from.unit_count - 1);
    if (move > 0) {
      from.unit_count -= move;
      to.unit_count += move;
    }
  }
}

interface StageResult {
  wins: number;
  losses: number;
  draws: number;
  turns: number[];
  byCondition: Map<string, number>;
  byMission: Map<string, { drawn: number; won: number }>;
}

async function runStage(
  pathId: string,
  index: number,
  stage: PathEraConfig,
  initialCarry: Record<string, number>,
): Promise<StageResult> {
  const era = CAMPAIGN_ERAS[index] ?? 'ancient';
  const map = loadMap(stage.map_id);
  const clock = stage.max_turns ?? DEFAULT_MAX_TURNS;
  const seats = stage.ai_count + 1;
  const res: StageResult = {
    wins: 0, losses: 0, draws: 0, turns: [], byCondition: new Map(), byMission: new Map(),
  };

  for (let g = 0; g < GAMES; g++) {
    // One knob for the whole sample. The game id is not decoration: the engine
    // seeds secret-mission assignment from it (gameStateManager), so an id that
    // does not follow SIM_SEED would hand every seat different objectives while
    // claiming to be the same run.
    const gameId = `${SEED}:${pathId}:${index}:${g}`;
    const rng = createSeededRng(hashStringToSeed(gameId));
    const dieRoll = (): number => Math.floor(rng() * 6) + 1;
    const players = Array.from({ length: seats }, (_, i) => ({
      player_id: `p_${i}`,
      player_index: i,
      username: i === 0 ? 'Player' : `AI-${i}`,
      color: COLORS[i % COLORS.length],
      is_ai: i > 0,
      is_eliminated: false,
      mmr: 1000,
      faction_id: i === 0 ? stage.locked_faction : stage.ai_factions[i - 1],
    }));

    const settings = {
      allowed_victory_conditions: stage.allowed_victory_conditions,
      victory_type: stage.allowed_victory_conditions[0],
      victory_threshold: stage.victory_threshold,
      factions_enabled: true,
      is_campaign: true,
      max_turns: clock,
      turn_timer_seconds: 0,
      combat_dice_cap_enabled: true,
      campaign_carry: NO_CARRY ? {} : { ...initialCarry, ...EXTRA_CARRY },
      ...(HANDICAP && stage.starting_unit_modifier
        ? { campaign_starting_units_delta: stage.starting_unit_modifier }
        : {}),
    } as unknown as GameSettings;

    const state = initializeGameState(
      gameId, era, map, players, settings,
      { forceStartingPlayerIndex: g % seats },
    );

    // Re-assign secret missions from the seed. The engine salts mission
    // assignment with `randomBytes` per game on purpose — the salt is what
    // stops a client recomputing every opponent's objective — which also makes
    // a mission stage irreproducible from outside. A balance harness needs the
    // opposite, so it replaces the salt with one derived from SIM_SEED and
    // re-runs the engine's own assignment. Nothing else reads the salt here.
    if (stage.allowed_victory_conditions.includes('secret_mission')) {
      state.mission_seed_salt = `${SEED}:salt`;
      assignSecretMissions(
        state, map,
        createSeededRng(hashStringToSeed(`${gameId}:${state.mission_seed_salt}:secret_missions`)),
      );
    }

    const missionKind = (state.players[0] as { secret_mission?: { kind?: string } })
      .secret_mission?.kind ?? 'none';

    let guard = 0;
    while (state.phase !== 'game_over' && guard < (clock + 2) * seats + 5) {
      guard += 1;
      const current = state.players[state.current_player_index];
      if (!current.is_eliminated) {
        await playTurn(
          state, map, current.player_id,
          current.player_index === 0 ? STANDIN : stage.ai_difficulty,
          dieRoll, rng,
        );
      }
      advanceToNextPlayer(state, map);
      const victory = checkVictory(state, map);
      if (victory) {
        state.phase = 'game_over';
        state.winner_id = victory.winnerIds[0] ?? null;
        const key = `${victory.winnerIds[0] === 'p_0' ? 'P' : 'AI'}:${victory.condition}`;
        res.byCondition.set(key, (res.byCondition.get(key) ?? 0) + 1);
        break;
      }
    }

    res.turns.push(state.turn_number);
    const won = state.winner_id === 'p_0';
    const tally = res.byMission.get(missionKind) ?? { drawn: 0, won: 0 };
    tally.drawn += 1;
    if (won) tally.won += 1;
    res.byMission.set(missionKind, tally);
    if (won) res.wins += 1;
    else if (state.winner_id) res.losses += 1;
    else res.draws += 1;
  }
  return res;
}

async function main(): Promise<void> {
  const pct = (n: number): string => `${Math.round((n / GAMES) * 100)}%`;
  console.log(
    `stand-in=${STANDIN} games/stage=${GAMES} seed=${SEED}`
    + ` default clock=${DEFAULT_MAX_TURNS}`
    + ` handicap=${HANDICAP ? 'APPLIED' : 'off'}\n`,
  );

  for (const [pathId, path] of Object.entries(CAMPAIGN_PATHS)) {
    const printed: string[] = [];
    for (const [index, authored] of path.eras.entries()) {
      if (ONLY.length > 0 && !ONLY.includes(`${pathId}:${index}`)) continue;
      const stage = resolveStage(authored);
      const carry = NO_CARRY ? {} : (path.initial_carry as Record<string, number>);
      const r = await runStage(pathId, index, stage, carry ?? {});
      const avg = (r.turns.reduce((a, b) => a + b, 0) / r.turns.length).toFixed(0);
      if (printed.length === 0) {
        console.log(`=== ${path.name} ===`);
        console.log(
          `${'#'.padEnd(3)}${'era'.padEnd(12)}${'AI'.padEnd(8)}${'n'.padEnd(3)}${'mod'.padEnd(5)}`
          + `${'thr'.padEnd(5)}${'clock'.padEnd(7)}${'win'.padEnd(6)}${'loss'.padEnd(6)}`
          + `${'draw'.padEnd(6)}${'avg'.padEnd(6)}how it ended`,
        );
      }
      printed.push(pathId);
      console.log(
        `${String(index + 1).padEnd(3)}${(CAMPAIGN_ERAS[index] ?? '?').padEnd(12)}${stage.ai_difficulty.padEnd(8)}`
        + `${String(stage.ai_count).padEnd(3)}${String(stage.starting_unit_modifier).padEnd(5)}`
        + `${String(stage.victory_threshold ?? '-').padEnd(5)}${String(stage.max_turns ?? '-').padEnd(7)}`
        + `${pct(r.wins).padEnd(6)}${pct(r.losses).padEnd(6)}${pct(r.draws).padEnd(6)}${avg.padEnd(6)}`
        + [...r.byCondition.entries()].sort().map(([k, n]) => `${k}=${n}`).join(' '),
      );
      if (MISSIONS) {
        for (const [kind, v] of [...r.byMission.entries()].sort()) {
          console.log(
            `      mission ${kind.padEnd(22)} drawn ${String(v.drawn).padStart(3)}`
            + `  won ${String(v.won).padStart(3)}  (${Math.round((v.won / v.drawn) * 100)}%)`,
          );
        }
      }
    }
    if (printed.length > 0) console.log();
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
