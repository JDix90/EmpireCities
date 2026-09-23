/**
 * Headless faction-balance harness: rank an era's factions against each other.
 *
 * Every seat is the same medium AI and only the faction differs, so a win-rate
 * gap is a kit gap. The faction-to-seat mapping rotates every game, which means
 * seat order and starting-position luck average out across the run rather than
 * explaining a result.
 *
 * Two things this harness does that a naive loop does not, both learned the
 * hard way:
 *
 *  - It FIRES FACTION ABILITIES, mirroring the parity blocks in
 *    gameSocket.processAiTurn. Abilities resolve in the socket layer, so a loop
 *    that only calls computeAiTurn measures passives and nothing else: the
 *    Imperial Diet, Longbowmen and Chevauchée all sit idle and the HRE reads
 *    eight points weaker than it plays.
 *  - It SEEDS THE PLANNER'S JITTER. Production leaves `randomFactor` on
 *    Math.random, so without `rng` two runs of the same config differ by more
 *    than sampling noise and no A/B means anything.
 *
 * SIM_PATCH mutates faction definitions in memory before the run, so a proposed
 * kit can be measured before it is written to `eras/`. Note that each patch
 * produces a different game tree: compare a candidate against the unpatched
 * baseline at the same seed, never one candidate against another.
 *
 * The stand-in is a medium bot, so results rank factions against each other —
 * they do not predict what a person scores.
 *
 * WHAT THIS HARNESS CANNOT SEE, so a faction whose identity lives here reads
 * weaker than it plays:
 *
 *  - Abilities with a bespoke handler in gameSocket and no
 *    TERRITORY_ABILITY_DEFS entry. `blitzkrieg` (ww2 Germany) is the live case:
 *    it is a socket state machine over `blitzkrieg_bonus_attacks_remaining`,
 *    and nothing here fires it.
 *  - Fortify-phase abilities. The loop applies every planned fortify move and
 *    enforces no per-turn limit, so `armored_push` (modern Eastern Bloc), which
 *    grants an extra move, has nothing to grant.
 *  - Anything gated on a system left off: tech trees, economy and stability are
 *    off unless SIM_TECH / SIM_ECONOMY say otherwise, which is the default a
 *    normal game and every campaign stage runs under. That is a real measure of
 *    the default game, not a harness flaw — but a tech-costed ability reads as
 *    no ability at all, which is the point.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simFactionBalance.ts
 *   SIM_ERA=medieval SIM_GAMES=300 pnpm exec tsx scripts/simFactionBalance.ts
 *   SIM_DEAL=1 pnpm exec tsx scripts/simFactionBalance.ts
 *   SIM_TRACE=1 pnpm exec tsx scripts/simFactionBalance.ts
 *   SIM_PATCH='byzantine.passive_attack_bonus=1;byzantine.reinforce_bonus=2' \
 *     pnpm exec tsx scripts/simFactionBalance.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { EraId, GameMap, GameSettings, GameState } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  initializeGameState,
} from '../src/game-engine/state/gameStateManager';
import { computeAiTurn } from '../src/game-engine/ai/aiBot';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import { aiAttackExchangeBudget, runAiAttackExchanges } from '../src/game-engine/ai/aiAttackGrind';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { calculateReinforcements } from '../src/game-engine/combat/combatResolver';
import { getEraFactions } from '../src/game-engine/eras';
import { getPlayerFaction } from '../src/game-engine/eras/factionLineage';
import { executeTechAbility } from '../src/game-engine/abilities/executeTechAbility';
import { GAME_SCOPED_ABILITIES, TERRITORY_ABILITY_DEFS } from '../src/game-engine/abilities/techAbilities';

const ERA = (process.env.SIM_ERA ?? 'medieval') as EraId;
const MAP_ID = process.env.SIM_MAP ?? `era_${ERA}`;
const GAMES = Number(process.env.SIM_GAMES ?? 180);
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 100);
const SEED = process.env.SIM_SEED ?? 'faction-balance';
const TECH = process.env.SIM_TECH === '1';
const ECONOMY = process.env.SIM_ECONOMY === '1';
/** Print each faction's opening allocation and exit, without playing anything. */
const DEAL_ONLY = process.env.SIM_DEAL === '1';
/** Also print territories held at fixed turn marks, tiles lost, and death turn. */
const TRACE = process.env.SIM_TRACE === '1';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const TRACE_MARKS = [3, 6, 10] as const;

