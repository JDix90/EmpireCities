/**
 * Headless campaign-stage harness: how hard is each stage, actually?
 *
 * Seat 0 is a fixed-strength stand-in for the player; seats 1..n are the
 * stage's own AI at its own difficulty, factions and count, under its own
 * victory condition, clock and starting-unit handicap. The stand-in never
 * changes, so a win rate is comparable ACROSS stages: it says which stage is
 * harder, not what a person would score against it.
 *
 * Everything the run samples hangs off SIM_SEED: combat dice and every other
 * draw the engine makes (seededEngineRandomness.ts), the planner's jitter,
 * and — through the game id — secret-mission assignment. Two runs of
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
 * Every seat plays through planAiTurn and playAiTurn
 * (src/game-engine/ai/runAiTurn.ts), the turn the live game runs: card
 * trade-ins, faction abilities, builds and research come with it, and so does
 * every AI feature flag. The stage's AI and the stand-in each take the live
 * flags, with their own overrides (SIM_AI_FLAGS, SIM_STANDIN_FLAGS), so the
 * stage's opposition can be measured with a flag on against a stand-in that
 * stays exactly as it was. Each stage ends with a digest of every game's
 * record, the same on every run of that configuration and seed.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_HANDICAP=1 SIM_GAMES=300 pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_STAGES=last_defenders:5 SIM_MISSIONS=1 pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_STAGES=last_defenders:1 SIM_AI_COUNT=2 SIM_CLOCK=25 pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_PATCH='parthia.reinforce_bonus=0' pnpm exec tsx scripts/simCampaignStages.ts
 *   SIM_AI_FLAGS=oddsPress=1,plannedDraft=1,endingPlay=1 pnpm exec tsx scripts/simCampaignStages.ts
 *
 * The bots' settings (environment):
 *   SIM_AI_FLAGS        name=0|1 overrides of the live AI flags for the stage's
 *   SIM_STANDIN_FLAGS     AI, and for the stand-in: captureOddsScoring,
 *                         attackGrind, decidedGamePress, oddsPress,
 *                         plannedDraft, endingPlay, resignation. Unset flags
 *                         take the live code default. The stand-in is a human
 *                         seat, so it never resigns.
 *   SIM_AI_PROFILE      JSON object of AiProfile fields that replace the
 *                         stage's difficulty row for its AI, on every stage.
 *
 * Campaign games keep today's bots (ai/aiProfiles.ts keepsTodaysBots), so
 * the newer AI flags (oddsPress, plannedDraft, endingPlay, resignation) do
 * nothing here, as in the live game. What they would do to each stage is
 * measured in PR #548; lifting that rule is the step before measuring again.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiDifficulty, EraId, GameMap, GameSettings, VictoryType } from '../src/types';
import { initializeGameState } from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import type { AiLevel } from '../src/game-engine/ai/aiProfiles';
import { DEFAULT_CARD_SET_BONUS_CAP } from '../src/game-engine/combat/combatResolver';
import { headlessAiTurnHooks, planAiTurn, playAiTurn } from '../src/game-engine/ai/runAiTurn';
import { resignIfBeaten, victoryAfterResignation } from '../src/game-engine/ai/aiResign';
import { assignSecretMissions, createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { CAMPAIGN_PATHS, type PathEraConfig } from '../src/modules/campaign/campaignPaths';
import { getEraFactions } from '../src/game-engine/eras';
import { describeAiTurnFlags, handOff, parseAiLevel, parseAiTurnFlags, resolveChoiceCard } from './aiHarness';
import { seedEngineRandomness, seededUuid } from './seededEngineRandomness';

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

/** The live AI flags, with each side's overrides. */
const AI_FLAGS = parseAiTurnFlags('SIM_AI_FLAGS', process.env.SIM_AI_FLAGS);
const STANDIN_FLAGS = parseAiTurnFlags('SIM_STANDIN_FLAGS', process.env.SIM_STANDIN_FLAGS);
/** The stage AI's level: the stage's difficulty, or a profile over its row. */
const aiLevel = (d: AiDifficulty): AiLevel => parseAiLevel('SIM_AI_PROFILE', d, process.env.SIM_AI_PROFILE);

/**
 * In-memory kit patch, same syntax as simFactionBalance.ts:
 * `SIM_PATCH='parthia.reinforce_bonus=0;germanic_tribes.home_region_ids=[germanic,steppe]'`,
 * with `null` to delete a field.
 *
 * A faction change and a stage change land on the same win rate, so without
 * this the two cannot be told apart: when the ancient balance pass moved The
 * Last Defenders' opening stage, only reverting one faction at a time showed
 * that the player's own buff was carrying it and the AI's was not.
 *
 * Faction ids are unique across eras, so a clause is applied to whichever
 * era's roster holds it.
 */
for (const clause of (process.env.SIM_PATCH ?? '').split(';').map((c) => c.trim()).filter(Boolean)) {
  const [lhs, rhs] = clause.split('=');
  const [factionId, field] = (lhs ?? '').split('.');
  const target = CAMPAIGN_ERAS
    .flatMap((era) => getEraFactions(era))
    .find((f) => f.faction_id === factionId) as Record<string, unknown> | undefined;
  if (!target || !field) throw new Error(`SIM_PATCH: cannot resolve "${clause}"`);
  if (rhs === 'null') delete target[field];
  else if (rhs?.startsWith('[') && rhs.endsWith(']')) {
    target[field] = rhs.slice(1, -1).split(',').map((v) => v.trim()).filter(Boolean);
  } else target[field] = rhs != null && rhs !== '' && !Number.isNaN(Number(rhs)) ? Number(rhs) : rhs;
}

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

