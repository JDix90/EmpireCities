/**
 * Headless AI-vs-AI strength gate for attack policy (Week 3, PR 12).
 *
 * Runs the PURE engine — no sockets, no DB — with two identical bots that
 * differ in ONE thing: whether they may spend their per-turn attack budget as
 * dice exchanges on one target (grinding) or as one exchange each on several
 * targets (the old behaviour). Everything else — planner, difficulty, dice
 * stream, map, starting position — is shared, so the win rate isolates the
 * policy.
 *
 * Why this exists: one `executeLandAttack` is one `resolveCombat` exchange,
 * which removes at most two defenders, and the planner emits each edge once per
 * turn. A 3-unit garrison was therefore uncapturable by the AI at any
 * difficulty. Unit tests prove the loop now takes one; this measures whether it
 * makes the bot meaningfully better rather than merely different.
 *
 * Seats swap sides and starting player every game, so first-move advantage and
 * map asymmetry cancel across the sweep.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/aiSelfPlay.ts
 *   SELFPLAY_GAMES=200 SELFPLAY_DIFFICULTY=medium pnpm exec tsx scripts/aiSelfPlay.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { AiDifficulty, GameMap, GameSettings, GameState } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  initializeGameState,
} from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import {
  aiAttackExchangeBudget,
  runAiAttackExchanges,
  shouldPressDecidedGame,
} from '../src/game-engine/ai/aiAttackGrind';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

const GAMES = Number(process.env.SELFPLAY_GAMES ?? 200);
const DIFFICULTY = (process.env.SELFPLAY_DIFFICULTY ?? 'medium') as AiDifficulty;
const MAX_TURNS = Number(process.env.SELFPLAY_MAX_TURNS ?? 80);
const MASTER_SEED = process.env.SELFPLAY_SEED ?? 'borderfall-ai-selfplay';
const MAP_FILE = process.env.SELFPLAY_MAP ?? 'era_ancient';
/**
 * ab           — one seat grinds, one pokes. Measures the GRIND policy's strength.
 * mirror-grind — both seats grind.
 * mirror-poke  — both seats poke (the pre-grind behaviour).
 * odds-ab      — both seats grind; one ranks targets by capture odds, the other
 *                by the legacy dice differential. Measures the ODDS scoring's
 *                strength on top of the grind executor.
 * mirror-odds  — both seats grind + odds.
 * press-ab     — both seats grind + odds; one also presses decided games
 *                (doubled budget + lifted cap past the win-probability
 *                threshold). A harm guard: pressing should CONVERT won games,
 *                not throw them.
 * mirror-press — both seats grind + odds + press (the shipped configuration).
 *                Compare mean turns against mirror-odds.
 *
 * The mirrors are how you answer "do decided games get shorter": a head-to-head
 * cannot, because both policies are inside the same game.
 *
 * The three PR-12-era modes pin computeAiTurn to the LEGACY scoring so their
 * numbers stay comparable with the measurements recorded when the grind landed.
 */
const MODE = (process.env.SELFPLAY_MODE ?? 'ab') as
  | 'ab'
  | 'mirror-grind'
  | 'mirror-poke'
  | 'odds-ab'
  | 'mirror-odds'
  | 'press-ab'
  | 'mirror-press';

/** Candidate-vs-baseline names for the report (candidate sits in the alternating seat). */
const [CAND, BASE] =
  MODE === 'press-ab' || MODE === 'mirror-press'
    ? ['press', 'hold']
    : MODE === 'odds-ab' || MODE === 'mirror-odds'
      ? ['odds', 'legacy']
      : ['grind', 'poke'];

function loadMap(): GameMap {
  return JSON.parse(
    readFileSync(join(__dirname, `../../database/maps/${MAP_FILE}.json`), 'utf-8'),
  ) as GameMap;
}

/** Plain land Risk: no economy, tech, factions, naval or events, so the sweep
 *  measures attack policy and nothing else. */
function settings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    factions_enabled: false,
    naval_enabled: false,
    events_enabled: false,
    economy_enabled: false,
    tech_trees_enabled: false,
    stability_enabled: false,
    era_advancement_enabled: false,
    allowed_victory_conditions: ['domination'],
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

function applyDraft(state: GameState, pid: string, plan: AiAction[]): void {
  const remaining = state.draft_units_remaining ?? 0;
  if (remaining <= 0) return;
  const owned = ownedIds(state, pid);
  if (owned.length === 0) { state.draft_units_remaining = 0; return; }
  const planned = plan.find((a) => a.type === 'draft' && a.to && state.territories[a.to]?.owner_id === pid)?.to;
  state.territories[planned ?? owned[0]].unit_count += remaining;
  state.draft_units_remaining = 0;
}

