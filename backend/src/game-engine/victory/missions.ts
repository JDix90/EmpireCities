import type { GameMap, GameState, PlayerState, SecretMission } from '../../types';
import { getMaxEraIndex, getStateSpineSteps } from '../eraAdvancement/spines';

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
 * Assign secret missions when `secret_mission` is an allowed victory mode.
 * Caller must supply an RNG seeded from `game_id + mission_seed_salt` (see
 * `gameStateManager.startGame`). Using just `game_id` would let any client
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
  const territoryIds = map.territories.map((t) => t.territory_id);
  const territoriesPerRegion = new Map<string, number>();
  for (const t of map.territories) {
    territoriesPerRegion.set(t.region_id, (territoriesPerRegion.get(t.region_id) ?? 0) + 1);
  }
  // Only regions that actually contain at least one territory can be a
  // control_regions target. If every region on a map is empty (impossible on
  // shipped maps, but possible in dev/editor) we fall back to other mission
  // kinds rather than handing the player an automatically-failed objective.
  const regionIds = map.regions
    .map((r) => r.region_id)
    .filter((id) => (territoriesPerRegion.get(id) ?? 0) > 0);

  for (const player of state.players) {
    const others = state.players.filter((p) => p.player_id !== player.player_id);
    const owned = new Set(
      Object.entries(state.territories)
        .filter(([, t]) => t.owner_id === player.player_id)
        .map(([id]) => id),
    );
    const enemyOwned = territoryIds.filter((id) => !owned.has(id));
    const roll = rng();
    let mission: SecretMission;

    if (state.settings.era_advancement_enabled && getMaxEraIndex(state) >= 1 && roll < 0.25) {
      // Era-themed objective: reach a mid-spine era (capped by the spine length).
      // Gated on era advancement so the RNG stream for non-era games is unchanged.
      const targetIndex = Math.min(2, getMaxEraIndex(state));
      const eraId = getStateSpineSteps(state)[targetIndex]?.era_id ?? 'medieval';
      mission = { kind: 'reach_era', era_index: Math.max(1, targetIndex), era_id: eraId };
    } else if (roll < 0.34 && enemyOwned.length >= 2) {
      const [a, b] = pickManyUnique(enemyOwned, 2, rng);
      mission = { kind: 'capture_territories', territory_ids: [a, b] };
    } else if (roll < 0.67 && others.length > 0) {
      const target = others[Math.floor(rng() * others.length)]!;
      mission = { kind: 'eliminate_player', target_player_id: target.player_id };
    } else if (regionIds.length >= 2) {
      const m = rng() < 0.5 ? 1 : 2;
      const picks = pickManyUnique(regionIds, Math.min(m, regionIds.length), rng);
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

  // Alliance missions: ~20% chance in 4+ player games; assign as pairs
  if (state.players.length >= 4 && rng() < 0.20) {
    const humanPlayers = state.players.filter((p) => !p.is_ai);
    if (humanPlayers.length >= 2) {
      const totalTerritories = map.territories.length;
      const threshold = Math.floor(totalTerritories * 0.20);
      const picked = pickManyUnique(humanPlayers, 2, rng);
      if (picked.length === 2) {
        const [ally1, ally2] = picked as [typeof humanPlayers[0], typeof humanPlayers[0]];
        ally1.secret_mission = { kind: 'alliance', ally_player_id: ally2.player_id, territory_threshold: threshold };
        ally2.secret_mission = { kind: 'alliance', ally_player_id: ally1.player_id, territory_threshold: threshold };
      }
    }
  }
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
      const target = state.players.find((p) => p.player_id === m.target_player_id);
      return target?.is_eliminated === true;
    }
    case 'control_regions':
      return playerOwnsAllTerritoriesInRegions(state, map, player.player_id, m.region_ids);
    case 'reach_era':
      return (player.current_era_index ?? 0) >= m.era_index;
    case 'alliance':
      // Alliance victory is handled in checkVictory directly (requires both players)
      return false;
    default:
      return false;
  }
}
