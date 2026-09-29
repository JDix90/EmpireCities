import { randomBytes } from 'crypto';
import type { GameMap, GameState, PlayerState, SecretMission } from '../../types';
import { getMaxEraIndex, getStateSpineSteps } from '../eraAdvancement/spines';
import { territoryUnlockEra } from '../eraAdvancement/territoryUnlock';
import { territoryRequiresOrbitAccessForClaim } from '../state/moonAccess';
import { isLunarTerritory } from '../state/helium3';

/** Lunar tiles this player holds — the measure both Phase 5 missions read. */
function countLunarTilesHeldBy(state: GameState, playerId: string): number {
  return Object.values(state.territories)
    .filter((t) => t.owner_id === playerId && isLunarTerritory(t))
    .length;
}

/**
 * The two authored polar basins, and the id of the lunar region. Named rather
 * than derived so a mission cannot silently retarget if the map gains tiles.
 */
const LUNAR_POLE_IDS: [string, string] = ['moon_polar_north', 'moon_polar_south'];
const LUNAR_REGION_ID = 'lunar_surface';

/**
 * Lunar tiles a Lunar Denial holder must stand on themselves.
 *
 * THREE, not the one §7.2 specified. At one tile the objective is really just
 * "be first to the Moon", which is a race outcome rather than a thing you work
 * at. Swept over 5 replicates x 60 games per value, completion rate within the
 * lunar deck:
 *
 *   >=1 tile   denial 46%  ·  foothold 36%  ·  poles 16%  ·  whole Moon 3%
 *   >=2 tiles  denial 38%  ·  foothold 39%  ·  poles 13%  ·  whole Moon 0%
 *   >=3 tiles  denial 31%  ·  foothold 32%  ·  poles 20%  ·  whole Moon 6%
 *
 * At one tile denial was three times easier than the ordinary-mission mean of
 * 16%; at three it sits level with Lunar Foothold, which is the objective it
 * most resembles. Three is also the foothold the Phase 2 tier asks for, so the
 * mission reads as "establish a real position AND keep them off it".
 *
 * Note the aggregate barely moved across the sweep (23.5% → 22.1%): §7.4's gate
 * averages four objectives with a 15x spread between easiest and hardest, so it
 * cannot see an imbalance inside the deck. That is a limitation of the gate,
 * not evidence there was nothing to fix.
 */
const LUNAR_DENIAL_MIN_TILES = 3;

/**
 * The four lunar objectives (Moon Race, Phase 5).
 *
 * Two of them need no new mission kind at all — the poles are an ordinary
 * `capture_territories` and the whole Moon an ordinary `control_regions`.
 *
 * This branch DELIBERATELY targets ground the generic path excludes. The
 * exclusion above exists because a random capture mission naming a Moon tile
 * would be wildly unfair against a rival whose mission is two ordinary
 * territories. These are different: the player knows the objective is lunar,
 * every one of them is lunar, and by Phase 3 the contest rule makes reaching an
 * occupied Moon cost two techs and one build rather than the full ladder.
 */
function buildLunarMission(
  map: GameMap,
  others: PlayerState[],
  rng: () => number,
): SecretMission | null {
  const lunarTilesOnMap = map.territories.filter(
    (t) => t.region_id === LUNAR_REGION_ID,
  ).length;
  if (lunarTilesOnMap === 0) return null;

  const options: SecretMission[] = [
    { kind: 'capture_territories', territory_ids: LUNAR_POLE_IDS },
    { kind: 'control_regions', region_ids: [LUNAR_REGION_ID] },
    // Three tiles is the Phase 2 tier's own threshold; five is most of the Moon
    // without being the whole-Moon mission above.
    { kind: 'lunar_foothold', tiles: rng() < 0.5 ? 3 : 5 },
  ];
  // Denial needs somebody to deny.
  if (others.length > 0) {
    const target = others[Math.floor(rng() * others.length)]!;
    options.push({ kind: 'lunar_denial', target_player_id: target.player_id });
  }
  // Both poles must actually exist on the resolved map, or the first option is
  // an objective nobody can complete.
  const poles = LUNAR_POLE_IDS.every((id) => map.territories.some((t) => t.territory_id === id));
  const pool = poles ? options : options.slice(1);
  return pool[Math.floor(rng() * pool.length)]!;
}