const factions = getEraFactions(ERA);
if (factions.length === 0) throw new Error(`era ${ERA} has no factions`);

/**
 * In-memory kit patch: `SIM_PATCH='faction.field=value;faction.field=value'`,
 * with `null` to delete a field. Applied before the run so a candidate kit can
 * be measured without editing source.
 */
for (const clause of (process.env.SIM_PATCH ?? '').split(';').map((c) => c.trim()).filter(Boolean)) {
  const [lhs, rhs] = clause.split('=');
  const [factionId, field] = (lhs ?? '').split('.');
  const target = factions.find((f) => f.faction_id === factionId) as Record<string, unknown> | undefined;
  if (!target || !field) throw new Error(`SIM_PATCH: cannot resolve "${clause}"`);
  if (rhs === 'null') delete target[field];
  else target[field] = rhs != null && rhs !== '' && !Number.isNaN(Number(rhs)) ? Number(rhs) : rhs;
}

const map = JSON.parse(
  readFileSync(join(__dirname, '../../database/maps', `${MAP_ID}.json`), 'utf-8'),
) as GameMap;
const SEATS = factions.length;
/**
 * Widest faction id plus a gap. Hard-coding this ran the columns together on
 * `decolonization_movement`, which is 23 characters.
 */
const NAME_W = Math.max(18, ...factions.map((f) => f.faction_id.length + 2));

function simSettings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    factions_enabled: true,
    naval_enabled: false,
    events_enabled: false,
    economy_enabled: ECONOMY,
    tech_trees_enabled: TECH,
    stability_enabled: false,
    combat_dice_cap_enabled: true,
    allowed_victory_conditions: ['domination'],
    victory_type: 'domination',
    max_turns: MAX_TURNS,
  } as GameSettings;
}

/** Seat i draws the faction i places along from the start, rotated per game. */
function seatFactions(game: number): typeof factions {
  return factions.map((_, i) => factions[(i + game) % SEATS]!);
}

function newGame(game: number): { state: GameState; order: typeof factions } {
  const order = seatFactions(game);
  const players = order.map((f, i) => ({
    player_id: `p_${i}`,
    player_index: i,
    username: f.faction_id,
    color: COLORS[i % COLORS.length]!,
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
    faction_id: f.faction_id,
  }));
  const state = initializeGameState(
    `faction_balance_${game}`,
    ERA,
    map,
    players,
    simSettings(),
    { forceStartingPlayerIndex: game % SEATS },
  );
  return { state, order };
}

function ownedIds(state: GameState, pid: string): string[] {
  return Object.keys(state.territories).filter((t) => state.territories[t]!.owner_id === pid).sort();
}

/**
 * Mirror of the faction-ability parity blocks in gameSocket.processAiTurn:
 * draft abilities fire before placement so pool boosters land the same turn,
 * attack strikes and self-buffs fire against the first planned enemy target.
 */
function fireFactionAbility(
  state: GameState,
  map_: GameMap,
  pid: string,
  phase: 'draft' | 'attack',
  plan: AiAction[],
): void {
  const player = state.players.find((p) => p.player_id === pid);
  if (!player || !state.settings.factions_enabled || !player.faction_id) return;
  const abilityId = getPlayerFaction(state, player)?.ability_id;
  if (!abilityId) return;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def || def.phase !== phase) return;

  const gameScoped = GAME_SCOPED_ABILITIES.has(abilityId);
  const used = gameScoped
    ? (player.used_game_abilities ?? []).includes(abilityId)
    : !!(player.ability_uses ?? {})[abilityId];
  if (used) return;

  let territoryId: string | undefined;
  if (phase === 'draft') {
    if (def.ownPlacement) {
      territoryId = Object.values(state.territories)
        .filter((t) => t.owner_id === pid)
        .sort((a, b) => b.unit_count - a.unit_count)[0]?.territory_id;
      if (!territoryId) return;
    }
  } else {
    const isStrike = def.unitReduction != null;
    const isSelfBuff = def.selfBuff === 'extra_attack_die' || def.selfBuff === 'negate_attacker_losses';
    if (!isStrike && !isSelfBuff) return;
    if (isStrike) {
      territoryId = plan.find(
        (a) => a.type === 'attack' && a.from && a.from !== '__influence__' && a.to
          && state.territories[a.to]?.owner_id != null
          && state.territories[a.to]?.owner_id !== pid,
      )?.to;
      if (!territoryId) return;
    }
  }

  const res = executeTechAbility({ state, map: map_, playerId: pid, abilityId, territoryId });
  if (res.success && !gameScoped) {
    player.ability_uses = { ...(player.ability_uses ?? {}), [abilityId]: 1 };
  }
}

