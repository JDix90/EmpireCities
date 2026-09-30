/**
 * Headless AI-vs-AI Galactic Age balance simulator.
 *
 * Drives the PURE game engine (no sockets, no DB) for N galaxy_age games on
 * era_galaxy.json — four players by default, or two to eight with SIM_PLAYERS —
 * and reports the balance signals that matter for the multi-world map after the
 * 6->16 territory densification:
 *   - per-FACTION win rate, as a share of the games each faction played
 *     (baseline 1/players; flags a faction 40% above or below it),
 *   - game length (pacing) + decisive vs turn-limit,
 *   - snowball: win rate of the territory leader at turn 10,
 *   - peak territory spread (leader - laggard).
 *
 * Every player is on a distinct galaxy faction, so each gets its whole home world
 * (tryDistributeGalaxyAgeFactionHomeworlds); below four players the rest of the
 * worlds open as neutral colonies (state/galaxyModes.ts). At eight every faction
 * has two seats, each a house on half its world (state/galaxySchism.ts); at five
 * to seven (the Partial Schism) one world per seat over four is split that way,
 * and each other world has a house alone on one half of it, the other half
 * unclaimed (Allied, a seat holding it whole). Era advancement is OFF
 * (galaxy is the terminal era); factions ON; naval OFF (the worlds are linked by
 * orbit lanes, not sea). Combat dice are seeded per game.
 *
 * Run (from backend/):
 *   pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_GAMES=500 SIM_DIFFICULTY=expert SIM_MAX_TURNS=90 \
 *     SIM_CSV=/tmp/galaxy_balance.csv pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_PLAYERS=2 SIM_GAMES=240 pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_PLAYERS=8 SIM_GAMES=240 SIM_HOUSE_RELATIONS=civil_war pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_PLAYERS=8 SIM_GAMES=240 SIM_HOUSE_RELATIONS=allied pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_PLAYERS=5 SIM_GAMES=1260 SIM_PARTIAL_UNCLAIMED=10,12 pnpm exec tsx scripts/simGalaxyBalance.ts
 *   SIM_PLAYERS=4 SIM_GAMES=240 SIM_2V2=1 pnpm exec tsx scripts/simGalaxyBalance.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AiAction } from '../src/game-engine/ai/aiBot';
import type { AiDifficulty, GameMap, GameSettings, GameState, MapConnection } from '../src/types';
import {
  advanceToNextPlayer,
  checkVictory,
  initializeGameState,
  syncTerritoryCounts,
} from '../src/game-engine/state/gameStateManager';
import { isWorldRuleId, vaultStatuses, WORLD_RULE_IDS, type WorldRuleId } from '../src/game-engine/state/worldRules';
import { syncJumpGateLanes } from '../src/game-engine/state/jumpGates';
import { syncLaneWeatherLanes } from '../src/game-engine/state/laneWeather';
import {
  COLONY_GARRISONS,
  GALAXY_CLASSIC_SEATS,
  GALAXY_SCHISM_SEATS,
  GALAXY_SEAT_COUNTS,
  syncGalaxyModeLanes,
} from '../src/game-engine/state/galaxyModes';
import {
  ALLIED_TUNING,
  holdsLaneCrown,
  normalizeHouseRelations,
  PARTIAL_SCHISM_HALVES,
  PARTIAL_SCHISM_TUNING,
  SCHISM_HALVES,
  SCHISM_TUNING,
  schismHouseOf,
  schismHouseTiles,
  schismRivalOf,
  schismUnclaimedTiles,
  schismWholeWorldOf,
} from '../src/game-engine/state/galaxySchism';
import { activeTruceBetween } from '../src/game-engine/state/truces';
import { GALAXY_2V2_PAIRS } from '../src/game-engine/state/galaxyTeams';
import { TEAM_TUNING } from '../src/game-engine/state/teams';
import { sidesOf, sideTerritoryCount } from '../src/game-engine/victory/teamVictory';
import { GALAXY_MODE_LANE_SOURCE, neighbouringWorlds } from '../src/game-engine/state/galaxyRing';
import { vaultRegionGarrisons } from '../src/game-engine/state/worldRules';
import {
  LANE_SOVEREIGNTY_CORRIDORS_NEEDED,
  LANE_SOVEREIGNTY_ROUNDS,
  LANE_SOVEREIGNTY_ROUNDS_BY_SEATS,
  LANE_SOVEREIGNTY_ROUNDS_BY_SIDES,
} from '../src/game-engine/victory/laneSovereignty';
import { fortifyBecomesConvoy, launchConvoy } from '../src/game-engine/state/transit';
import { computeAiTurn, selectAiBuildingPlacement, selectAiTechResearch } from '../src/game-engine/ai/aiBot';
import {
  aiAttackExchangeBudget,
  shouldContinueGrind,
  shouldPressDecidedGame,
} from '../src/game-engine/ai/aiAttackGrind';
import { executeLandAttack } from '../src/game-engine/combat/executeLandAttack';
import { getOrbitAccessResult } from '../src/game-engine/state/moonAccess';
import { applyBuild } from '../src/game-engine/state/economyManager';
import { applyResearch, validateResearch } from '../src/game-engine/state/techManager';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';
import { getFactionById } from '../src/game-engine/eras';
import { calculateReinforcements } from '../src/game-engine/combat/combatResolver';
import { getPlayerReinforceBonus } from '../src/game-engine/state/techManager';

const GAMES = Number(process.env.SIM_GAMES ?? 200);
const DIFFICULTY = (process.env.SIM_DIFFICULTY ?? 'expert') as AiDifficulty;
const MAX_TURNS = Number(process.env.SIM_MAX_TURNS ?? 90);
const MASTER_SEED = process.env.SIM_SEED ?? 'borderfall-galaxy-balance';
const CSV_PATH = process.env.SIM_CSV ?? '';
/** When set (1–99), adds threshold victory at that % — mirrors the live galaxy create default. */
const THRESHOLD = process.env.SIM_THRESHOLD ? Number(process.env.SIM_THRESHOLD) : null;
/**
 * Attack-loop fidelity. `SIM_GRIND=0` restores the pre-2026-09 harness (one dice
 * exchange per planned edge) for comparison; the default mirrors production.
 */
const GRIND = process.env.SIM_GRIND !== '0';
/**
 * Corridors (positional lane access + the lane dice cap). The live create path
 * bakes `galaxy_corridors_enabled` from the feature flag, which this harness
 * bypasses, so mirror the default here; `SIM_CORRIDORS=0` is the kill switch.
 */
const CORRIDORS = process.env.SIM_CORRIDORS !== '0';
/**
 * Worlds as characters (`world_rules_enabled`, default on live): Sol's deploy
 * cap and growth, Verdan's storms, Rust's forge dice, the Nexus Vault.
 * `SIM_WORLD_RULES=0` is the kill switch, for before/after comparisons.
 * `SIM_WORLD_RULES_OFF=storms,vault` switches individual rules off instead, the
 * way the per-rule `galaxy_rule_<id>_enabled` flags do.
 */
const WORLD_RULES = process.env.SIM_WORLD_RULES !== '0';
const WORLD_RULES_OFF = (process.env.SIM_WORLD_RULES_OFF ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const id of WORLD_RULES_OFF) {
  if (!isWorldRuleId(id)) throw new Error(`SIM_WORLD_RULES_OFF: unknown rule "${id}" (${WORLD_RULE_IDS.join(', ')})`);
}
/**
 * Lane Sovereignty (`lane_sovereignty`), the galaxy's own victory: on by
 * default at create for this era, so on here too. `SIM_SOVEREIGNTY=0` measures
 * the era without it.
 */
const SOVEREIGNTY = process.env.SIM_SOVEREIGNTY !== '0';
/**
 * Event cards are OFF by default here, matching the era's own system defaults
 * (economy + tech + factions). `SIM_EVENTS=1` turns them on, which is the only
 * way the galaxy's lane weather — Nebula Closure and Lane Surge — can fire.
 */
const EVENTS = process.env.SIM_EVENTS === '1';
/**
 * Transit (`galaxy_transit_enabled`): a fortify between two worlds becomes a
 * convoy that lands at the mover's next turn start. Ships OFF, so it is OFF here
 * unless `SIM_TRANSIT=1` — this is the knob the era plan wanted measured before
 * the mechanic was believed.
 */
const TRANSIT = process.env.SIM_TRANSIT === '1';
/**
 * Faction kit overrides for a tuning sweep, as JSON:
 *   SIM_FACTION_PATCH='{"forge_syndicate":{"reinforce_bonus":1}}'
 * Patched onto the era's faction definitions before any game starts, the same
 * objects every engine lookup resolves, so a candidate can be measured without
 * editing eras/galaxyage.ts. World modifiers and rules live in the map: use
 * SIM_MAP for those.
 */
const FACTION_PATCH: Record<string, Record<string, unknown>> = process.env.SIM_FACTION_PATCH
  ? JSON.parse(process.env.SIM_FACTION_PATCH)
  : {};
for (const [factionId, patch] of Object.entries(FACTION_PATCH)) {
  const faction = getFactionById('galaxy_age', factionId);
  if (!faction) throw new Error(`SIM_FACTION_PATCH: unknown galaxy faction "${factionId}"`);
  Object.assign(faction, patch);
}

/**
 * `SIM_SCATTERED=1` measures a Galactic Age with no home worlds: every player
 * keeps their faction and kit, but the board is dealt the way the engine deals
 * a no-factions game (every non-neutral tile shuffled and dealt round-robin at
 * the initial unit count; the Vault ring stays neutral). Sim-only — the engine
 * has no such setting. The re-deal happens after init, so the first player's
 * opening draft is recomputed the way initializeGameState computes it.
 */
const SCATTERED = process.env.SIM_SCATTERED === '1';
/**
 * `SIM_FACTIONS=0`: no faction kits. Seats carry no `faction_id` at all (the
 * engine's faction lookups do not all check `factions_enabled`), so the report's
 * faction column is only a rotating seat label. Needs SIM_SCATTERED — without
 * factions there are no home worlds to deal.
 */
const FACTIONS_ON = process.env.SIM_FACTIONS !== '0';
if (!FACTIONS_ON && !SCATTERED) throw new Error('SIM_FACTIONS=0 needs SIM_SCATTERED=1: without factions there are no home worlds');
/** `SIM_PLAIN_LANES=1`: lanes fight like any border (settings.galaxy_plain_lanes). */
const PLAIN_LANES = process.env.SIM_PLAIN_LANES === '1';
/**
 * `SIM_CATCHUP_PER=N`: a candidate catch-up rule, sim-only. Every N territories a
 * player holds above a quarter of the board costs one reinforcement, never
 * below 3. Applied to the draft the engine has just computed, at the start of
 * each turn (card sets redeemed later in the turn are untouched).
 */
const CATCHUP_PER = process.env.SIM_CATCHUP_PER ? Number(process.env.SIM_CATCHUP_PER) : null;
if (CATCHUP_PER != null && !(CATCHUP_PER >= 1)) throw new Error('SIM_CATCHUP_PER must be a number >= 1');

/** Apply SIM_CATCHUP_PER to the current player's opening draft. */
function applyCatchup(state: GameState): void {
  if (CATCHUP_PER == null || state.phase !== 'draft') return;
  const player = state.players[state.current_player_index];
  if (!player || player.is_eliminated) return;
  const fairShare = Object.keys(state.territories).length / state.players.length;
  const over = Math.max(0, player.territory_count - fairShare);
  const penalty = Math.floor(over / CATCHUP_PER);
  state.draft_units_remaining = Math.max(3, state.draft_units_remaining - penalty);
}

