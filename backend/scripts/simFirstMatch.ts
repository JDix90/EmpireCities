/**
 * Headless first-match simulator: how long does a new player's first Quick
 * Match take, and how often do they win it?
 *
 * Seat 0 stands in for the newcomer, played by the engine's own AI at
 * SIM_NEWCOMER difficulty: `easy` models someone who barely presses, `medium`
 * someone who attacks with purpose. Every other seat is an Easy bot. Rules are
 * Quick Match's classic set (no economy, tech, factions, naval, events or
 * diplomacy; territory cards on, escalating) with the default Conquest ending:
 * domination or 65% of the board, 60-round cap (SIM_MAX_TURNS).
 *
 * Each AI turn mirrors processAiTurn's land sequence: redeem card sets, draft,
 * attack through the same runAiAttackExchanges the socket uses (with the
 * shipped grind, capture-odds and decided-game-press settings), draw one card
 * after a capture, fortify.
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
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { AiDifficulty, EraId, GameMap, GameSettings, GameState } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  drawCard,
  findRedeemableCardIds,
  initializeGameState,
  redeemCardSet,
} from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import {
  aiAttackExchangeBudget,
  runAiAttackExchanges,
  shouldPressDecidedGame,
} from '../src/game-engine/ai/aiAttackGrind';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

const GAMES = Number(process.env.SIM_GAMES ?? 300);
const MAPS = (process.env.SIM_MAPS ?? 'era_risorgimento,community_britain_925').split(',').map((s) => s.trim());
const BOT_COUNTS = (process.env.SIM_BOTS ?? '1,2,3').split(',').map((s) => Number(s.trim()));
const NEWCOMERS = (process.env.SIM_NEWCOMER ?? 'easy,medium').split(',').map((s) => s.trim() as AiDifficulty);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-first-match';
const HUMAN_TURN_SECONDS = Number(process.env.SIM_HUMAN_TURN_SECONDS ?? 45);
const BOT_TURN_OVERHEAD = Number(process.env.SIM_BOT_TURN_OVERHEAD ?? 1);
const BOT_STEP_SECONDS = 0.6;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 60);

/** The era each map is played under; only era-specific rules read it, and the classic set has none. */
const MAP_ERA: Record<string, EraId> = {
  era_risorgimento: 'risorgimento',
  community_britain_925: 'medieval',
};

function loadMap(id: string): GameMap {
  return JSON.parse(readFileSync(join(__dirname, `../../database/maps/${id}.json`), 'utf-8')) as GameMap;
}

function settings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    factions_enabled: false,
    naval_enabled: false,
    events_enabled: false,
    economy_enabled: false,
    tech_trees_enabled: false,
    stability_enabled: false,
    era_advancement_enabled: false,
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 65,
    victory_type: 'domination',
    max_turns: MAX_TURNS,
  } as GameSettings;
}

function seededDie(seed: number): () => number {
  const rng = createSeededRng(seed);
  return () => Math.floor(rng() * 6) + 1;
}

function ownedIds(state: GameState, pid: string): string[] {
  return Object.keys(state.territories).filter((t) => state.territories[t].owner_id === pid).sort();
}

/** One AI turn; returns the paced steps it took (each costs 600ms live). */
async function playTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
): Promise<number> {
  let steps = 0;
  const player = state.players.find((p) => p.player_id === pid)!;

  for (;;) {
    const ids = findRedeemableCardIds(player.cards);
    if (!ids) break;
    state.draft_units_remaining = (state.draft_units_remaining ?? 0) + redeemCardSet(state, pid, ids);
    steps += 1;
  }

  const decidedPress = shouldPressDecidedGame(state, pid, difficulty);
  state.phase = 'draft';
  const plan: AiAction[] = computeAiTurn(state, map, difficulty, {
    captureOddsScoring: true,
    decidedGamePress: decidedPress,
  });

  // Place the draft where the plan says, falling back to the first owned
  // territory for anything the plan leaves over.
  let remaining = state.draft_units_remaining ?? 0;
  for (const a of plan) {
    if (remaining <= 0) break;
    if (a.type !== 'draft' || !a.to || !a.units || state.territories[a.to]?.owner_id !== pid) continue;
    const n = Math.min(a.units, remaining);
    state.territories[a.to].unit_count += n;
    remaining -= n;
    steps += 1;
  }
  if (remaining > 0) {
    const owned = ownedIds(state, pid);
    if (owned.length > 0) {
      state.territories[owned[0]].unit_count += remaining;
      steps += 1;
    }
  }
  state.draft_units_remaining = 0;

  state.phase = 'attack';
  const budget = { left: aiAttackExchangeBudget(difficulty, decidedPress) };
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    const fromId = a.from;
    const toId = a.to;
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
      exchange: () => {
        const outcome = executeLandAttack(state, pid, fromId, toId, {
          dieRoll,
          connection,
          onCapture: (s, attacker) => {
            if (!player.card_earned_this_turn) {
              drawCard(s, attacker);
              player.card_earned_this_turn = true;
            }
          },
        });
        steps += 1;
        return outcome ? 'ok' : 'stop';
      },
    });
    if (budget.left <= 0 || checkVictory(state, map)) break;
  }

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type !== 'fortify' || !a.from || !a.to) continue;
    const f = state.territories[a.from];
    const t = state.territories[a.to];
    if (!f || !t || f.owner_id !== pid || t.owner_id !== pid) continue;
    const move = Math.min(a.units ?? f.unit_count - 1, f.unit_count - 1);
    if (move <= 0) continue;
    f.unit_count -= move;
    t.unit_count += move;
    steps += 1;
  }
  return steps;
}

