/**
 * Headless first-match simulator: how long does a new player's first Quick
 * Match take, and how often do they win it?
 *
 * Seat 0 stands in for the newcomer: a human seat, as in the live game, played
 * by the engine's own AI at SIM_NEWCOMER difficulty. `easy` models someone who
 * barely presses, `medium` someone who attacks with purpose. Every other seat
 * is an Easy bot. Rules are the lobby's Quick Match payload (no economy, tech,
 * factions, naval, events or diplomacy; territory cards on, escalating) with
 * the default Conquest ending: domination or 65% of the board, 60-round cap
 * (SIM_MAX_TURNS), baked by the server's own bakeCreateGameSettings.
 *
 * Every seat plays through planAiTurn and playAiTurn
 * (src/game-engine/ai/runAiTurn.ts), the turn the live game runs, with the
 * live bot flags (SIM_FLAGS overrides them, as aiHarness.parseAiTurnFlags
 * reads them). A bot that is beaten resigns, as processAiTurn's opening does;
 * the newcomer, a person, never does.
 *
 * By default the game is set up as the live first match: tagged `first_match`
 * and started with the first-match fair start (first_match_fair_start_enabled),
 * so the newcomer moves first and no seat is dealt a whole region.
 * SIM_FIRST_MATCH_RULES=0 drops both and rotates who moves first instead.
 *
 * Every draw is seeded: the deal, the dice and every other `crypto` draw in
 * the engine (seededEngineRandomness.ts), the planners' score jitter and the
 * card ids, so a run is the same each time it runs. (The old loop seeded only
 * the dice: three runs of one configuration gave 48, 49 and 50%.)
 *
 * Minutes are an estimate, not a measurement. A bot turn costs 0.6s per paced
 * step (each placement, card trade, attack exchange and fortify move waits
 * 600ms in gameSocket's AI loop) plus SIM_BOT_TURN_OVERHEAD seconds; a
 * newcomer turn costs SIM_HUMAN_TURN_SECONDS. The first match ends for the
 * newcomer when someone wins or when they are eliminated.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simFirstMatch.ts
 *   SIM_GAMES=400 SIM_MAPS=era_risorgimento SIM_BOTS=2 SIM_NEWCOMER=medium \
 *     SIM_HUMAN_TURN_SECONDS=60 pnpm exec tsx scripts/simFirstMatch.ts
 *   SIM_FLAGS=oddsPress=0 pnpm exec tsx scripts/simFirstMatch.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiDifficulty, EraId, GameMap, GameState } from '../src/types';
import { initializeGameState } from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import { headlessAiTurnHooks, planAiTurn, playAiTurn } from '../src/game-engine/ai/runAiTurn';
import { resignIfBeaten, victoryAfterResignation } from '../src/game-engine/ai/aiResign';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { bakeCreateGameSettings, type CreateGameSettingsInput } from '../src/modules/games/createGameSettings';
import { featureFlags } from '../src/config/featureFlags';
import { describeAiTurnFlags, handOff, parseAiTurnFlags, resolveChoiceCard } from './aiHarness';
import { seedEngineRandomness, seededUuid } from './seededEngineRandomness';

const GAMES = Number(process.env.SIM_GAMES ?? 300);
const MAPS = (process.env.SIM_MAPS ?? 'era_risorgimento,community_britain_925').split(',').map((s) => s.trim());
const BOT_COUNTS = (process.env.SIM_BOTS ?? '1,2,3').split(',').map((s) => Number(s.trim()));
const NEWCOMERS = (process.env.SIM_NEWCOMER ?? 'easy,medium').split(',').map((s) => s.trim() as AiDifficulty);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-first-match';
const HUMAN_TURN_SECONDS = Number(process.env.SIM_HUMAN_TURN_SECONDS ?? 45);
const BOT_TURN_OVERHEAD = Number(process.env.SIM_BOT_TURN_OVERHEAD ?? 1);
const BOT_STEP_SECONDS = 0.6;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 60);
const FIRST_MATCH_RULES = process.env.SIM_FIRST_MATCH_RULES !== '0';
const FLAGS = parseAiTurnFlags('SIM_FLAGS', process.env.SIM_FLAGS);

/**
 * The era each map is created under: the first match's (frontend
 * utils/firstMatch.ts, FIRST_MATCH_ERA_ID) for Britain, and Risorgimento's own.
 */
const MAP_ERA: Record<string, EraId> = {
  era_risorgimento: 'risorgimento',
  community_britain_925: 'medieval',
};

function loadMap(id: string): GameMap {
  return JSON.parse(readFileSync(join(__dirname, `../../database/maps/${id}.json`), 'utf-8')) as GameMap;
}

/** The lobby's Quick Match payload (LobbyPage startQuickMatch), the Conquest ending. */
function quickMatchSettings(): CreateGameSettingsInput {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 65,
    max_turns: MAX_TURNS,
    ...(FIRST_MATCH_RULES ? { first_match: true } : {}),
  } as CreateGameSettingsInput;
}

type Ending = 'newcomer_won' | 'bot_won' | 'newcomer_out' | 'cap';

interface GameResult {
  ending: Ending;
  rounds: number;
  newcomerTurns: number;
  botTurns: number;
  botSteps: number;
  minutes: number;
}