/**
 * `SIM_PLAYERS=2..8` (default 4). Below four the engine deals the Colonies
 * board: the worlds nobody calls home open neutral, and at three the ring's two
 * gaps are bridged all game. Eight deals the Schism: two houses to every world.
 * Five to seven deal the Partial Schism: one world per seat over four split
 * between two houses, the others held whole.
 */
const PLAYERS = Number(process.env.SIM_PLAYERS ?? 4);
if (!GALAXY_SEAT_COUNTS.includes(PLAYERS)) {
  throw new Error(`SIM_PLAYERS must be one of ${GALAXY_SEAT_COUNTS.join(', ')}`);
}
/** Any Schism board: five to eight players. */
const SCHISM = PLAYERS > GALAXY_CLASSIC_SEATS;
/** The Partial Schism: five to seven players, some worlds held whole. */
const PARTIAL = SCHISM && PLAYERS < GALAXY_SCHISM_SEATS;
/**
 * Partial Schism knobs (five to seven players), patched onto this seat count's
 * PARTIAL_SCHISM_TUNING and onto PARTIAL_SCHISM_HALVES before any game starts:
 *   SIM_PARTIAL_UNCLAIMED=gateway,interior — the garrison a lone house's
 *     unclaimed half opens with;
 *   SIM_PARTIAL_HALVES='{"sol":{"rival":[3,-1],"alone":[1,0]}}' — units a turn
 *     for the house on each half, with a rival and alone, by world (worlds and
 *     roles not listed keep theirs);
 *   SIM_PARTIAL_ALLIED_HOUSE=N and SIM_PARTIAL_ALLIED_WHOLE=N — Allied units a
 *     turn for a house and for a seat alone on a whole world.
 */
const partialKnobs = ['SIM_PARTIAL_UNCLAIMED', 'SIM_PARTIAL_HALVES', 'SIM_PARTIAL_ALLIED_HOUSE', 'SIM_PARTIAL_ALLIED_WHOLE'];
for (const knob of partialKnobs) {
  if (process.env[knob] && !PARTIAL) throw new Error(`${knob} needs SIM_PLAYERS of 5, 6 or 7`);
}
if (process.env.SIM_PARTIAL_UNCLAIMED) {
  const [gateway, interior] = process.env.SIM_PARTIAL_UNCLAIMED.split(',').map(Number);
  if (!(Number.isInteger(gateway) && Number.isInteger(interior) && gateway! >= 1 && interior! >= 1)) {
    throw new Error('SIM_PARTIAL_UNCLAIMED must be "gateway,interior", both whole numbers >= 1');
  }
  PARTIAL_SCHISM_TUNING[PLAYERS]!.unclaimed = { gateway: gateway!, interior: interior! };
}
if (process.env.SIM_PARTIAL_HALVES) {
  const patch = JSON.parse(process.env.SIM_PARTIAL_HALVES) as Record<string, Partial<Record<'rival' | 'alone', [number, number]>>>;
  for (const [world, roles] of Object.entries(patch)) {
    const entry = PARTIAL_SCHISM_HALVES[world];
    if (!entry) throw new Error(`SIM_PARTIAL_HALVES: unknown world "${world}"`);
    for (const [role, pair] of Object.entries(roles) as Array<['rival' | 'alone', [number, number]]>) {
      if (!(role in entry) || pair.length !== 2 || !pair.every(Number.isInteger)) {
        throw new Error(`SIM_PARTIAL_HALVES: "${world}.${role}" needs rival or alone and two whole numbers`);
      }
      entry[role] = [pair[0]!, pair[1]!];
    }
  }
}
for (const [knob, field] of [['SIM_PARTIAL_ALLIED_HOUSE', 'house'], ['SIM_PARTIAL_ALLIED_WHOLE', 'whole']] as const) {
  const raw = process.env[knob];
  if (!raw) continue;
  if (!Number.isInteger(Number(raw))) throw new Error(`${knob} must be a whole number`);
  PARTIAL_SCHISM_TUNING[PLAYERS]!.allied = { ...PARTIAL_SCHISM_TUNING[PLAYERS]!.allied, [field]: Number(raw) };
}
/**
 * Schism knobs (five to eight players), patched onto the engine's SCHISM_TUNING
 * the way SIM_COLONY_GARRISON is:
 *   SIM_HOUSE_RELATIONS=concord|civil_war|allied — how a world's two houses
 *     start (the lobby setting; the Concord by default). Allied makes them a
 *     team (state/galaxyTeams.ts).
 *   SIM_CONCORD_ROUNDS=N — rounds the Concord truce covers.
 *   SIM_LANE_CROWN=N — units a turn for holding all four home gateways.
 *   SIM_SCHISM_HALVES='{"verdan":[[...],[...]]}' — alternative halves for a
 *     world, tile lists replacing SCHISM_HALVES' (house names kept).
 */
const HOUSE_RELATIONS = normalizeHouseRelations(process.env.SIM_HOUSE_RELATIONS ?? 'concord');
if (process.env.SIM_HOUSE_RELATIONS && process.env.SIM_HOUSE_RELATIONS !== HOUSE_RELATIONS) {
  throw new Error('SIM_HOUSE_RELATIONS must be concord, civil_war or allied');
}
if (process.env.SIM_CONCORD_ROUNDS) {
  const rounds = Number(process.env.SIM_CONCORD_ROUNDS);
  if (!(Number.isInteger(rounds) && rounds >= 0)) throw new Error('SIM_CONCORD_ROUNDS must be a whole number >= 0');
  SCHISM_TUNING.concordRounds = rounds;
}
if (process.env.SIM_LANE_CROWN) {
  const bonus = Number(process.env.SIM_LANE_CROWN);
  if (!(Number.isInteger(bonus) && bonus >= 0)) throw new Error('SIM_LANE_CROWN must be a whole number >= 0');
  SCHISM_TUNING.laneCrownBonus = bonus;
}
/**
 * `SIM_SCHISM_OPENING='{"sol":[1,0],"nexus_station":[0,-1]}'`: each half's
 * opening_bonus (extra units per tile at the start), by world, patched onto
 * SCHISM_HALVES. Worlds not listed keep theirs.
 */
if (process.env.SIM_SCHISM_OPENING) {
  const patch = JSON.parse(process.env.SIM_SCHISM_OPENING) as Record<string, [number, number]>;
  for (const [world, bonuses] of Object.entries(patch)) {
    const halves = SCHISM_HALVES[world];
    if (!halves) throw new Error(`SIM_SCHISM_OPENING: unknown world "${world}"`);
    (SCHISM_HALVES as Record<string, unknown>)[world] = [
      { ...halves[0], opening_bonus: bonuses[0] },
      { ...halves[1], opening_bonus: bonuses[1] },
    ];
  }
}
/**
 * `SIM_SCHISM_REINFORCE='{"sol":[2,0]}'`: each half's reinforce_bonus (units a
 * turn for the house on it), by world, patched onto SCHISM_HALVES.
 */
if (process.env.SIM_SCHISM_REINFORCE) {
  const patch = JSON.parse(process.env.SIM_SCHISM_REINFORCE) as Record<string, [number, number]>;
  for (const [world, bonuses] of Object.entries(patch)) {
    const halves = SCHISM_HALVES[world];
    if (!halves) throw new Error(`SIM_SCHISM_REINFORCE: unknown world "${world}"`);
    (SCHISM_HALVES as Record<string, unknown>)[world] = [
      { ...halves[0], reinforce_bonus: bonuses[0] },
      { ...halves[1], reinforce_bonus: bonuses[1] },
    ];
  }
}
if (process.env.SIM_SCHISM_HALVES) {
  const patch = JSON.parse(process.env.SIM_SCHISM_HALVES) as Record<string, [string[], string[]]>;
  for (const [world, [a, b]] of Object.entries(patch)) {
    const halves = SCHISM_HALVES[world];
    if (!halves) throw new Error(`SIM_SCHISM_HALVES: unknown world "${world}"`);
    (SCHISM_HALVES as Record<string, unknown>)[world] = [
      { ...halves[0], tiles: a },
      { ...halves[1], tiles: b },
    ];
  }
}
/**
 * `SIM_2V2=1` (four players): the lobby's 2v2, two teams of two home worlds
 * paired as GALAXY_2V2_PAIRS says. `SIM_2V2_PAIRS='[["sol","verdan"],["rust","nexus_station"]]'`
 * measures another pairing, patched onto that array.
 */
const TWO_V_TWO = process.env.SIM_2V2 === '1';
if (TWO_V_TWO && PLAYERS !== 4) throw new Error('SIM_2V2=1 needs SIM_PLAYERS=4');
if (process.env.SIM_2V2_PAIRS) {
  const pairs = JSON.parse(process.env.SIM_2V2_PAIRS) as Array<[string, string]>;
  const worlds = pairs.flat();
  if (pairs.length !== 2 || worlds.length !== 4 || new Set(worlds).size !== 4) {
    throw new Error('SIM_2V2_PAIRS must pair the four worlds into two teams');
  }
  GALAXY_2V2_PAIRS.splice(0, GALAXY_2V2_PAIRS.length, ...pairs);
}
/** A team game is measured side by side: a win counts for every member. */
const TEAMS = TWO_V_TWO || (SCHISM && HOUSE_RELATIONS === 'allied');
/**
 * `SIM_ALLIED_REINFORCE='{"sol":-1,"rust":1}'` and `SIM_ALLIED_OPENING='{...}'`:
 * Allied houses' units a turn, and extra opening units per tile, by world (both
 * houses alike), patched onto ALLIED_TUNING. Worlds not listed keep theirs.
 */
for (const [knob, field] of [['SIM_ALLIED_REINFORCE', 'reinforce'], ['SIM_ALLIED_OPENING', 'opening']] as const) {
  const raw = process.env[knob];
  if (!raw) continue;
  for (const [world, n] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
    if (!ALLIED_TUNING[world] || !Number.isInteger(n)) throw new Error(`${knob}: "${world}" needs a whole number and a known world`);
    ALLIED_TUNING[world]![field] = n;
  }
}
/**
 * `SIM_CEASEFIRE=0` measures a team game without its opening ceasefire (no side
 * attacks another until every seat has had a turn), patched onto TEAM_TUNING.
 */
if (process.env.SIM_CEASEFIRE === '0') TEAM_TUNING.openingCeasefire = false;
/** How many sides a game has, which sets every baseline: one per player in a free-for-all game. */
const SIDES = TWO_V_TWO ? 2 : TEAMS ? 4 : PLAYERS;

/**
 * `SIM_COLONY_GARRISON=gateway,interior`: a colony world's opening garrison,
 * patched onto the engine's COLONY_GARRISONS before any game starts (the same
 * object the engine reads). Colonies only exist below four players.
 */
if (process.env.SIM_COLONY_GARRISON) {
  const [gateway, interior] = process.env.SIM_COLONY_GARRISON.split(',').map(Number);
  if (!(gateway >= 1 && interior >= 1)) throw new Error('SIM_COLONY_GARRISON must be "gateway,interior", both >= 1');
  Object.assign(COLONY_GARRISONS, { gateway, interior });
}
/**
 * `SIM_SOVEREIGNTY_ROUNDS=N`: the rounds a Lane Sovereignty streak must run at
 * this player count, patched onto the engine's LANE_SOVEREIGNTY_ROUNDS_BY_SEATS
 * the same way.
 */