interface StageResult {
  wins: number;
  losses: number;
  draws: number;
  turns: number[];
  byCondition: Map<string, number>;
  byMission: Map<string, { drawn: number; won: number }>;
  /** Each game's ending, for the digest: winner, condition, last turn, territories by seat. */
  records: Array<[string | null, string | null, number, number[]]>;
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
    wins: 0, losses: 0, draws: 0, turns: [], byCondition: new Map(), byMission: new Map(), records: [],
  };
  const stageLevel = aiLevel(stage.ai_difficulty);

  for (let g = 0; g < GAMES; g++) {
    // One knob for the whole sample. The game id is not decoration: the engine
    // seeds secret-mission assignment from it (gameStateManager), so an id that
    // does not follow SIM_SEED would hand every seat different objectives while
    // claiming to be the same run.
    const gameId = `${SEED}:${pathId}:${index}:${g}`;
    // The dice and every other draw the engine makes, then the planner's jitter.
    seedEngineRandomness(`${gameId}:engine`);
    const jitter = createSeededRng(hashStringToSeed(gameId));
    // Seat 0 stays a human seat, as in the route: the campaign carries and
    // the handicap apply to it, and it plays as the stand-in.
    const players = Array.from({ length: seats }, (_, i) => ({
      player_id: `p_${i}`,
      player_index: i,
      username: i === 0 ? 'Player' : `AI-${i}`,
      color: COLORS[i % COLORS.length],
      is_ai: i > 0,
      ...(i > 0 ? { ai_difficulty: stage.ai_difficulty } : {}),
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
      // As the route sets it. The old loop never traded a card, so it never needed it.
      card_set_bonus_cap: DEFAULT_CARD_SET_BONUS_CAP,
      campaign_carry: NO_CARRY ? {} : { ...initialCarry, ...EXTRA_CARRY },
      ...(HANDICAP && stage.starting_unit_modifier
        ? { campaign_starting_units_delta: stage.starting_unit_modifier }
        : {}),
    } as unknown as GameSettings;

    const state = initializeGameState(
      gameId, era, map, players, settings,
      { forceStartingPlayerIndex: g % seats },
    );
    // The engine picks a card set by sorting on card id, and uuid drew these
    // before the seeded stream could (seededEngineRandomness.ts).
    for (const card of state.card_deck ?? []) card.card_id = seededUuid();

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

    const hooks = headlessAiTurnHooks(state, map);
    let guard = 0;
    while (state.phase !== 'game_over' && guard < (clock + 2) * seats + 5) {
      guard += 1;
      const current = state.players[state.current_player_index];
      const standin = current.player_index === 0;
      const level = standin ? STANDIN : stageLevel;
      const flags = standin ? STANDIN_FLAGS : AI_FLAGS;
      resolveChoiceCard(state);
      // processAiTurn's opening: a beaten bot resigns before it plans.
      if (resignIfBeaten(state, current, level, flags.resignation)) {
        const victory = victoryAfterResignation(state, map);
        if (victory) {
          state.phase = 'game_over';
          state.winner_id = victory.winnerIds[0]!;
          state.winner_ids = victory.winnerIds;
          state.victory_condition = victory.condition;
          break;
        }
      } else {
        const plan = await planAiTurn(state, map, current, level, flags, {
          planningState: () => state,
          plan: async (s, m, d, o) => computeAiTurn(s, m, d, { ...o, rng: jitter }),
          rng: jitter,
        });
        if (await playAiTurn(state, map, current, level, plan, 'draft', hooks) === 'over') break;
      }
      handOff(state, map);
      if (await hooks.victoryCheck()) break;
    }
    if (state.winner_id && state.victory_condition) {
      const key = `${state.winner_id === 'p_0' ? 'P' : 'AI'}:${state.victory_condition}`;
      res.byCondition.set(key, (res.byCondition.get(key) ?? 0) + 1);
    }

    res.turns.push(state.turn_number);
    res.records.push([
      state.winner_id ?? null,
      state.victory_condition ?? null,
      state.turn_number,
      state.players.map((p) => p.territory_count ?? 0),
    ]);
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
  const profile = process.env.SIM_AI_PROFILE?.trim();
  console.log(
    `stand-in=${STANDIN} games/stage=${GAMES} seed=${SEED}`
    + ` default clock=${DEFAULT_MAX_TURNS}`
    + ` handicap=${HANDICAP ? 'APPLIED' : 'off'}`
    + `\nstage AI: [${describeAiTurnFlags(AI_FLAGS)}]${profile ? ` with ${profile}` : ''}`
    + `\nstand-in: [${describeAiTurnFlags(STANDIN_FLAGS)}]\n`,
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
        + [...r.byCondition.entries()].sort().map(([k, n]) => `${k}=${n}`).join(' ')
        + `  digest ${hashStringToSeed(JSON.stringify(r.records)).toString(16).padStart(8, '0')}`,
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