function applyFortify(state: GameState, pid: string, from: string, to: string, units?: number): void {
  const f = state.territories[from];
  const t = state.territories[to];
  if (!f || !t || f.owner_id !== pid || t.owner_id !== pid) return;
  const move = Math.min(units ?? f.unit_count - 1, f.unit_count - 1);
  if (move <= 0) return;
  f.unit_count -= move;
  t.unit_count += move;
}

/**
 * One AI turn, mirroring processAiTurn's sequence for the land ruleset — and
 * crucially routing attacks through the SAME `runAiAttackExchanges` the socket
 * uses, so this measures production behaviour rather than a copy of it.
 */
async function playAiTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  canGrind: boolean,
  useOdds: boolean,
  usePress: boolean,
): Promise<number> {
  // Same order as the socket: decidedness is read before planning, from the
  // full state (the sim has no fog).
  const decidedPress = usePress && shouldPressDecidedGame(state, pid, difficulty);
  state.phase = 'draft';
  const plan = computeAiTurn(state, map, difficulty, {
    captureOddsScoring: useOdds,
    decidedGamePress: decidedPress,
  });
  applyDraft(state, pid, plan);

  state.phase = 'attack';
  const budget = {
    left: canGrind ? aiAttackExchangeBudget(difficulty, decidedPress) : Number.POSITIVE_INFINITY,
  };
  let exchanges = 0;
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    const fromId = a.from;
    const toId = a.to;
    await runAiAttackExchanges({
      state,
      attackerId: pid,
      fromId,
      toId,
      budget,
      canGrind,
      exchange: () => {
        const outcome = executeLandAttack(state, pid, fromId, toId, { dieRoll });
        exchanges += 1;
        return outcome ? 'ok' : 'stop';
      },
    });
    if (budget.left <= 0) break;
  }

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type === 'fortify' && a.from && a.to) applyFortify(state, pid, a.from, a.to, a.units);
  }
  return exchanges;
}

interface GameResult {
  winner: 'grind' | 'poke' | null;
  turns: number;
  decisive: boolean;
  grindTerritories: number;
  pokeTerritories: number;
  grindExchanges: number;
  pokeExchanges: number;
}