if (process.env.SIM_SOVEREIGNTY_ROUNDS) {
  const rounds = Number(process.env.SIM_SOVEREIGNTY_ROUNDS);
  if (!(Number.isInteger(rounds) && rounds >= 1)) throw new Error('SIM_SOVEREIGNTY_ROUNDS must be a whole number >= 1');
  // A team game reads the rounds by its sides (LANE_SOVEREIGNTY_ROUNDS_BY_SIDES).
  if (TEAMS) LANE_SOVEREIGNTY_ROUNDS_BY_SIDES[SIDES] = rounds;
  else LANE_SOVEREIGNTY_ROUNDS_BY_SEATS[PLAYERS] = rounds;
}
// Each faction's home region is a whole world, so every player starts on a
// distinct world.
const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const FACTION_WORLD: Record<string, string> = {
  stellar_mandate: 'Sol',
  forge_syndicate: 'Rust',
  helion_navigators: 'Verdan',
  void_custodians: 'Nexus',
};
const FACTION_WORLD_ID: Record<string, string> = {
  stellar_mandate: 'sol',
  forge_syndicate: 'rust',
  helion_navigators: 'verdan',
  void_custodians: 'nexus_station',
};

/** Every way to pick `k` of the four factions, in FACTIONS order. */
function factionLineups(k: number): string[][] {
  const out: string[][] = [];
  const pick = (start: number, acc: string[]): void => {
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i < FACTIONS.length; i++) pick(i + 1, [...acc, FACTIONS[i]]);
  };
  pick(0, []);
  return out;
}
/**
 * The line-ups games cycle through: all four factions at four players; below,
 * every combination of that many (six pairs, four triples). Within a line-up the
 * seat order rotates too, so a full cycle is lineups × players games (4, 12, 12)
 * and no faction is confounded with a seat or a partner. Eight players have one
 * line-up, every faction twice (schismSeating). Five to seven have one per way
 * to choose the worlds that split (4, 6 and 4 of them): every faction once, and
 * the split ones twice, so a cycle is 20, 36 or 28 games, and 1,260 games is a
 * whole number of cycles at each.
 */
const LINEUPS = PARTIAL
  ? factionLineups(PLAYERS - GALAXY_CLASSIC_SEATS).map((split) => [...FACTIONS, ...split])
  : SCHISM ? [[...FACTIONS, ...FACTIONS]] : factionLineups(PLAYERS);
const CYCLE = LINEUPS.length * PLAYERS;
const COLORS = ['#5dade2', '#e67e22', '#2ecc71', '#9b59b6'];

/**
 * Five to eight players: which faction each seat takes, and a house's half of
 * its world (none for a seat holding a whole world). Every block of games, one
 * per seat, starts from a seeded shuffle of the seats and rotates it a seat per
 * game, so each seat sits in every place once a block while the blocks vary
 * which seats sit next to which (a world's two houses one seat apart, or four).
 * At five to seven each block is one line-up, the blocks taking the line-ups in
 * turn, so every choice of split worlds is played as often.
 */
function schismSeating(gameIndex: number): Array<{ faction: string; half: 0 | 1; alone: boolean }> {
  const block = Math.floor(gameIndex / PLAYERS);
  const rng = createSeededRng(hashStringToSeed(`${MASTER_SEED}:schism:${block}`));
  const lineup = LINEUPS[block % LINEUPS.length]!;
  const twice = new Set(lineup.filter((f, i) => lineup.indexOf(f) !== i));
  const seats = FACTIONS.flatMap((faction) => (twice.has(faction)
    ? [0, 1].map((half) => ({ faction, half: half as 0 | 1, alone: false }))
    : [{ faction, half: 0 as 0 | 1, alone: true }]));
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [seats[i], seats[j]] = [seats[j]!, seats[i]!];
  }
  // A house alone opens on either half, drawn after the shuffle so a board
  // with none (eight players) draws exactly what it always did.
  for (const seat of seats) if (seat.alone) seat.half = rng() < 0.5 ? 0 : 1;
  const rot = gameIndex % PLAYERS;
  return seats.map((_, i) => seats[(i + rot) % PLAYERS]!);
}

/**
 * A seat's label in the Schism tables: its house's name ("<house> alone" for a
 * house with no rival on its world), or "<World> whole" for an Allied seat
 * holding a whole world.
 */
function schismSeatLabel(state: GameState, playerId: string): string {
  const house = schismHouseOf(state, playerId);
  if (house) return schismRivalOf(state, playerId) ? house.name : `${house.name} alone`;
  const whole = schismWholeWorldOf(state, playerId);
  const world = whole ? Object.entries(FACTION_WORLD_ID).find(([, w]) => w === whole.world_id)?.[0] : undefined;
  return world ? `${FACTION_WORLD[world]} whole` : '?';
}

function loadMap(): GameMap {
  // `SIM_MAP=/path/to/variant.json` runs a tuning variant without touching the
  // authored map (knob sweeps for the world rules, garrison sizes, modifiers).
  const raw = readFileSync(process.env.SIM_MAP ?? join(__dirname, '../../database/maps/era_galaxy.json'), 'utf-8');
  return JSON.parse(raw) as GameMap;
}

/** Order-independent key for a territory pair (matches moonAccess.orbitLaneId). */
function laneKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** Every orbit-typed edge as a lane key, so cross-world attacks can be counted. */
function orbitLanePairs(map: GameMap): Set<string> {
  return new Set(
    map.connections.filter((c) => c.type === 'orbit').map((c) => laneKey(c.from, c.to)),
  );
}

/** The map's world ids, in authored order. */
function worldIds(map: GameMap): string[] {
  return (map.worlds ?? []).map((w) => w.world_id);
}

function simSettings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    factions_enabled: FACTIONS_ON,
    naval_enabled: false,
    events_enabled: EVENTS,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    era_advancement_enabled: false, // galaxy is the terminal era
    galaxy_house_relations: HOUSE_RELATIONS,
    galaxy_2v2: TWO_V_TWO || undefined,
    galaxy_corridors_enabled: CORRIDORS,
    galaxy_plain_lanes: PLAIN_LANES || undefined,
    galaxy_transit_enabled: TRANSIT,
    world_rules_enabled: WORLD_RULES,
    world_rules_disabled: WORLD_RULES_OFF as WorldRuleId[],
    allowed_victory_conditions: [
      'domination',
      ...(THRESHOLD != null ? ['threshold'] : []),
      ...(SOVEREIGNTY ? ['lane_sovereignty'] : []),
    ],
    victory_type: 'domination',
    victory_threshold: THRESHOLD ?? undefined,
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
  const target = planned ?? owned[0];
  state.territories[target].unit_count += remaining;
  state.draft_units_remaining = 0;
}

function applyFortify(state: GameState, pid: string, from: string, to: string, units?: number): void {
  const f = state.territories[from];
  const t = state.territories[to];
  if (!f || !t || f.owner_id !== pid || t.owner_id !== pid) return;
  const move = Math.min(units ?? f.unit_count - 1, f.unit_count - 1);
  if (move <= 0) return;
  // Same rule the socket applies: a move between two worlds is a convoy that
  // lands at this player's next turn start (or turns back).
  if (fortifyBecomesConvoy(state, from, to)) {
    launchConvoy(state, pid, from, to, move);
    return;
  }
  f.unit_count -= move;
  t.unit_count += move;
}

/** Per-seat counters accumulated across a game (see SeatStat). */
interface SeatTelemetry {
  chartTurn: number | null;
  firstCrossCaptureTurn: number | null;
  crossExchanges: number;
  crossCaptures: number;
  homeExchanges: number;
  /** Jump Gates this seat built (a lane needs two, on different worlds). */
  jumpGatesBuilt: number;
  /** Attacks this seat resolved across a temporary Lane Surge. */
  surgeCrossings: number;
  /** Tiles this seat captured, by the victim's faction ('neutral' for unowned). */
  capturesFrom: Record<string, number>;
  /** Tiles this seat captured, by the world they lie on. */
  capturesOn: Record<string, number>;
  /** Attack exchanges this seat fought, by the defender's faction. */
  exchangesVs: Record<string, number>;
  /** The faction whose capture eliminated this seat, if one did. */
  eliminatedBy: string | null;
  /** Schism: tiles this seat captured, by the victim's house ('neutral' for unowned). */
  capturesFromHouse: Record<string, number>;
  /** Schism: the house whose capture eliminated this seat, if one did. */
  eliminatedByHouse: string | null;
  /** Convoys this seat sent, and how they ended (transit only). */
  convoysSent: number;
  convoysLanded: number;
  convoysTurnedBack: number;
  convoysLost: number;
}

/**
 * One AI player's full turn (no era advancement — galaxy is terminal).
 *
 * The attack loop mirrors `processAiTurn` in sockets/gameSocket.ts: a turn-wide
 * exchange budget from `aiAttackExchangeBudget`, each planned edge ground until
 * `shouldContinueGrind` says stop, and the remaining planned edges skipped once
 * the budget is spent. Resolving each planned edge exactly ONCE — what this
 * harness did until 2026-09 — models an AI that production does not run: the
 * grind exists because single exchanges left any 3+ unit territory uncapturable,
 * and without it this sim reported the wrong faction as broken (Forge 36% here
 * vs 8% live). `SIM_GRIND=0` restores the old behavior for comparison.
 */
/**
 * Each seat's faction label for the current game. Under SIM_FACTIONS=0 the
 * seats carry no faction_id, so telemetry reads the label from here.
 */
const seatLabel = new Map<string, string>();
/** Schism: each seat's house name for the current game (empty otherwise). */
const houseLabel = new Map<string, string>();