/** One AI seat's full turn, mirroring processAiTurn's pure-engine sequence. */
async function playAiTurn(
  state: GameState,
  pid: string,
  dieRoll: () => number,
  rng: () => number,
): Promise<void> {
  state.phase = 'draft';
  const plan = computeAiTurn(state, map, 'medium', { captureOddsScoring: true, rng });
  fireFactionAbility(state, map, pid, 'draft', plan);

  const remaining = state.draft_units_remaining ?? 0;
  if (remaining > 0) {
    const owned = ownedIds(state, pid);
    if (owned.length > 0) {
      const planned = plan.find(
        (a) => a.type === 'draft' && a.to && state.territories[a.to]?.owner_id === pid,
      )?.to;
      state.territories[planned ?? owned[0]!]!.unit_count += remaining;
    }
    state.draft_units_remaining = 0;
  }

  state.phase = 'attack';
  fireFactionAbility(state, map, pid, 'attack', plan);
  const budget = { left: aiAttackExchangeBudget('medium', false) };
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

interface FactionTally {
  wins: number;
  eliminated: number;
  tilesLost: number[];
  deathTurn: number[];
  marks: Record<number, number[]>;
}

function emptyTally(): FactionTally {
  return { wins: 0, eliminated: 0, tilesLost: [], deathTurn: [], marks: { 3: [], 6: [], 10: [] } };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** What each faction starts with, before a die is rolled. */
function reportDeal(): void {
  const territories = new Map<string, number[]>();
  const units = new Map<string, number[]>();
  const inHome = new Map<string, number[]>();
  for (const f of factions) {
    territories.set(f.faction_id, []);
    units.set(f.faction_id, []);
    inHome.set(f.faction_id, []);
  }
  for (let g = 0; g < GAMES; g++) {
    const { state, order } = newGame(g);
    for (const p of state.players) {
      const f = order[p.player_index]!;
      const owned = Object.values(state.territories).filter((t) => t.owner_id === p.player_id);
      territories.get(f.faction_id)!.push(owned.length);
      units.get(f.faction_id)!.push(owned.reduce((s, t) => s + t.unit_count, 0));
      inHome.get(f.faction_id)!.push(
        owned.filter((t) => f.home_region_ids.includes(t.region_id ?? '')).length,
      );
    }
  }
  const regionSize = new Map<string, number>();
  for (const t of map.territories) {
    if (t.region_id) regionSize.set(t.region_id, (regionSize.get(t.region_id) ?? 0) + 1);
  }
  console.log(`${MAP_ID} (${ERA}) · ${SEATS} seats · ${GAMES} deals · ${map.territories.length} territories\n`);
  console.log(
    `${'faction'.padEnd(NAME_W)}${'home region'.padEnd(18)}${'size'.padEnd(6)}`
    + `${'territories'.padEnd(13)}${'units'.padEnd(8)}${'in home'.padEnd(9)}draft/turn`,
  );
  for (const f of factions) {
    const terr = mean(territories.get(f.faction_id)!);
    const homeSize = f.home_region_ids.reduce((s, r) => s + (regionSize.get(r) ?? 0), 0);
    console.log(
      f.faction_id.padEnd(NAME_W)
      + (f.home_region_ids[0] ?? '-').padEnd(18)
      + String(homeSize).padEnd(6)
      + terr.toFixed(1).padEnd(13)
      + mean(units.get(f.faction_id)!).toFixed(1).padEnd(8)
      + mean(inHome.get(f.faction_id)!).toFixed(1).padEnd(9)
      + (calculateReinforcements(Math.round(terr), 0, SEATS) + (f.reinforce_bonus ?? 0)).toFixed(0),
    );
  }
}

async function main(): Promise<void> {
  if (DEAL_ONLY) {
    reportDeal();
    process.exit(0);
  }

  const tally = new Map<string, FactionTally>(factions.map((f) => [f.faction_id, emptyTally()]));

  for (let g = 0; g < GAMES; g++) {
    const rng = createSeededRng(hashStringToSeed(`${SEED}:${ERA}:${g}`));
    const dieRoll = (): number => Math.floor(rng() * 6) + 1;
    const { state, order } = newGame(g);

    const lost = new Map<string, number>();
    const died = new Map<string, number>();
    const marks: Record<number, Map<string, number>> = {};
    let guard = 0;
    while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * SEATS + 5) {
      guard += 1;

      for (const at of TRACE_MARKS) {
        if (state.turn_number === at && !marks[at]) {
          marks[at] = new Map(state.players.map((p) => [
            order[p.player_index]!.faction_id,
            Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length,
          ]));
        }
      }

      const current = state.players[state.current_player_index]!;
      const before = new Map(state.players.map((p) => [
        p.player_id,
        Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length,
      ]));
      if (!current.is_eliminated) await playAiTurn(state, current.player_id, dieRoll, rng);
      for (const p of state.players) {
        if (p.player_id === current.player_id) continue;
        const after = Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length;
        const delta = (before.get(p.player_id) ?? 0) - after;
        if (delta > 0) {
          const fid = order[p.player_index]!.faction_id;
          lost.set(fid, (lost.get(fid) ?? 0) + delta);
        }
      }
      for (const p of state.players) {
        if (p.is_eliminated && !died.has(p.player_id)) died.set(p.player_id, state.turn_number);
      }

      advanceToNextPlayer(state, map);
      const victory = checkVictory(state, map);
      if (victory) {
        state.phase = 'game_over';
        state.winner_id = victory.winnerIds[0] ?? null;
        break;
      }
    }

    for (const p of state.players) {
      const fid = order[p.player_index]!.faction_id;
      const t = tally.get(fid)!;
      if (p.is_eliminated) t.eliminated += 1;
      if (p.player_id === state.winner_id) t.wins += 1;
      const deathTurn = died.get(p.player_id);
      if (deathTurn != null) t.deathTurn.push(deathTurn);
      t.tilesLost.push(lost.get(fid) ?? 0);
      for (const at of TRACE_MARKS) {
        const v = marks[at]?.get(fid);
        if (v != null) t.marks[at]!.push(v);
      }
    }
  }

  const fairShare = Math.round(100 / SEATS);
  console.log(
    `${MAP_ID} (${ERA}) · ${SEATS} seats · ${GAMES} games · seed=${SEED}`
    + ` · tech=${TECH ? 'on' : 'off'} economy=${ECONOMY ? 'on' : 'off'} · fair share ${fairShare}%`,
  );
  if (process.env.SIM_PATCH) console.log(`patch: ${process.env.SIM_PATCH}`);

  const rows = factions
    .map((f) => ({
      id: f.faction_id,
      win: Math.round((tally.get(f.faction_id)!.wins / GAMES) * 100),
      dead: Math.round((tally.get(f.faction_id)!.eliminated / GAMES) * 100),
    }))
    .sort((a, b) => b.win - a.win);
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(NAME_W)}win ${String(r.win).padStart(3)}%   eliminated ${String(r.dead).padStart(3)}%`);
  }
  const spread = (rows[0]?.win ?? 0) - (rows[rows.length - 1]?.win ?? 0);
  console.log(`  spread ${spread} points (best ${rows[0]?.id}, worst ${rows[rows.length - 1]?.id})`);

  if (TRACE) {
    console.log(
      `\n  ${'faction'.padEnd(NAME_W)}${'terr@3'.padEnd(9)}${'terr@6'.padEnd(9)}`
      + `${'terr@10'.padEnd(9)}${'tiles lost'.padEnd(12)}died turn`,
    );
    for (const r of rows) {
      const t = tally.get(r.id)!;
      console.log(
        `  ${r.id.padEnd(NAME_W)}${mean(t.marks[3]!).toFixed(1).padEnd(9)}${mean(t.marks[6]!).toFixed(1).padEnd(9)}`
        + `${mean(t.marks[10]!).toFixed(1).padEnd(9)}${mean(t.tilesLost).toFixed(1).padEnd(12)}`
        + (t.deathTurn.length ? mean(t.deathTurn).toFixed(0) : '-'),
      );
    }
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