async function runGame(map: GameMap, mapId: string, era: EraId, bots: number, newcomer: AiDifficulty, index: number): Promise<GameResult> {
  const seats = bots + 1;
  const tag = `${MASTER_SEED}:${mapId}:${bots}:${newcomer}:${index}`;
  seedEngineRandomness(`${tag}:engine`);
  const jitter = createSeededRng(hashStringToSeed(`${tag}:jitter`));
  const players = Array.from({ length: seats }, (_, i) => ({
    player_id: `p_${i}`,
    player_index: i,
    username: i === 0 ? 'Newcomer' : `Bot-${i}`,
    color: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'][i] ?? '#9b59b6',
    is_ai: i > 0,
    ...(i > 0 ? { ai_difficulty: 'easy' as AiDifficulty } : {}),
    is_eliminated: false,
    mmr: 1000,
  }));
  const settings = bakeCreateGameSettings({ era_id: era, map_id: mapId, hasMoon: false, settings: quickMatchSettings() });
  const state = initializeGameState(
    `first_${index}`,
    era,
    structuredClone(map),
    players,
    settings,
    FIRST_MATCH_RULES
      ? { fairFirstMatchStart: featureFlags.firstMatchFairStartEnabled }
      // Rotate who moves first, so the newcomer's seat order averages out.
      : { forceStartingPlayerIndex: index % seats },
  );
  // The engine picks a card set by sorting on card id, and uuid drew these
  // before the seeded stream could (seededEngineRandomness.ts).
  for (const card of state.card_deck ?? []) card.card_id = seededUuid();

  let botSteps = 0;
  let countSteps = false;
  const headless = headlessAiTurnHooks(state, map);
  const hooks = { ...headless, delay: async () => { if (countSteps) botSteps += 1; } };

  let newcomerTurns = 0;
  let botTurns = 0;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * seats + 5) {
    guard += 1;
    const player = state.players[state.current_player_index]!;
    const isNewcomer = player.player_index === 0;
    const level: AiDifficulty = isNewcomer ? newcomer : 'easy';
    resolveChoiceCard(state);
    // processAiTurn's opening: a beaten bot resigns before it plans. A person does not.
    if (!isNewcomer && resignIfBeaten(state, player, level, FLAGS.resignation)) {
      const victory = victoryAfterResignation(state, map);
      if (victory) {
        state.phase = 'game_over';
        state.winner_id = victory.winnerIds[0]!;
        state.winner_ids = victory.winnerIds;
        state.victory_condition = victory.condition;
        break;
      }
    } else {
      const plan = await planAiTurn(state, map, player, level, FLAGS, {
        planningState: () => state,
        plan: async (s, m, d, o) => computeAiTurn(s, m, d, { ...o, rng: jitter }),
        rng: jitter,
      });
      countSteps = !isNewcomer;
      const outcome = await playAiTurn(state, map, player, level, plan, 'draft', hooks);
      countSteps = false;
      if (isNewcomer) newcomerTurns += 1;
      else botTurns += 1;
      if (outcome === 'over') break;
    }
    // The first match is over for the newcomer once they are out.
    if (state.players[0]!.is_eliminated) break;
    handOff(state, map);
    if (await hooks.victoryCheck()) break;
  }

  // As the old loop classed them: a game a bot won outright (taking the
  // newcomer's last territory included) is the bot's; the newcomer knocked out
  // while bots play on (`humans_eliminated`, or the loop's own stop) is "out".
  const ending: Ending = state.victory_condition === 'turn_limit'
    ? 'cap'
    : state.victory_condition === 'humans_eliminated'
      ? 'newcomer_out'
      : state.winner_id
        ? state.winner_id === 'p_0' ? 'newcomer_won' : 'bot_won'
        : state.players[0]!.is_eliminated ? 'newcomer_out' : 'cap';
  const seconds = newcomerTurns * HUMAN_TURN_SECONDS + botSteps * BOT_STEP_SECONDS + botTurns * BOT_TURN_OVERHEAD;
  return { ending, rounds: state.turn_number, newcomerTurns, botTurns, botSteps, minutes: seconds / 60 };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${Math.round((100 * n) / d)}%`;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

(async () => {
  console.log(
    `First-match sim: ${GAMES} games per row, seed "${MASTER_SEED}", newcomer turn ${HUMAN_TURN_SECONDS}s, ` +
      `bot turn ${BOT_TURN_OVERHEAD}s + ${BOT_STEP_SECONDS}s per step\n` +
      `rules: ${FIRST_MATCH_RULES ? 'the live first match (newcomer moves first, no whole region dealt)' : 'Quick Match, who moves first rotated'}\n` +
      `bot flags: ${describeAiTurnFlags(FLAGS)}\n`,
  );
  console.log('| Map | Easy bots | Newcomer plays as | Newcomer wins | Newcomer out | Bot wins | Hit cap | Median rounds | Median min | 80th pct min |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const mapId of MAPS) {
    const map = loadMap(mapId);
    const era: EraId = MAP_ERA[mapId] ?? 'ancient';
    for (const bots of BOT_COUNTS) {
      for (const newcomer of NEWCOMERS) {
        const results: GameResult[] = [];
        for (let i = 0; i < GAMES; i += 1) results.push(await runGame(map, mapId, era, bots, newcomer, i));
        const count = (e: Ending) => results.filter((r) => r.ending === e).length;
        const minutes = results.map((r) => r.minutes);
        console.log(
          `| ${mapId} | ${bots} | ${newcomer} | ${pct(count('newcomer_won'), GAMES)} | ${pct(count('newcomer_out'), GAMES)} | ` +
            `${pct(count('bot_won'), GAMES)} | ${pct(count('cap'), GAMES)} | ${quantile(results.map((r) => r.rounds), 0.5)} | ` +
            `${quantile(minutes, 0.5).toFixed(1)} | ${quantile(minutes, 0.8).toFixed(1)} |`,
        );
      }
    }
  }
})();