type Ending = 'newcomer_won' | 'bot_won' | 'newcomer_out' | 'cap';

/** A turn-cap result is the cap, whoever led; anything else is a real win. */
function endingOf(victory: NonNullable<ReturnType<typeof checkVictory>>): Ending {
  if (victory.condition === 'turn_limit') return 'cap';
  return victory.winnerIds.includes('p_0') ? 'newcomer_won' : 'bot_won';
}

interface GameResult {
  ending: Ending;
  rounds: number;
  newcomerTurns: number;
  botTurns: number;
  botSteps: number;
  minutes: number;
}

async function runGame(map: GameMap, era: EraId, bots: number, newcomer: AiDifficulty, index: number): Promise<GameResult> {
  const seats = bots + 1;
  const dieRoll = seededDie(hashStringToSeed(`${MASTER_SEED}:${map.map_id}:${bots}:${newcomer}:${index}`));
  const players = Array.from({ length: seats }, (_, i) => ({
    player_id: `p_${i}`,
    player_index: i,
    username: i === 0 ? 'Newcomer' : `Bot-${i}`,
    color: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'][i] ?? '#9b59b6',
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
  }));
  // Rotate who moves first, so the newcomer's seat order averages out.
  const state = initializeGameState(`first_${index}`, era, map, players, settings(), {
    forceStartingPlayerIndex: index % seats,
  });

  let newcomerTurns = 0;
  let botTurns = 0;
  let botSteps = 0;
  let ending: Ending = 'cap';
  let guard = 0;
  while (guard < (MAX_TURNS + 2) * seats + 5) {
    guard += 1;
    const p = state.players[state.current_player_index];
    if (!p.is_eliminated) {
      if (p.player_index === 0) {
        await playTurn(state, map, p.player_id, newcomer, dieRoll);
        newcomerTurns += 1;
      } else {
        botSteps += await playTurn(state, map, p.player_id, 'easy', dieRoll);
        botTurns += 1;
      }
    }
    const victory = checkVictory(state, map);
    if (victory) {
      ending = endingOf(victory);
      break;
    }
    if (ownedIds(state, 'p_0').length === 0) {
      ending = 'newcomer_out';
      break;
    }
    advanceToNextPlayer(state, map);
    const afterPass = checkVictory(state, map);
    if (afterPass) {
      ending = endingOf(afterPass);
      break;
    }
    if (state.turn_number > MAX_TURNS) break;
  }

  const seconds = newcomerTurns * HUMAN_TURN_SECONDS + botSteps * BOT_STEP_SECONDS + botTurns * BOT_TURN_OVERHEAD;
  return { ending, rounds: state.turn_number, newcomerTurns, botTurns, botSteps, minutes: seconds / 60 };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${Math.round((100 * n) / d)}%`;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

(async () => {
  console.log(
    `First-match sim: ${GAMES} games per row, seed "${MASTER_SEED}", newcomer turn ${HUMAN_TURN_SECONDS}s, ` +
      `bot turn ${BOT_TURN_OVERHEAD}s + ${BOT_STEP_SECONDS}s per step\n`,
  );
  console.log('| Map | Easy bots | Newcomer plays as | Newcomer wins | Newcomer out | Bot wins | Hit cap | Median rounds | Median min | 80th pct min |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const mapId of MAPS) {
    const map = loadMap(mapId);
    const era: EraId = MAP_ERA[mapId] ?? 'ancient';
    for (const bots of BOT_COUNTS) {
      for (const newcomer of NEWCOMERS) {
        const results: GameResult[] = [];
        for (let i = 0; i < GAMES; i += 1) results.push(await runGame(map, era, bots, newcomer, i));
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