async function runGame(map: GameMap, gameIndex: number): Promise<GameResult> {
  const seed = hashStringToSeed(`${MASTER_SEED}:${gameIndex}`);
  const dieRoll = seededDie(seed);
  // Alternate which seat grinds AND who moves first, so neither the policy nor
  // the first move is confounded with a seat.
  // In mirror modes no seat is "the grinder"; seat 0 is reported as `grind` so
  // the territory/exchange columns stay readable.
  const grindSeat = gameIndex % 2; // the CANDIDATE seat in the ab modes
  const startSeat = (gameIndex >> 1) % 2;
  const seatGrinds = (idx: number): boolean =>
    MODE === 'ab' ? idx === grindSeat : MODE !== 'mirror-poke';
  const seatOdds = (idx: number): boolean =>
    MODE === 'mirror-odds' || MODE === 'press-ab' || MODE === 'mirror-press'
      ? true
      : MODE === 'odds-ab'
        ? idx === grindSeat
        : false;
  const seatPress = (idx: number): boolean =>
    MODE === 'mirror-press' ? true : MODE === 'press-ab' ? idx === grindSeat : false;

  const players = [0, 1].map((i) => ({
    player_id: `ai_${i}`,
    player_index: i,
    username: `AI-${i}`,
    color: i === 0 ? '#e74c3c' : '#3498db',
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
  }));

  const state = initializeGameState(`selfplay_${gameIndex}`, 'ancient', map, players, settings(), {
    forceStartingPlayerIndex: startSeat,
  });

  const exchanges = [0, 0];
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * 2 + 5) {
    guard += 1;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      exchanges[player.player_index] += await playAiTurn(
        state, map, player.player_id, DIFFICULTY, dieRoll,
        seatGrinds(player.player_index),
        seatOdds(player.player_index),
        seatPress(player.player_index),
      );
    }
    advanceToNextPlayer(state, map);

    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0];
      state.victory_condition = victory.condition;
    }
  }

  const count = (i: number) => ownedIds(state, `ai_${i}`).length;
  const winnerIdx = state.winner_id ? Number(state.winner_id.split('_')[1]) : null;
  const asRole = (i: number) => (i === grindSeat ? 'grind' : 'poke') as const;

  return {
    winner: winnerIdx === null ? null : asRole(winnerIdx),
    turns: state.turn_number,
    decisive: winnerIdx !== null,
    grindTerritories: count(grindSeat),
    pokeTerritories: count(1 - grindSeat),
    grindExchanges: exchanges[grindSeat],
    pokeExchanges: exchanges[1 - grindSeat],
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

(async () => {
  const map = loadMap();
  console.log(
    `AI self-play: ${GAMES} games, mode=${MODE}, difficulty=${DIFFICULTY}, map=${MAP_FILE}, ` +
    `maxTurns=${MAX_TURNS}, seed="${MASTER_SEED}"\n` +
    (MODE === 'ab'
      ? 'grind (exchange budget) vs poke (one exchange per edge) — seats and first move alternate\n'
      : MODE === 'odds-ab'
        ? 'both seats grind; odds (capture-probability targeting) vs legacy (dice differential) — seats and first move alternate\n'
        : MODE === 'press-ab'
          ? 'both seats grind + odds; press (decided-game escape) vs hold — a harm guard, not a strength gate\n'
          : MODE === 'mirror-odds'
            ? 'both seats grind + odds targeting — compare mean turns against mirror-grind\n'
            : MODE === 'mirror-press'
              ? 'both seats grind + odds + decided-game press (the shipped configuration) — compare mean turns against mirror-odds\n'
              : `both seats use the ${MODE === 'mirror-grind' ? 'grind' : 'poke'} policy — compare mean turns across the two mirrors\n`),
  );

  const results: GameResult[] = [];
  for (let i = 0; i < GAMES; i += 1) {
    results.push(await runGame(map, i));
    if ((i + 1) % 25 === 0) process.stdout.write(`  ${i + 1}/${GAMES}\r`);
  }

  const decisive = results.filter((r) => r.decisive);
  const grindWins = decisive.filter((r) => r.winner === 'grind').length;
  const pokeWins = decisive.filter((r) => r.winner === 'poke').length;

  console.log('\n── Results ───────────────────────────────────────────');
  console.log(`decisive games:            ${decisive.length}/${results.length} (${pct(decisive.length, results.length)})`);
  console.log(`${CAND} wins:`.padEnd(27) + `${grindWins}  (${pct(grindWins, decisive.length)} of decided)`);
  console.log(`${BASE} wins:`.padEnd(27) + `${pokeWins}  (${pct(pokeWins, decisive.length)} of decided)`);
  console.log(`mean turns (decided):      ${mean(decisive.map((r) => r.turns)).toFixed(1)}`);
  console.log(`mean territories  ${CAND}:`.padEnd(27) + mean(results.map((r) => r.grindTerritories)).toFixed(2));
  console.log(`                  ${BASE}:`.padEnd(27) + mean(results.map((r) => r.pokeTerritories)).toFixed(2));
  console.log(`mean exchanges/game ${CAND}:`.padEnd(27) + mean(results.map((r) => r.grindExchanges)).toFixed(1));
  console.log(`                    ${BASE}:`.padEnd(27) + mean(results.map((r) => r.pokeExchanges)).toFixed(1));

  // Acceptance gate from the Week 3 plan: the new policy should win a clear
  // majority of decided games. A near-50% result means the change is inert;
  // a very high one means the bot may now be too strong for its difficulty.
  const winRate = decisive.length === 0 ? 0 : grindWins / decisive.length;
  console.log('\n── Gate ──────────────────────────────────────────────');
  if (MODE !== 'ab' && MODE !== 'odds-ab' && MODE !== 'press-ab') {
    console.log(`Mirror run — no strength verdict. Compare "mean turns (decided)" against the other mirror.`);
    process.exit(0);
  }
  if (decisive.length < results.length * 0.5) {
    console.log('INCONCLUSIVE — too many games hit the turn cap to judge strength.');
  } else if (MODE === 'press-ab') {
    // The press changes TEMPO, not strength — the gate is only that a pressing
    // bot does not throw games it already holds.
    if (winRate >= 0.45) {
      console.log(`PASS — press wins ${pct(grindWins, decisive.length)} of decided games (harm guard: >= 45%).`);
    } else {
      console.log(`HARMFUL — press wins only ${pct(grindWins, decisive.length)} of decided games (guard >= 45%): pressing is throwing won games.`);
    }
  } else if (winRate >= 0.55) {
    console.log(`PASS — ${CAND} wins ${pct(grindWins, decisive.length)} of decided games (target >= 55%).`);
  } else {
    console.log(`BELOW TARGET — ${CAND} wins ${pct(grindWins, decisive.length)} of decided games (target >= 55%).`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