/**
 * Deterministic 32-bit seed from an arbitrary string (FNV-1a). Used together
 * with `mission_seed_salt` so the resulting PRNG sequence is reproducible
 * within a game but unrecoverable from public information like `game_id`.
 */
export function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG; returns floats in [0, 1). */
export function createSeededRng(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickManyUnique<T>(items: T[], count: number, rng: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

/**
 * Deal every player's secret mission, from the game's private salt: at init on
 * a dealt board, and when the Territory Draft ends on a drafted one. Before
 * then nobody holds a tile, so a capture or region mission could name ground
 * its holder was about to draft, and win on turn one.
 */
export function dealSecretMissions(state: GameState, map: GameMap): void {
  // Legacy saves predate the salt; one without it would seed from game_id alone.
  state.mission_seed_salt ??= randomBytes(16).toString('hex');
  const seed = hashStringToSeed(`${state.game_id}:${state.mission_seed_salt}:secret_missions`);
  assignSecretMissions(state, map, createSeededRng(seed));
}

/**
 * Assign secret missions when `secret_mission` is an allowed victory mode.
 * Caller must supply an RNG seeded from `game_id + mission_seed_salt` (see
 * `dealSecretMissions`). Using just `game_id` would let any client
 * regenerate every opponent's mission from the public game URL.
 *
 * Regions that contain zero territories on the resolved map are filtered out
 * before being eligible for a `control_regions` mission — otherwise the
 * mission was mathematically unwinnable (caller can never own a territory
 * inside the empty region), permanently softlocking secret_mission victory.
 */
export function assignSecretMissions(
  state: GameState,
  map: GameMap,
  rng: () => number,
): void {
  // Two classes of authored tile are excluded from mission targets:
  //
  // 1. Orbit-gated territories (the Space Age Moon, locked galaxy worlds):
  //    reaching them first requires a deep tech ladder, so a capture/control
  //    mission there would be wildly unfair against a rival whose mission is
  //    two ordinary tiles.
  // 2. Era-locked frontiers (`unlock_era_index` above the state's era floor):
  //    `initializeGameState` holds these out of `state.territories` entirely,
  //    and mission completion reads `state.territories[id]?.owner_id`, so a
  //    mission naming one is not merely unfair but permanently unwinnable.
  //    Missions are assigned at init, before any player has advanced, so the
  //    floor recorded on the state is the whole story: `map_era_floor` is the
  //    max unlock era when the standalone Space Age board is fully seeded
  //    (`space_age_frontiers_enabled`) and 0 otherwise. In era-advancement
  //    games frontiers DO enter play later via `globalEraFloor`, but a tile
  //    that only exists after someone climbs several eras is still the wrong
  //    target for a day-one objective, so we deliberately do not look past
  //    the init-time floor.
  //
  // Counting regions over the reachable set also drops all-gated regions
  // (e.g. lunar_surface, or the 2100 frontier regions) from control_regions
  // via the existing empty-region filter below.
  const eraFloor = state.map_era_floor ?? 0;
  const reachable = map.territories.filter(
    (t) =>
      !territoryRequiresOrbitAccessForClaim(map, t.territory_id) &&
      territoryUnlockEra(t) <= eraFloor,
  );
  const territoryIds = reachable.map((t) => t.territory_id);
  const territoriesPerRegion = new Map<string, number>();
  for (const t of reachable) {
    territoriesPerRegion.set(t.region_id, (territoriesPerRegion.get(t.region_id) ?? 0) + 1);
  }
  // Only regions that actually contain at least one territory can be a
  // control_regions target. If every region on a map is empty (impossible on
  // shipped maps, but possible in dev/editor) we fall back to other mission
  // kinds rather than handing the player an automatically-failed objective.
  const regionIds = map.regions
    .map((r) => r.region_id)
    .filter((id) => (territoriesPerRegion.get(id) ?? 0) > 0);

  const lunarMissionsEnabled = state.settings.space_age_moon_missions_enabled === true;

  for (const player of state.players) {
    const others = state.players.filter((p) => p.player_id !== player.player_id);
    const owned = new Set(
      Object.entries(state.territories)
        .filter(([, t]) => t.owner_id === player.player_id)
        .map(([id]) => id),
    );
    const enemyOwned = territoryIds.filter((id) => !owned.has(id));
    // A region the player already holds whole would be a mission won the moment
    // it is dealt — likelier after a Territory Draft, where players draft whole
    // regions for the bonus.
    const openRegionIds = regionIds.filter(
      (rid) => !playerOwnsAllTerritoriesInRegions(state, map, player.player_id, [rid]),
    );
    const roll = rng();
    let mission: SecretMission;

    // Space Age lunar branch (Moon Race, Phase 5). Placed after the
    // era-advancement branch and gated the same way — on a setting that is off
    // for every other game — so the RNG STREAM for non-Space-Age games is
    // byte-identical to before this existed: the roll is already drawn, the
    // condition is false, and the same fall-through tests run in the same order.
    const lunarMission = lunarMissionsEnabled && roll < 0.30
      ? buildLunarMission(map, others, rng)
      : null;

    if (state.settings.era_advancement_enabled && getMaxEraIndex(state) >= 1 && roll < 0.25) {
      // Era-themed objective: reach a mid-spine era (capped by the spine length).
      // Gated on era advancement so the RNG stream for non-era games is unchanged.
      const targetIndex = Math.min(2, getMaxEraIndex(state));
      const eraId = getStateSpineSteps(state)[targetIndex]?.era_id ?? 'medieval';
      mission = { kind: 'reach_era', era_index: Math.max(1, targetIndex), era_id: eraId };
    } else if (lunarMission) {
      mission = lunarMission;
    } else if (roll < 0.34 && enemyOwned.length >= 2) {
      const [a, b] = pickManyUnique(enemyOwned, 2, rng);
      mission = { kind: 'capture_territories', territory_ids: [a, b] };
    } else if (roll < 0.67 && others.length > 0) {
      const target = others[Math.floor(rng() * others.length)]!;
      mission = { kind: 'eliminate_player', target_player_id: target.player_id };
    } else if (openRegionIds.length >= 2) {
      const m = rng() < 0.5 ? 1 : 2;
      const picks = pickManyUnique(openRegionIds, Math.min(m, openRegionIds.length), rng);
      mission = { kind: 'control_regions', region_ids: picks };
    } else if (enemyOwned.length >= 2) {
      const [a, b] = pickManyUnique(enemyOwned, 2, rng);
      mission = { kind: 'capture_territories', territory_ids: [a, b] };
    } else if (others.length > 0) {
      const target = others[Math.floor(rng() * others.length)]!;
      mission = { kind: 'eliminate_player', target_player_id: target.player_id };
    } else {
      mission = { kind: 'control_regions', region_ids: regionIds.slice(0, 1) };
    }

    player.secret_mission = mission;
  }

  // Alliance missions: ~20% chance in 4+ player games; assign as pairs of
  // humans still in the game (one can resign during a Territory Draft).
  const seated = state.players.filter((p) => !p.is_eliminated);
  if (seated.length >= 4 && rng() < 0.20) {
    const humanPlayers = seated.filter((p) => !p.is_ai);
    if (humanPlayers.length >= 2) {
      const threshold = allianceTerritoryThreshold(state);
      const picked = pickManyUnique(humanPlayers, 2, rng);
      // Never dealt half-won: a pair where either ally already holds the
      // threshold keeps its ordinary missions.
      const open = picked.every((p) => countTerritoriesHeldBy(state, p.player_id) < threshold);
      if (picked.length === 2 && open) {
        const [ally1, ally2] = picked as [typeof humanPlayers[0], typeof humanPlayers[0]];
        ally1.secret_mission = { kind: 'alliance', ally_player_id: ally2.player_id, territory_threshold: threshold };
        ally2.secret_mission = { kind: 'alliance', ally_player_id: ally1.player_id, territory_threshold: threshold };
      }
    }
  }
}

/**
 * Territories each ally must hold to win an alliance mission: an even share of
 * the tiles dealt, plus 7% of them. WW2 deals 35 tiles, so 4 seats need 12
 * each, 5 need 10 and 6 need 9. In simulated medium-AI games that wins about as
 * often as the two allies' own missions would have. The old rule, 20% of the
 * whole map, ignored the seat count: every alliance in a 4-seat WW2 game was
 * dealt already won.
 */
export function allianceTerritoryThreshold(state: GameState): number {
  const seats = state.players.filter((p) => !p.is_eliminated).length;
  const dealt = Object.values(state.territories).filter((t) => t.owner_id != null).length;
  // ceil(dealt × (1/seats + 7/100)) in integers: the float form rounds up a
  // whole number that comes out a hair over.
  return Math.ceil((dealt * (100 + 7 * seats)) / (100 * seats));
}

function countTerritoriesHeldBy(state: GameState, playerId: string): number {
  return Object.values(state.territories).filter((t) => t.owner_id === playerId).length;
}

/** Each player's capital = lexicographically first owned territory id (deterministic). */
export function assignCapitals(state: GameState): void {
  for (const player of state.players) {
    const owned = Object.keys(state.territories)
      .filter((tid) => state.territories[tid].owner_id === player.player_id)
      .sort();
    player.capital_territory_id = owned[0] ?? null;
  }
}

function playerOwnsAllTerritoriesInRegions(
  state: GameState,
  map: GameMap,
  playerId: string,
  regionIds: string[],
): boolean {
  for (const rid of regionIds) {
    const inRegion = map.territories.filter((t) => t.region_id === rid);
    if (inRegion.length === 0) return false;
    const allOwned = inRegion.every((t) => state.territories[t.territory_id]?.owner_id === playerId);
    if (!allOwned) return false;
  }
  return true;
}

export function isMissionComplete(state: GameState, map: GameMap, player: PlayerState): boolean {
  const m = player.secret_mission;
  if (!m) return false;

  switch (m.kind) {
    case 'capture_territories': {
      const [a, b] = m.territory_ids;
      return (
        state.territories[a]?.owner_id === player.player_id &&
        state.territories[b]?.owner_id === player.player_id
      );
    }
    case 'eliminate_player': {
      // The holder has to do it. A target someone else eliminates, or who
      // resigns or falls to rebels, fails the mission for good.
      const target = state.players.find((p) => p.player_id === m.target_player_id);
      return target?.is_eliminated === true && target.eliminated_by === player.player_id;
    }
    case 'control_regions':
      return playerOwnsAllTerritoriesInRegions(state, map, player.player_id, m.region_ids);
    case 'reach_era':
      return (player.current_era_index ?? 0) >= m.era_index;
    // ── Space Age Moon Race, Phase 5 ──────────────────────────────────────
    case 'lunar_foothold':
      return countLunarTilesHeldBy(state, player.player_id) >= m.tiles;
    case 'lunar_denial': {
      // Both halves matter: standing on the Moon yourself is what makes it a
      // denial rather than a wish, and it is why this cannot be satisfied by a
      // rival simply never going.
      if (countLunarTilesHeldBy(state, player.player_id) < LUNAR_DENIAL_MIN_TILES) return false;
      return countLunarTilesHeldBy(state, m.target_player_id) === 0;
    }
    case 'alliance':
      // Alliance victory is handled in checkVictory directly (requires both players)
      return false;
    default:
      return false;
  }
}