function playAiTurn(
  state: GameState,
  map: GameMap,
  pid: string,
  difficulty: AiDifficulty,
  dieRoll: () => number,
  jitter: () => number,
  orbitLanePairs: Set<string>,
  connectionsByKey: Map<string, MapConnection>,
  seat: SeatTelemetry,
  telemetryFor: (playerId: string) => SeatTelemetry,
): void {
  state.phase = 'draft';
  // Seed the AI's heuristic jitter. Production leaves it on Math.random, which
  // is right for live play and wrong for a measurement harness: two runs of the
  // same config on the same seed differed by up to 4 points of faction win rate
  // (measured: seed C gave Forge 18.3% then 14.3%), because jitter reorders every
  // candidate and the whole game cascades. `computeAiTurn` already accepts an rng;
  // the harness simply never passed one.
  const plan = computeAiTurn(state, map, difficulty, { rng: jitter });

  const build = selectAiBuildingPlacement(state, map, pid, difficulty);
  if (build) {
    applyBuild(state, pid, build.territoryId, build.buildingType);
    // A Jump Gate's lane only exists once it is projected onto the map copy —
    // the socket does this after every build, so the harness must too, or the
    // sim measures gates that cost 12 PP and connect nothing.
    if (build.buildingType === 'jump_gate') {
      if (syncJumpGateLanes(map, state)) {
        connectionsByKey.clear();
        for (const c of map.connections) connectionsByKey.set(laneKey(c.from, c.to), c);
      }
      seat.jumpGatesBuilt++;
    }
  }
  const techId = selectAiTechResearch(state, pid, difficulty);
  if (techId) {
    const v = validateResearch(state, pid, techId);
    if (v.valid && v.node) {
      applyResearch(state, pid, v.node);
      if (techId === 'ga_hyperspace_chart' && seat.chartTurn == null) seat.chartTurn = state.turn_number;
    }
  }

  applyDraft(state, pid, plan);

  state.phase = 'attack';
  const budget = {
    left: GRIND
      ? aiAttackExchangeBudget(difficulty, shouldPressDecidedGame(state, pid, difficulty))
      : Number.POSITIVE_INFINITY,
  };
  // Neutral off-world garrisons (the Vault's Gate Ring) are capturable only when
  // the caller says so, after the orbit-access check — the same rule the socket
  // applies. Without it the sim's ring was untouchable: 0 tiles taken in 400
  // games while live players could take it, and the Custodians read as dead.
  const aiPlayer = state.players.find((p) => p.player_id === pid)!;
  const neutralOffworldCaptureAllowed = getOrbitAccessResult(state, aiPlayer, map, state.era).allowed;
  for (const a of plan) {
    if (a.type !== 'attack' || !a.from || !a.to || a.from === '__influence__') continue;
    if (budget.left <= 0) break;
    const crossesLane = orbitLanePairs.has(laneKey(a.from, a.to));
    // The resolver only sees a lane if told about the edge: without the
    // connection the lane dice cap never fires and the sim silently measures
    // the kill-switch game.
    const connection = connectionsByKey.get(laneKey(a.from, a.to));
    for (;;) {
      const ownerBefore: string | null | undefined = state.territories[a.to]?.owner_id;
      const victimAliveBefore = ownerBefore ? !state.players.find((p) => p.player_id === ownerBefore)?.is_eliminated : false;
      const outcome = executeLandAttack(state, pid, a.from, a.to, { dieRoll, connection, neutralOffworldCaptureAllowed });
      budget.left -= 1;
      if (outcome) {
        const df = ownerBefore ? seatLabel.get(ownerBefore) ?? '?' : 'neutral';
        seat.exchangesVs[df] = (seat.exchangesVs[df] ?? 0) + 1;
      }
      if (outcome && state.territories[a.to].owner_id === pid && ownerBefore !== pid) {
        const victim: GameState["players"][number] | undefined = ownerBefore ? state.players.find((p) => p.player_id === ownerBefore) : undefined;
        const vf = victim ? seatLabel.get(victim.player_id) ?? 'neutral' : 'neutral';
        seat.capturesFrom[vf] = (seat.capturesFrom[vf] ?? 0) + 1;
        const vh = victim ? houseLabel.get(victim.player_id) ?? 'neutral' : 'neutral';
        seat.capturesFromHouse[vh] = (seat.capturesFromHouse[vh] ?? 0) + 1;
        const w = state.territories[a.to].world_id ?? '?';
        seat.capturesOn[w] = (seat.capturesOn[w] ?? 0) + 1;
        if (victim && victimAliveBefore && ownedIds(state, victim.player_id).length === 0) {
          const me = state.players.find((p) => p.player_id === pid)!;
          telemetryFor(victim.player_id).eliminatedBy = seatLabel.get(me.player_id) ?? null;
          telemetryFor(victim.player_id).eliminatedByHouse = houseLabel.get(me.player_id) ?? null;
        }
      }
      if (outcome && connection?.source === 'lane_surge') seat.surgeCrossings++;
      if (outcome) {
        if (crossesLane) {
          seat.crossExchanges++;
          if (state.territories[a.to].owner_id === pid && ownerBefore !== pid) {
            seat.crossCaptures++;
            if (seat.firstCrossCaptureTurn == null) seat.firstCrossCaptureTurn = state.turn_number;
          }
        } else {
          seat.homeExchanges++;
        }
      }
      if (!outcome || !GRIND) break;
      if (shouldContinueGrind(state, pid, a.from, a.to, budget.left) !== 'ok') break;
    }
  }

  state.phase = 'fortify';
  for (const a of plan) {
    if (a.type === 'fortify' && a.from && a.to) {
      const before = (state.transits ?? []).length;
      applyFortify(state, pid, a.from, a.to, a.units);
      if ((state.transits ?? []).length > before) seat.convoysSent++;
    }
  }
}

/**
 * Highest territory_count non-eliminated player; null on a tie. In a team game,
 * the first member of the side holding the most territories between them.
 */
function territoryLeader(state: GameState): string | null {
  if (TEAMS) {
    const sides = sidesOf(state)
      .filter((side) => side.some((id) => !state.players.find((p) => p.player_id === id)!.is_eliminated))
      .map((side) => ({ side, n: sideTerritoryCount(state, side) }))
      .sort((a, b) => b.n - a.n);
    if (sides.length < 2) return sides[0]?.side[0] ?? null;
    return sides[0]!.n > sides[1]!.n ? sides[0]!.side[0]! : null;
  }
  const counts = state.players
    .filter((p) => !p.is_eliminated)
    .map((p) => ({ id: p.player_id, n: Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length }))
    .sort((a, b) => b.n - a.n);
  if (counts.length < 2) return counts[0]?.id ?? null;
  return counts[0].n > counts[1].n ? counts[0].id : null;
}

/** One seat's game-long record — the per-faction diagnostics the tables report. */
interface SeatStat extends SeatTelemetry {
  faction: string;
  won: boolean;
  eliminated: boolean;
  /** Held every tile of a Vault (the Nexus Gate Ring) at game end. */
  holdsVault: boolean;
  /** Vault-region tiles this seat held at game end (0..ring size). */
  vaultTiles: number;
  finalTerritories: number;
  territoriesAtTurn: Record<number, number>;
}

interface GameStat {
  game: number;
  turns: number;
  winnerFaction: string | null;
  victory: string;
  decisive: boolean;
  t10Leader: string | null;
  t10LeaderWon: boolean;
  maxTerritorySpread: number;
  seats: SeatStat[];
  /** world_id → largest share held by any single player at game end. */
  worldTopShare: Record<string, number>;
  /**
   * Times any lane's (owner of end A, owner of end B) pair changed across the
   * game — the corridor identity's health signal: a galaxy where lanes never
   * change hands has stopped being a war over lanes.
   */
  laneFlips: number;
  /** Lane weather cards that actually edited the graph this game. */
  weatherClosures: number;
  weatherSurges: number;
  /** Two players only: whether their home worlds share lanes, or face across the ring. */
  layout: 'adjacent' | 'opposite' | null;
  /** Schism: each seat's house name (a Partial Schism's whole world "<World> whole"), in seat order. */
  houses: string[] | null;
  /** Partial Schism: the worlds that split, e.g. "Rust+Sol". */
  split: string | null;
  /** Team games: each seat's side, named by its worlds (e.g. "Rust+Sol"), in seat order. */
  teams: string[] | null;
  /** Schism: turn starts each seat began wearing the Lane Crown. */
  crownTurns: number[];
  /** Schism: the first turn any house began wearing the Lane Crown (null if none did). */
  crownFirstTurn: number | null;
  /** Schism: the round the first house was eliminated, and by its world's other house or not. */
  firstElimTurn: number | null;
  firstElimByRival: boolean | null;
  /** Colonies: the turn a player first took a colony tile (null if never, or no colonies). */
  colonyFirstCaptureTurn: number | null;
  /** Colonies: colony tiles held by any player, at each snapshot turn reached. */
  colonyHeldAt: Record<number, number>;
  /** How many colony tiles the game opened with (0 at four players). */
  colonyTiles: number;
}

/** Turns at which per-seat territory counts are sampled for the trajectory table. */
const TERRITORY_SNAPSHOT_TURNS = [10, 30, 60] as const;

/**
 * Every seat must open on its faction's home world and nowhere else. When a
 * map's regions stop matching the factions' `home_region_ids`,
 * tryDistributeGalaxyAgeFactionHomeworlds falls back to a random deal without
 * a word — and a sim of that game measures a different game. Fail loudly.
 */
function assertHomeworldStart(map: GameMap, state: GameState, factionOf: Record<string, string>): void {
  const worldOfRegion = new Map(map.territories.map((t) => [t.region_id, t.world_id]));
  const worldOfTile = new Map(map.territories.map((t) => [t.territory_id, t.world_id]));
  for (const [pid, factionId] of Object.entries(factionOf)) {
    // Like the engine, ignore home regions this map does not have (a variant
    // map may predate one); the ones it does have must all be on one world.
    const home = (getFactionById('galaxy_age', factionId)?.home_region_ids ?? [])
      .map((r) => worldOfRegion.get(r))
      .filter((w): w is string => w !== undefined);
    const homeWorld = home[0];
    if (!homeWorld || home.some((w) => w !== homeWorld)) {
      throw new Error(`${factionId}: home_region_ids do not resolve to one world on this map`);
    }
    const owned = ownedIds(state, pid);
    const stray = owned.filter((id) => worldOfTile.get(id) !== homeWorld);
    if (owned.length === 0 || stray.length > 0) {
      throw new Error(
        `${factionId} did not start on ${homeWorld} alone (owns ${owned.length}, off-world: ${stray.join(', ') || 'none'}) — `
        + 'the one-faction-per-world start fell back to a random deal',
      );
    }
  }
}

/**
 * Below four players the worlds nobody calls home must open as colonies: every
 * tile neutral and garrisoned, the mode recorded, and at three players the
 * ring's two gaps bridged on the map copy. Like assertHomeworldStart, a start
 * that quietly fell back to something else would be measured as this one.
 */
function assertColonyStart(map: GameMap, state: GameState): void {
  const mode = state.galaxy_mode;
  const bridges = map.connections.filter((c) => c.source === GALAXY_MODE_LANE_SOURCE).length;
  if (PLAYERS === 4) {
    if (mode || bridges > 0) throw new Error('a four-player game was dealt a board mode');
    return;
  }
  if (mode?.id !== 'colonies' || mode.neutral_worlds.length !== 4 - PLAYERS) {
    throw new Error(`${PLAYERS} players did not open on the Colonies board (${JSON.stringify(mode)})`);
  }
  for (const t of Object.values(state.territories)) {
    if (!mode.neutral_worlds.includes(t.world_id ?? '')) continue;
    if (t.owner_id !== null || t.unit_count < 1) {
      throw new Error(`colony tile ${t.territory_id} opened held or empty (${t.owner_id}, ${t.unit_count})`);
    }
  }
  if (bridges !== (PLAYERS === 3 ? 2 : 0)) {
    throw new Error(`${PLAYERS} players opened with ${bridges} bridging lanes`);
  }
}

/**
 * Five to eight players must open on the Schism board: each house on its half of
 * its faction's world and nothing else, a lone house's other half unclaimed
 * (neutral, with the garrison the board records), an Allied seat alone on its
 * world on all of it, the Vault ring neutral, and a world's two houses under
 * the Concord exactly when that is the relations being measured.
 */
