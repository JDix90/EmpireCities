import type { GameMap, GameState, PlayerState, SecretMission } from '../../types';

/** Deterministic seed from UUID / game id string. */
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
 * Uses game_id-derived RNG for reproducibility.
 */
export function assignSecretMissions(
  state: GameState,
  map: GameMap,
  rng: () => number,
): void {
  const territoryIds = map.territories.map((t) => t.territory_id);
  const regionIds = map.regions.map((r) => r.region_id);

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

    if (roll < 0.34 && enemyOwned.length >= 2) {
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
    case 'alliance':
      // Alliance victory is handled in checkVictory directly (requires both players)
      return false;
    default:
      return false;
  }
}