function assertSchismStart(map: GameMap, state: GameState, halfOf: Record<string, 0 | 1>): void {
  const mode = state.galaxy_mode;
  if (mode?.id !== 'schism' || mode.relations !== HOUSE_RELATIONS) {
    throw new Error(`${PLAYERS} players did not open on the Schism board (${JSON.stringify(mode)})`);
  }
  const allied = HOUSE_RELATIONS === 'allied';
  const wholeSeats = allied ? GALAXY_SCHISM_SEATS - PLAYERS : 0;
  if (mode.houses.length !== PLAYERS - wholeSeats || (mode.whole_worlds?.length ?? 0) !== wholeSeats) {
    throw new Error(`${PLAYERS} players opened with ${mode.houses.length} houses and ${mode.whole_worlds?.length ?? 0} whole worlds`);
  }
  const unclaimed = schismUnclaimedTiles(mode);
  if (unclaimed.length > 0 !== (PARTIAL && !allied) || !!mode.unclaimed_garrison !== (PARTIAL && !allied)) {
    throw new Error(`${PLAYERS} players opened with ${unclaimed.length} unclaimed tiles (${JSON.stringify(mode.unclaimed_garrison)})`);
  }
  const onLane = new Set(map.connections.filter((c) => c.type === 'orbit').flatMap((c) => [c.from, c.to]));
  for (const id of unclaimed) {
    const t = state.territories[id]!;
    const garrison = onLane.has(id) ? mode.unclaimed_garrison!.gateway : mode.unclaimed_garrison!.interior;
    if (t.owner_id !== null || t.unit_count !== garrison) throw new Error(`unclaimed ${id} opened as ${t.owner_id}/${t.unit_count}`);
  }
  const vault = vaultRegionGarrisons(map);
  for (const p of state.players) {
    const whole = schismWholeWorldOf(state, p.player_id);
    if (whole) {
      if (halfOf[p.player_id] !== undefined) throw new Error(`${p.player_id} was seated as a house but dealt a whole world`);
      const tiles = map.territories.filter((t) => t.world_id === whole.world_id && !vault.has(t.territory_id)).map((t) => t.territory_id).sort();
      if (ownedIds(state, p.player_id).join() !== tiles.join()) throw new Error(`${p.player_id} did not open on all of ${whole.world_id}`);
      continue;
    }
    const house = schismHouseOf(state, p.player_id);
    if (!house || house.half !== halfOf[p.player_id]) throw new Error(`${p.player_id} was dealt the wrong half`);
    const owned = ownedIds(state, p.player_id);
    const tiles = [...schismHouseTiles(house)].sort();
    if (owned.join() !== tiles.join()) throw new Error(`${house.name} opened on ${owned.join()} not its half`);
    const rival = mode.houses.find((h) => h.world_id === house.world_id && h.player_id !== p.player_id);
    if (!rival) continue;
    const truce = !!activeTruceBetween(state, p.player_id, rival.player_id);
    if (truce !== (HOUSE_RELATIONS === 'concord' && SCHISM_TUNING.concordRounds > 0)) {
      throw new Error(`${house.name} and ${rival.name} opened ${truce ? 'under' : 'without'} a truce`);
    }
  }
}

/**
 * A team game must open with its sides dealt: Allied houses one side per world,
 * 2v2 the pairs GALAXY_2V2_PAIRS names, and allies never seated back to back.
 * Without the sides the sim would measure a free-for-all and call it a team game.
 */
function assertTeamStart(state: GameState, factionOf: Record<string, string>): void {
  const teams = state.teams ?? [];
  const worldOf = (id: string) => FACTION_WORLD_ID[factionOf[id]!]!;
  const expected = TWO_V_TWO ? GALAXY_2V2_PAIRS.map((pair) => [...pair].sort().join('+')) : FACTIONS.map((f) => FACTION_WORLD_ID[f]!).sort();
  const dealt = teams.map((t) => [...new Set(t.player_ids.map(worldOf))].sort().join('+')).sort();
  // Every side holds its worlds' seats: two per world in 2v2, one or two in Allied.
  const seatsOn = (t: { player_ids: string[] }) =>
    Object.keys(factionOf).filter((id) => t.player_ids.map(worldOf).includes(worldOf(id))).length;
  if (teams.length !== expected.length || dealt.join() !== [...expected].sort().join() || teams.some((t) => t.player_ids.length !== seatsOn(t))) {
    throw new Error(`the sides were not dealt as measured (${JSON.stringify(teams)})`);
  }
  const sideOfSeat = state.players.map((p) => teams.findIndex((t) => t.player_ids.includes(p.player_id)));
  for (let i = 0; i < sideOfSeat.length; i++) {
    if (sideOfSeat[i] === sideOfSeat[(i + 1) % sideOfSeat.length]) throw new Error(`allies sit back to back (seats ${i} and ${i + 1})`);
  }
}

/** Re-deal the opening board with no home worlds (see SIM_SCATTERED). */
function scatterStart(state: GameState, map: GameMap, gameIndex: number): void {
  const rng = createSeededRng(hashStringToSeed(`${MASTER_SEED}:scatter:${gameIndex}`));
  // Below four players the engine laid the colonies out; a scattered start has
  // none, so their tiles are dealt too (the Vault ring stays neutral either way)
  // and the three-player bridges come down.
  const colonyWorlds = new Set(state.galaxy_mode?.id === 'colonies' ? state.galaxy_mode.neutral_worlds : []);
  const vault = vaultRegionGarrisons(map);
  const ids = Object.values(state.territories)
    .filter((t) => t.owner_id || (colonyWorlds.has(t.world_id ?? '') && !vault.has(t.territory_id)))
    .map((t) => t.territory_id)
    .sort();
  if (state.galaxy_mode) {
    state.galaxy_mode = undefined;
    syncGalaxyModeLanes(map, state);
  }
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  ids.forEach((id, i) => {
    const t = state.territories[id]!;
    t.owner_id = state.players[i % state.players.length]!.player_id;
    t.unit_count = state.settings.initial_unit_count;
  });
  syncTerritoryCounts(state);
  // Mirrors calculateContinentBonusesForPlayer + the init draft in initializeGameState.
  const first = state.players[state.current_player_index]!;
  let regionBonus = 0;
  for (const region of map.regions) {
    const tiles = map.territories.filter((t) => t.region_id === region.region_id);
    if (tiles.every((t) => state.territories[t.territory_id]?.owner_id === first.player_id)) regionBonus += region.bonus;
  }
  state.draft_units_remaining = calculateReinforcements(first.territory_count, regionBonus, state.players.length)
    + getPlayerReinforceBonus(state, first.player_id);
}

function runGame(gameIndex: number, sourceMap: GameMap): GameStat {
  // A fresh map per game. Jump Gates and lane weather write their lanes into
  // `map.connections` as they open and close, so a shared map started each game
  // with the previous game's last lanes on it: games were not independent, and
  // one game changed by an unseeded engine roll changed every game after it
  // (two identical 1,000-game runs of seed B diverged from game 266 on and
  // differed by up to 4 points per faction).
  const map = structuredClone(sourceMap);
  const seed = hashStringToSeed(`${MASTER_SEED}:${gameIndex}`);
  const dieRoll = seededDie(seed);
  // Separate stream from the dice so a jitter draw can never shift a roll.
  const jitter = createSeededRng(hashStringToSeed(`${MASTER_SEED}:jitter:${gameIndex}`));
  // Rotate faction-to-player assignment per game so faction win rate isn't
  // confounded with turn order (player 0 acts first). At four players this is
  // the one line-up rotated a seat per game, as it always was.
  const lineup = LINEUPS[gameIndex % LINEUPS.length]!;
  const rot = Math.floor(gameIndex / LINEUPS.length) % PLAYERS;
  const seating = SCHISM ? schismSeating(gameIndex) : null;
  const players = Array.from({ length: PLAYERS }, (_, i) => ({
    player_id: `ai_${i}`,
    player_index: i,
    username: `AI-${i}`,
    color: COLORS[i % COLORS.length],
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
    faction_id: seating ? seating[i]!.faction : lineup[(i + rot) % PLAYERS]!,
  }));
  const halfOf: Record<string, 0 | 1> = {};
  if (seating) {
    // An Allied seat alone on its world holds all of it, and has no half.
    players.forEach((p, i) => {
      if (!(seating[i]!.alone && HOUSE_RELATIONS === 'allied')) halfOf[p.player_id] = seating[i]!.half;
    });
  }
  const factionOf: Record<string, string> = {};
  for (const p of players) factionOf[p.player_id] = p.faction_id;
  seatLabel.clear();
  for (const p of players) seatLabel.set(p.player_id, p.faction_id);
  // No kits: the label stays in factionOf for the report, the seat carries none.
  const enginePlayers = FACTIONS_ON ? players : players.map((p) => ({ ...p, faction_id: undefined }));

  const state = initializeGameState(`galsim_${gameIndex}`, 'galaxy_age', map, enginePlayers, simSettings(), {
    forceStartingPlayerIndex: 0,
    ...(SCHISM ? { forceSchismHalves: halfOf } : {}),
  });
  if (SCATTERED) scatterStart(state, map, gameIndex);
  else {
    assertHomeworldStart(map, state, factionOf);
    if (SCHISM) assertSchismStart(map, state, halfOf);
    else assertColonyStart(map, state);
    if (TEAMS) assertTeamStart(state, factionOf);
  }

  const houses = SCHISM && !SCATTERED
    ? state.players.map((p) => schismSeatLabel(state, p.player_id))
    : null;
  // Partial Schism: the worlds that split this game, e.g. "Rust+Sol".
  const split = PARTIAL && !SCATTERED && state.galaxy_mode?.id === 'schism'
    ? [...new Set(state.galaxy_mode.houses.map((h) => h.world_id))]
      .map((w) => FACTION_WORLD[Object.entries(FACTION_WORLD_ID).find(([, id]) => id === w)![0]]!).sort().join('+')
    : null;
  const teams = TEAMS && !SCATTERED
    ? state.players.map((p) => {
      const side = state.teams!.find((t) => t.player_ids.includes(p.player_id))!;
      return [...new Set(side.player_ids.map((id) => FACTION_WORLD[factionOf[id]!]!))].sort().join('+');
    })
    : null;
  houseLabel.clear();
  if (houses) state.players.forEach((p, i) => houseLabel.set(p.player_id, houses[i]!));
  const crownTurns = state.players.map(() => 0);
  let crownFirstTurn: number | null = null;
  let firstElimTurn: number | null = null;
  let firstElimByRival: boolean | null = null;
  applyCatchup(state);
  // Two players: are the home worlds neighbours on the ring, or across it?
  const homes = players.map((p) => FACTION_WORLD_ID[p.faction_id]!).sort();
  const layout: GameStat['layout'] = PLAYERS !== 2
    ? null
    : neighbouringWorlds(map).has(`${homes[0]}::${homes[1]}`) ? 'adjacent' : 'opposite';
  const colonyWorldIds = state.galaxy_mode?.id === 'colonies' ? state.galaxy_mode.neutral_worlds : [];
  const colonyTiles = Object.values(state.territories)
    .filter((t) => colonyWorldIds.includes(t.world_id ?? ''))
    .map((t) => t.territory_id);
  let colonyFirstCaptureTurn: number | null = null;
  const colonyHeldAt: Record<number, number> = {};

  const lanes = orbitLanePairs(map);
  const connectionsByKey = new Map(map.connections.map((c) => [laneKey(c.from, c.to), c]));
  const telemetry: Record<string, SeatTelemetry> = {};
  const snapshots: Record<string, Record<number, number>> = {};
  for (const p of players) {
    telemetry[p.player_id] = {
      chartTurn: null,
      firstCrossCaptureTurn: null,
      crossExchanges: 0,
      crossCaptures: 0,
      homeExchanges: 0,
      jumpGatesBuilt: 0,
      surgeCrossings: 0,
      capturesFrom: {},
      capturesOn: {},
      exchangesVs: {},
      eliminatedBy: null,
      capturesFromHouse: {},
      eliminatedByHouse: null,
      convoysSent: 0,
      convoysLanded: 0,
      convoysTurnedBack: 0,
      convoysLost: 0,
    };
    snapshots[p.player_id] = {};
  }

  const orbitEdges = map.connections.filter((c) => c.type === 'orbit');
  const laneSignature = (): string =>
    orbitEdges.map((c) => `${state.territories[c.from]?.owner_id ?? ''}|${state.territories[c.to]?.owner_id ?? ''}`).join(';');
  let lastLaneSignature = laneSignature();
  let laneFlips = 0;
  let weatherClosures = 0;
  let weatherSurges = 0;

  let t10Leader: string | null = null;
  let t10Captured = false;
  let maxSpread = 0;
  let guard = 0;
  while (state.phase !== 'game_over' && guard < (MAX_TURNS + 2) * PLAYERS + 5) {
    guard++;
    const player = state.players[state.current_player_index];
    if (!player.is_eliminated) {
      playAiTurn(state, map, player.player_id, DIFFICULTY, dieRoll, jitter, lanes, connectionsByKey, telemetry[player.player_id], (id) => telemetry[id]);
    }
    advanceToNextPlayer(state, map);
    applyCatchup(state);
    if (houses) {
      // The Crown pays at the wearer's own turn start, which is now.
      const next = state.players[state.current_player_index]!;
      if (!next.is_eliminated && holdsLaneCrown(state, next.player_id)) {
        crownTurns[state.current_player_index]!++;
        if (crownFirstTurn == null) crownFirstTurn = state.turn_number;
      }
      if (firstElimTurn == null) {
        const out = state.players.find((p) => p.is_eliminated);
        if (out) {
          firstElimTurn = state.turn_number;
          const killer = telemetry[out.player_id]?.eliminatedBy;
          firstElimByRival = killer === factionOf[out.player_id];
        }
      }
    }
    for (const arrival of state.last_transit_arrivals ?? []) {
      const seatT = telemetry[arrival.convoy.owner_id];
      if (!seatT) continue;
      if (arrival.outcome === 'landed') seatT.convoysLanded++;
      else if (arrival.outcome === 'turned_back') seatT.convoysTurnedBack++;
      else seatT.convoysLost++;
    }
    state.last_transit_arrivals = undefined;
    // The socket clears `active_event` once it has broadcast the card; with no
    // socket here it would otherwise stay set and the SAME instant card would
    // re-apply every round (measured: 11.6 "closures" per game where the deck can
    // only deal about 4). Clear it the way broadcastEventCard does.
    const weatherResult = state.active_event_result?.lane_weather;
    if (weatherResult?.kind === 'closure') weatherClosures++;
    if (weatherResult?.kind === 'surge') weatherSurges++;
    state.active_event = undefined;
    state.active_event_result = undefined;
    // Lane weather edits the graph between rounds; the socket projects it onto
    // the map copy after every advance, so the harness must too.
    if (syncLaneWeatherLanes(map, state)) {
      connectionsByKey.clear();
      for (const c of map.connections) connectionsByKey.set(laneKey(c.from, c.to), c);
    }

    const sig = laneSignature();
    if (sig !== lastLaneSignature) {
      const before = lastLaneSignature.split(';');
      laneFlips += sig.split(';').filter((v, i) => v !== before[i]).length;
      lastLaneSignature = sig;
    }

    const counts = state.players
      .filter((p) => !p.is_eliminated)
      .map((p) => Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length);
    if (counts.length > 1) maxSpread = Math.max(maxSpread, Math.max(...counts) - Math.min(...counts));

    // Sample once per snapshot turn, at the top of the round.
    for (const turn of TERRITORY_SNAPSHOT_TURNS) {
      if (state.turn_number !== turn || state.current_player_index !== 0) continue;
      for (const p of state.players) {
        if (snapshots[p.player_id][turn] == null) {
          snapshots[p.player_id][turn] = ownedIds(state, p.player_id).length;
        }
      }
      if (colonyTiles.length > 0 && colonyHeldAt[turn] == null) {
        colonyHeldAt[turn] = colonyTiles.filter((id) => state.territories[id]?.owner_id).length;
      }
    }
    if (colonyFirstCaptureTurn == null && colonyTiles.some((id) => state.territories[id]?.owner_id)) {
      colonyFirstCaptureTurn = state.turn_number;
    }

    if (!t10Captured && state.turn_number >= 10) { t10Captured = true; t10Leader = territoryLeader(state); }

    const victory = checkVictory(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0];
      state.winner_ids = victory.winnerIds;
      state.victory_condition = victory.condition;
    }
  }

  const winner = state.winner_id ?? null;
  // Every member of a winning side won (a free-for-all game has one winner).
  const winners = new Set(state.winner_ids ?? (winner ? [winner] : []));

  const worldTopShare: Record<string, number> = {};
  for (const worldId of worldIds(map)) {
    const byOwner: Record<string, number> = {};
    for (const t of Object.values(state.territories)) {
      if (t.world_id === worldId && t.owner_id) byOwner[t.owner_id] = (byOwner[t.owner_id] ?? 0) + 1;
    }
    worldTopShare[worldId] = Math.max(0, ...Object.values(byOwner));
  }

  const vaultRegionSet = new Set(vaultStatuses(state).map((v) => v.region_id));
  const seats: SeatStat[] = state.players.map((p) => ({
    ...telemetry[p.player_id],
    faction: factionOf[p.player_id] ?? `seat${p.player_index}`,
    won: winners.has(p.player_id),
    eliminated: p.is_eliminated,
    holdsVault: vaultStatuses(state).some((v) => v.holder_id === p.player_id),
    vaultTiles: Object.values(state.territories).filter(
      (t) => t.owner_id === p.player_id && vaultRegionSet.has(t.region_id ?? ''),
    ).length,
    finalTerritories: ownedIds(state, p.player_id).length,
    territoriesAtTurn: snapshots[p.player_id],
  }));

  return {
    game: gameIndex,
    turns: state.turn_number,
    winnerFaction: winner ? factionOf[winner] ?? null : null,
    victory: state.victory_condition ?? 'turn_limit',
    decisive: state.victory_condition != null && state.victory_condition !== 'turn_limit',
    t10Leader,
    t10LeaderWon: !!t10Leader && winners.has(t10Leader),
    maxTerritorySpread: maxSpread,
    seats,
    worldTopShare,
    laneFlips,
    weatherClosures,
    weatherSurges,
    layout,
    colonyFirstCaptureTurn,
    colonyHeldAt,
    colonyTiles: colonyTiles.length,
    houses,
    split,
    teams,
    crownTurns,
    crownFirstTurn,
    firstElimTurn,
    firstElimByRival,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

function avg(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fixed(n: number, places = 1): string {
  return Number.isFinite(n) ? n.toFixed(places) : '—';
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function main(): void {
  const map = loadMap();
  const terr = map.territories.length;
  const started = Date.now();
  const stats: GameStat[] = [];
  for (let i = 0; i < GAMES; i++) stats.push(runGame(i, map));
  const elapsedS = (Date.now() - started) / 1000;

  const decisive = stats.filter((s) => s.decisive);
  const withT10 = stats.filter((s) => s.t10Leader);
  const byFaction: Record<string, number> = {};
  for (const f of FACTIONS) byFaction[f] = 0;
  // Seats that won, by faction: one per game in a free-for-all game, every
  // member of the winning side in a team game.
  for (const s of stats) for (const seat of s.seats) if (seat.won) byFaction[seat.faction] = (byFaction[seat.faction] ?? 0) + 1;
  // Below four players a faction sits out some games, so its win rate is a share
  // of the games it played (at four players that is every game).
  const played: Record<string, number> = {};
  for (const s of stats) for (const seat of s.seats) played[seat.faction] = (played[seat.faction] ?? 0) + 1;

  console.log(`\nGalactic Age balance — ${GAMES} games · ${PLAYERS}p · ${DIFFICULTY} · maxTurns ${MAX_TURNS}${THRESHOLD != null ? ` · threshold ${THRESHOLD}%` : ''} · ${terr} territories`);
  console.log(`Seed "${MASTER_SEED}" · attack loop ${GRIND ? 'GRIND (mirrors live AI)' : 'single-exchange (SIM_GRIND=0, legacy)'} · corridors ${CORRIDORS ? 'ON' : 'OFF (SIM_CORRIDORS=0)'} · factions ${Object.keys(FACTION_PATCH).length ? `patched ${JSON.stringify(FACTION_PATCH)}` : 'as shipped'} · world rules ${WORLD_RULES ? (WORLD_RULES_OFF.length ? `ON except ${WORLD_RULES_OFF.join('+')}` : 'ON') : 'OFF (SIM_WORLD_RULES=0)'} · sovereignty ${SOVEREIGNTY ? `ON (${LANE_SOVEREIGNTY_CORRIDORS_NEEDED} lanes, ${(TEAMS ? LANE_SOVEREIGNTY_ROUNDS_BY_SIDES[SIDES] : LANE_SOVEREIGNTY_ROUNDS_BY_SEATS[PLAYERS]) ?? LANE_SOVEREIGNTY_ROUNDS} rounds${TEAMS ? ` for ${SIDES} sides` : ''})` : 'OFF (SIM_SOVEREIGNTY=0)'}${PLAYERS < 4 && !SCATTERED ? ` · colonies ${COLONY_GARRISONS.gateway}/${COLONY_GARRISONS.interior} (gateway/interior)` : ''}${TWO_V_TWO ? ` · 2v2 ${GALAXY_2V2_PAIRS.map((p) => p.join('+')).join(' vs ')}` : ''}${TEAMS ? ` · opening ceasefire ${TEAM_TUNING.openingCeasefire ? 'ON' : 'OFF (SIM_CEASEFIRE=0)'}` : ''}${SCHISM && !SCATTERED ? ` · schism ${HOUSE_RELATIONS === 'concord' ? `Concord ${SCHISM_TUNING.concordRounds} rounds` : HOUSE_RELATIONS === 'allied' ? `Allied ${JSON.stringify(ALLIED_TUNING)}` : 'Civil War'}, Lane Crown +${HOUSE_RELATIONS === 'allied' ? 0 : SCHISM_TUNING.laneCrownBonus}${process.env.SIM_SCHISM_HALVES ? ' · halves patched (SIM_SCHISM_HALVES)' : ''}${process.env.SIM_SCHISM_OPENING ? ` · opening ${process.env.SIM_SCHISM_OPENING}` : ''}${process.env.SIM_SCHISM_REINFORCE ? ` · house reinforce ${process.env.SIM_SCHISM_REINFORCE}` : ''}${PARTIAL ? (HOUSE_RELATIONS === 'allied'
    ? ` · partial Allied house ${signed(PARTIAL_SCHISM_TUNING[PLAYERS]!.allied.house)} whole ${signed(PARTIAL_SCHISM_TUNING[PLAYERS]!.allied.whole)}`
    : ` · partial unclaimed ${PARTIAL_SCHISM_TUNING[PLAYERS]!.unclaimed.gateway}/${PARTIAL_SCHISM_TUNING[PLAYERS]!.unclaimed.interior}, halves ${JSON.stringify(PARTIAL_SCHISM_HALVES)}`) : ''}` : ''} · transit ${TRANSIT ? 'ON (SIM_TRANSIT=1)' : 'OFF'}${SCATTERED ? ' · start SCATTERED (SIM_SCATTERED=1, no home worlds)' : ''}${FACTIONS_ON ? '' : ' · factions OFF (SIM_FACTIONS=0, labels are seats)'}${PLAIN_LANES ? ' · PLAIN LANES (SIM_PLAIN_LANES=1)' : ''}${CATCHUP_PER != null ? ` · catch-up: -1 reinforcement per ${CATCHUP_PER} tiles over a quarter (SIM_CATCHUP_PER)` : ''} · ${elapsedS.toFixed(1)}s (${((elapsedS / GAMES) * 1000).toFixed(1)}ms/game)\n`);
  if (GAMES % CYCLE !== 0) {
    console.log(`⚠ ${GAMES} games is not a multiple of the ${CYCLE}-game line-up cycle, so factions and seats are sampled unevenly\n`);
  }
  console.log(`Avg game length (turns):          ${(stats.reduce((a, s) => a + s.turns, 0) / GAMES).toFixed(1)}`);
  console.log(`Decisive (non-turn-limit) wins:   ${pct(decisive.length, GAMES)}`);
  const byCondition = new Map<string, number>();
  for (const s of stats) byCondition.set(s.victory, (byCondition.get(s.victory) ?? 0) + 1);
  console.log(`Victory breakdown:                ${[...byCondition.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${pct(n, GAMES)}`).join(' · ')}`);
  console.log(`Territory-leader@turn10 win rate: ${pct(withT10.filter((s) => s.t10LeaderWon).length, withT10.length)}  (snowball signal; ${pct(1, SIDES)} baseline${TEAMS ? '; the leading side' : ''})`);
  console.log(`First-seat win rate:              ${pct(stats.filter((s) => s.seats[0]?.won).length, GAMES)}  (${pct(1, SIDES)} baseline; seat 0 moves first${TEAMS ? ', and wins with its side' : ''})`);
  console.log(`Avg peak territory spread:        ${(stats.reduce((a, s) => a + s.maxTerritorySpread, 0) / GAMES).toFixed(1)} (leader − laggard, of ${terr})`);
  console.log(`Lane end-owner changes per game:  ${fixed(avg(stats.map((s) => s.laneFlips)))} (corridor health; a lane that never changes hands is a wall)`);
  console.log(`\n— Per-faction win rate (${PLAYERS}p baseline = ${pct(1, SIDES)} of the games it played${TEAMS ? ', per seat, with its side' : ''}) —`);
  for (const f of FACTIONS) {
    const wins = byFaction[f];
    const games = played[f] ?? 0;
    if (games === 0) continue;
    const rate = wins / games;
    const flag = rate > 1.4 / SIDES ? '  <== high' : rate < 0.6 / SIDES ? '  <== low' : '';
    console.log(`  ${f.padEnd(20)} ${FACTION_WORLD[f].padEnd(7)} ${pct(wins, games).padStart(6)}${flag}${games !== GAMES ? `  (of ${games})` : ''}`);
  }
  const noWinner = stats.filter((s) => !s.winnerFaction).length;
  if (noWinner) console.log(`  (no winner / turn-limit):           ${pct(noWinner, GAMES)}`);

  // ── Teams ─────────────────────────────────────────────────────────────────
  // A side wins or loses whole, so this is the table the team gate reads:
  // each side within ±28% of its 1/sides share.
  const teamGames = stats.filter((s) => s.teams);
  if (teamGames.length > 0) {
    const labels = [...new Set(teamGames.flatMap((s) => s.teams!))].sort();
    console.log(`\n— Team win rates (baseline ${pct(1, SIDES)} of the games a side played) —`);
    for (const label of labels) {
      const games = teamGames.filter((s) => s.teams!.includes(label));
      const wins = games.filter((s) => s.seats.some((seat, i) => s.teams![i] === label && seat.won)).length;
      const rate = wins / Math.max(1, games.length);
      const flag = rate > 1.28 / SIDES ? '  <== high' : rate < 0.72 / SIDES ? '  <== low' : '';
      const elim = games.flatMap((s) => s.seats.filter((_, i) => s.teams![i] === label));
      console.log(`  ${label.padEnd(22)}${pct(wins, games.length).padStart(7)}   seats eliminated ${pct(elim.filter((x) => x.eliminated).length, elim.length)}${flag}`);
    }
    console.log(`  (±28% band flagged)`);
  }

  // ── Colonies ──────────────────────────────────────────────────────────────
  // The mode is a race for the unclaimed worlds: when do players reach them, how
  // much of them is settled, and (two players) does it matter whether the home
  // worlds are neighbours or face each other across the ring?
  const colonyGames = stats.filter((s) => s.colonyTiles > 0);
  if (colonyGames.length > 0) {
    const tiles = colonyGames[0]!.colonyTiles;
    const reached = colonyGames.filter((s) => s.colonyFirstCaptureTurn != null);
    const held = TERRITORY_SNAPSHOT_TURNS.map((t) =>
      `@${t} ${fixed(avg(colonyGames.map((s) => s.colonyHeldAt[t]).filter((n): n is number => n != null)))}`,
    ).join(' · ');
    console.log(`\n— Colonies (${tiles} tiles open neutral) —`);
    console.log(`  First colony tile taken: turn ${fixed(avg(reached.map((s) => s.colonyFirstCaptureTurn!)))} (in ${pct(reached.length, colonyGames.length)} of games)`);
    console.log(`  Colony tiles settled:    ${held}`);
  }
  if (PLAYERS === 2) {
    for (const layout of ['opposite', 'adjacent'] as const) {
      const games = stats.filter((s) => s.layout === layout);
      if (games.length === 0) continue;
      const conditions = new Map<string, number>();
      for (const g of games) conditions.set(g.victory, (conditions.get(g.victory) ?? 0) + 1);
      console.log(
        `  ${layout.padEnd(9)} homes: ${String(games.length).padStart(4)} games · ${fixed(avg(games.map((g) => g.turns)))} turns · `
        + `decisive ${pct(games.filter((g) => g.decisive).length, games.length)} · `
        + `${[...conditions.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${pct(n, games.length)}`).join(' · ')} · `
        + `first seat wins ${pct(games.filter((g) => g.seats[0]?.won).length, games.length)}`,
      );
    }
  }

  // ── Schism ────────────────────────────────────────────────────────────────
  // Houses, two to a split world. The faction table above is per seat; this one
  // splits each faction into its two houses, whose halves are not the same
  // ground, and says who wore the Lane Crown and who died first to whom. In a
  // Partial Schism a seat holding a whole world is a row of its own.
  const schismGames = stats.filter((s) => s.houses);
  if (schismGames.length > 0 && PARTIAL) {
    // The Partial Schism's own question: does a house alone on its world (or,
    // Allied, a seat holding one) fare as well as a house with a rival? The
    // unclaimed half's garrison (PARTIAL_SCHISM_TUNING) is tuned on this table.
    const isWhole = (label: string) => label.endsWith(' whole') || label.endsWith(' alone');
    const roleRow = (label: string, seats: SeatStat[]) => {
      const rate = seats.filter((x) => x.won).length / Math.max(1, seats.length);
      const flag = rate > 1.28 / SIDES ? '  <== high' : rate < 0.72 / SIDES ? '  <== low' : '';
      console.log(
        `  ${label.padEnd(22)}${pct(seats.filter((x) => x.won).length, seats.length).padStart(7)}`
        + `${pct(seats.filter((x) => x.eliminated).length, seats.length).padStart(7)}`
        + `${fixed(avg(seats.map((x) => x.territoriesAtTurn[10]).filter((n): n is number => n != null))).padStart(6)}`
        + `${fixed(avg(seats.map((x) => x.territoriesAtTurn[30]).filter((n): n is number => n != null))).padStart(6)}`
        + `${fixed(avg(seats.map((x) => x.finalTerritories))).padStart(6)}${String(seats.length).padStart(7)}${flag}`,
      );
    };
    const seatsWhere = (games: GameStat[], keep: (label: string) => boolean) =>
      games.flatMap((s) => s.seats.filter((_, i) => keep(s.houses![i]!)));
    console.log(`\n— Partial Schism: seats sharing a world, and seats alone on one (baseline ${pct(1, SIDES)} of games${TEAMS ? ', per seat, with its side' : ''}) —`);
    console.log(`  ${'seat'.padEnd(22)}${'wins'.padStart(7)}${'elim'.padStart(7)}${'@10'.padStart(6)}${'@30'.padStart(6)}${'@end'.padStart(6)}${'seats'.padStart(7)}`);
    roleRow('with a rival or ally', seatsWhere(schismGames, (l) => !isWhole(l)));
    roleRow(HOUSE_RELATIONS === 'allied' ? 'holding a whole world' : 'alone on its world', seatsWhere(schismGames, isWhole));
    const splits = [...new Set(schismGames.map((s) => s.split!))].sort();
    console.log(`\n— Partial Schism by the worlds that split: seats sharing a world | seats alone —`);
    for (const split of splits) {
      const games = schismGames.filter((s) => s.split === split);
      const houseSeats = seatsWhere(games, (l) => !isWhole(l));
      const wholeSeats = seatsWhere(games, isWhole);
      const turns = fixed(avg(games.map((g) => g.turns)));
      console.log(
        `  ${`${split} split`.padEnd(24)}${pct(houseSeats.filter((x) => x.won).length, houseSeats.length).padStart(7)} |`
        + `${pct(wholeSeats.filter((x) => x.won).length, wholeSeats.length).padStart(7)}   ${String(games.length).padStart(4)} games · ${turns} turns`,
      );
    }
  }
  if (schismGames.length > 0) {
    const names = [...new Set(schismGames.flatMap((s) => s.houses!))].sort();
    console.log(`\n— Schism ${PARTIAL ? 'seats' : 'houses'} (baseline ${pct(1, SIDES)} of games) —`);
    console.log(`  ${'house'.padEnd(22)}${'wins'.padStart(7)}${'elim'.padStart(7)}${'crown'.padStart(7)}${'@10'.padStart(6)}${'@30'.padStart(6)}${'@end'.padStart(6)}`);
    for (const name of names) {
      const seats = schismGames.flatMap((s) => s.seats.flatMap((seat, i) => (s.houses![i] === name ? [{ seat, crown: s.crownTurns[i]! }] : [])));
      const rate = seats.filter((x) => x.seat.won).length / Math.max(1, seats.length);
      const flag = rate > 1.28 / SIDES ? '  <== high' : rate < 0.72 / SIDES ? '  <== low' : '';
      console.log(
        `  ${name.padEnd(22)}${pct(seats.filter((x) => x.seat.won).length, seats.length).padStart(7)}`
        + `${pct(seats.filter((x) => x.seat.eliminated).length, seats.length).padStart(7)}`
        + `${pct(seats.filter((x) => x.crown > 0).length, seats.length).padStart(7)}`
        + `${fixed(avg(seats.map((x) => x.seat.territoriesAtTurn[10]).filter((n): n is number => n != null))).padStart(6)}`
        + `${fixed(avg(seats.map((x) => x.seat.territoriesAtTurn[30]).filter((n): n is number => n != null))).padStart(6)}`
        + `${fixed(avg(seats.map((x) => x.seat.finalTerritories))).padStart(6)}${flag}`,
      );
    }
    console.log(`  crown: share of the house's games in which it wore the Lane Crown for at least one turn start (±28% band flagged)`);
    const crowned = schismGames.filter((s) => s.crownFirstTurn != null);
    const winnerCrowned = schismGames.filter((s) => s.seats.some((seat, i) => seat.won && s.crownTurns[i]! > 0));
    const decided = schismGames.filter((s) => s.seats.some((seat) => seat.won));
    console.log(`  Lane Crown worn in ${pct(crowned.length, schismGames.length)} of games, first on turn ${fixed(avg(crowned.map((s) => s.crownFirstTurn!)))} · the winner wore it in ${pct(winnerCrowned.length, decided.length)} of decided games`);
    const elim = schismGames.filter((s) => s.firstElimTurn != null);
    console.log(`  First ${PARTIAL ? 'seat' : 'house'} out: turn ${fixed(avg(elim.map((s) => s.firstElimTurn!)))} (in ${pct(elim.length, schismGames.length)} of games) · by its own world's other house in ${pct(elim.filter((s) => s.firstElimByRival).length, elim.length)}`);
    const shortName = (n: string): string => n.split(' ')[0]!.slice(0, 7);
    console.log(`\n— Schism captures per game, attacker house (row) → victim house (column) —`);
    console.log(`  ${'attacker'.padEnd(22)}${[...names, 'neutral'].map((v) => shortName(v).padStart(8)).join('')}`);
    for (const name of names) {
      const seats = schismGames.flatMap((s) => s.seats.filter((_, i) => s.houses![i] === name));
      console.log(`  ${name.padEnd(22)}${[...names, 'neutral'].map((v) => fixed(avg(seats.map((x) => x.capturesFromHouse[v] ?? 0))).padStart(8)).join('')}`);
    }
    console.log(`\n— Schism eliminated by (share of this house's games) —`);
    for (const name of names) {
      const seats = schismGames.flatMap((s) => s.seats.filter((_, i) => s.houses![i] === name));
      const by = names
        .map((k) => [k, seats.filter((x) => x.eliminatedByHouse === k).length] as const)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${shortName(k)} ${pct(n, seats.length)}`)
        .join(' · ');
      console.log(`  ${name.padEnd(22)}${by || '—'}`);
    }
  }

  // ── Per-faction diagnostics ────────────────────────────────────────────────
  // Win rate alone can't say WHY a faction loses. These columns separate the
  // candidate causes: dying early (elim), never getting off its world (first
  // cross capture), spending exchanges without converting them (cross ex→cap),
  // or bleeding territory over time (the trajectory).
  const seatsByFaction = new Map<string, SeatStat[]>();
  for (const s of stats) {
    for (const seat of s.seats) {
      const list = seatsByFaction.get(seat.faction) ?? [];
      list.push(seat);
      seatsByFaction.set(seat.faction, list);
    }
  }
  const snapCols = TERRITORY_SNAPSHOT_TURNS.map((t) => `@${t}`.padStart(6)).join('');
  console.log(`\n— Per-faction diagnostics (per seat, per game) —`);
  console.log(`  ${'faction'.padEnd(20)}${'elim'.padStart(7)}${'chartT'.padStart(8)}${'1stCrossT'.padStart(11)}${'crossEx'.padStart(9)}${'crossCap'.padStart(9)}${'homeEx'.padStart(8)}${snapCols}${'@end'.padStart(7)}`);
  for (const f of FACTIONS) {
    const seats = seatsByFaction.get(f) ?? [];
    if (seats.length === 0) continue;
    const crossed = seats.filter((s) => s.firstCrossCaptureTurn != null);
    const snaps = TERRITORY_SNAPSHOT_TURNS.map((t) =>
      fixed(avg(seats.map((s) => s.territoriesAtTurn[t]).filter((n): n is number => n != null))).padStart(6),
    ).join('');
    console.log(
      `  ${f.padEnd(20)}${pct(seats.filter((s) => s.eliminated).length, seats.length).padStart(7)}` +
      `${fixed(avg(seats.map((s) => s.chartTurn).filter((n): n is number => n != null))).padStart(8)}` +
      `${fixed(avg(crossed.map((s) => s.firstCrossCaptureTurn!))).padStart(11)}` +
      `${fixed(avg(seats.map((s) => s.crossExchanges))).padStart(9)}` +
      `${fixed(avg(seats.map((s) => s.crossCaptures))).padStart(9)}` +
      `${fixed(avg(seats.map((s) => s.homeExchanges))).padStart(8)}` +
      `${snaps}${fixed(avg(seats.map((s) => s.finalTerritories))).padStart(7)}`,
    );
  }
  console.log(`  chartT/1stCrossT: turn, averaged over seats that got there · crossEx→crossCap: lane exchanges vs captures`);

  // Who takes tiles from whom, and on which world: a rule on one world can move
  // a faction that never touches it only through the others' choices.
  const victims = [...FACTIONS, 'neutral'];
  console.log(`\n— Captures per game, attacker (row) → victim (column) —`);
  console.log(`  ${'attacker'.padEnd(20)}${victims.map((v) => v.split('_')[0].slice(0, 8).padStart(10)).join('')}`);
  for (const f of FACTIONS) {
    const seats = seatsByFaction.get(f) ?? [];
    if (seats.length === 0) continue;
    console.log(`  ${f.padEnd(20)}${victims.map((v) => fixed(avg(seats.map((s) => s.capturesFrom[v] ?? 0))).padStart(10)).join('')}`);
  }
  console.log(`\n— Attack exchanges per game, attacker (row) → defender (column) —`);
  console.log(`  ${'attacker'.padEnd(20)}${victims.map((v) => v.split('_')[0].slice(0, 8).padStart(10)).join('')}`);
  for (const f of FACTIONS) {
    const seats = seatsByFaction.get(f) ?? [];
    if (seats.length === 0) continue;
    console.log(`  ${f.padEnd(20)}${victims.map((v) => fixed(avg(seats.map((s) => s.exchangesVs[v] ?? 0))).padStart(10)).join('')}`);
  }
  const worldList = worldIds(map);
  console.log(`\n— Captures per game by world, attacker (row) —`);
  console.log(`  ${'attacker'.padEnd(20)}${worldList.map((w) => w.slice(0, 8).padStart(10)).join('')}`);
  for (const f of FACTIONS) {
    const seats = seatsByFaction.get(f) ?? [];
    if (seats.length === 0) continue;
    console.log(`  ${f.padEnd(20)}${worldList.map((w) => fixed(avg(seats.map((s) => s.capturesOn[w] ?? 0))).padStart(10)).join('')}`);
  }
  console.log(`\n— Eliminated by (share of this faction's games) —`);
  for (const f of FACTIONS) {
    const seats = seatsByFaction.get(f) ?? [];
    if (seats.length === 0) continue;
    const by = FACTIONS.map((k) => `${k.split('_')[0]} ${pct(seats.filter((s) => s.eliminatedBy === k).length, seats.length)}`).join(' · ');
    console.log(`  ${f.padEnd(20)}${by}`);
  }

  // Per-world concentration: a galaxy where every world ends wholly owned by one
  // player has stopped being contested, whatever the win rates say.
  const worlds = worldIds(map);
  if (worlds.length > 0) {
    const perWorld = worlds
      .map((w) => `${w} ${fixed(avg(stats.map((s) => s.worldTopShare[w] ?? 0)))}`)
      .join(' · ');
    console.log(`\nLargest single-owner share per world at game end: ${perWorld}`);
  }

  // The Vault: is the prize actually taken, and by whom? A ring nobody holds
  // at game end is a garrison the bots walk past; one always held by its home
  // faction is a homeworld with extra steps.
  if (WORLD_RULES) {
    const allSeats = stats.flatMap((s) => s.seats);
    const held = allSeats.filter((s) => s.holdsVault);
    const byFaction = FACTIONS.map((f) => `${f} ${pct(held.filter((s) => s.faction === f).length, GAMES)}`).join(' · ');
    console.log(`Vault (Nexus Gate Ring) held at game end: ${pct(held.length, GAMES)} of games · ${byFaction}`);
    const tilesByFaction = FACTIONS
      .map((f) => `${f} ${fixed(avg(allSeats.filter((s) => s.faction === f).map((s) => s.vaultTiles)))}`)
      .join(' · ');
    console.log(`Vault tiles held at game end (avg of 4): ${tilesByFaction}`);
  }

  // Jump Gates: a lane needs two, so "built >= 2" is the share of seats that
  // actually opened one. A gate nobody builds is a dead 12-PP button.
  {
    const allGateSeats = stats.flatMap((g) => g.seats);
    const gatesByFaction = FACTIONS
      .map((f) => `${f} ${fixed(avg(allGateSeats.filter((s) => s.faction === f).map((s) => s.jumpGatesBuilt)))}`)
      .join(' · ');
    console.log(`Jump Gate lanes opened in: ${pct(stats.filter((g) => g.seats.some((s) => s.jumpGatesBuilt >= 2)).length, GAMES)} of games · avg gates per seat: ${gatesByFaction}`);
    console.log(`  (${pct(allGateSeats.filter((s) => s.jumpGatesBuilt >= 2).length, allGateSeats.length)} of seats built the two a lane needs)`);
  }

  if (EVENTS) {
    const allWeatherSeats = stats.flatMap((g) => g.seats);
    const crossings = allWeatherSeats.reduce((n, s) => n + s.surgeCrossings, 0);
    const gamesWithSurge = stats.filter((g) => g.weatherSurges > 0);
    const gamesWithCrossing = stats.filter((g) => g.seats.some((s) => s.surgeCrossings > 0));
    console.log(
      `Lane weather: ${fixed(avg(stats.map((g) => g.weatherClosures)))} closures + `
      + `${fixed(avg(stats.map((g) => g.weatherSurges)))} surges per game`,
    );
    console.log(
      `  surge lanes crossed in ${pct(gamesWithCrossing.length, Math.max(1, gamesWithSurge.length))} of games that opened one `
      + `(${crossings} crossings total)`,
    );
  }

  if (TRANSIT) {
    const seats = stats.flatMap((g) => g.seats);
    const sent = seats.reduce((n, s) => n + s.convoysSent, 0);
    const landed = seats.reduce((n, s) => n + s.convoysLanded, 0);
    const back = seats.reduce((n, s) => n + s.convoysTurnedBack, 0);
    const lost = seats.reduce((n, s) => n + s.convoysLost, 0);
    console.log(`Transit: ${fixed(avg(seats.map((s) => s.convoysSent)))} convoys per seat per game`);
    console.log(
      `  of ${sent} sent: ${pct(landed, Math.max(1, sent))} landed · ${pct(back, Math.max(1, sent))} turned back · ${pct(lost, Math.max(1, sent))} lost`,
    );
  }

  if (CSV_PATH) {
    // One row per SEAT per game: faction win rates are seat-level, so seat-level
    // rows are what any follow-up analysis actually needs.
    const header = [
      'game', 'turns', 'victory', 'decisive', 'max_territory_spread',
      'faction', 'won', 'eliminated', 'chart_turn', 'first_cross_capture_turn',
      'cross_exchanges', 'cross_captures', 'home_exchanges', 'final_territories',
      ...TERRITORY_SNAPSHOT_TURNS.map((t) => `territories_at_${t}`),
      'players', 'seat', 'layout', 'house', 'crown_turns', 'team', 'split',
    ].join(',');
    const rows = stats.flatMap((s) =>
      s.seats.map((seat, i) => [
        s.game, s.turns, s.victory, s.decisive, s.maxTerritorySpread,
        seat.faction, seat.won, seat.eliminated, seat.chartTurn ?? '', seat.firstCrossCaptureTurn ?? '',
        seat.crossExchanges, seat.crossCaptures, seat.homeExchanges, seat.finalTerritories,
        ...TERRITORY_SNAPSHOT_TURNS.map((t) => seat.territoriesAtTurn[t] ?? ''),
        PLAYERS, i, s.layout ?? '', s.houses?.[i] ?? '', s.crownTurns[i] ?? 0, s.teams?.[i] ?? '', s.split ?? '',
      ].join(',')),
    );
    writeFileSync(CSV_PATH, [header, ...rows].join('\n') + '\n');
    console.log(`\nWrote per-seat CSV → ${CSV_PATH} (${rows.length} rows)`);
  }
}

main();
