import type { PlayerState, SecretMissionPayload } from '../store/gameStore';
import { ERA_LABELS } from '../constants/gameLobbyLabels';

export interface MapNameLookup {
  territories?: Array<{ territory_id: string; name: string }>;
  regions?: Array<{ region_id: string; name: string }>;
}

/** Turn internal ids (snake_case, optional suffixes) into readable fallback labels. */
export function humanizeMapId(id: string): string {
  const stripped = id
    .replace(/_mod$/i, '')
    .replace(/_2100$/i, '')
    .replace(/^era_/, '');
  return stripped
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function resolveTerritoryName(
  territoryId: string,
  lookup?: MapNameLookup | null,
): string {
  const fromMap = lookup?.territories?.find((t) => t.territory_id === territoryId)?.name;
  if (fromMap?.trim()) return fromMap.trim();
  return humanizeMapId(territoryId);
}

export function resolveRegionName(
  regionId: string,
  lookup?: MapNameLookup | null,
): string {
  const fromMap = lookup?.regions?.find((r) => r.region_id === regionId)?.name;
  if (fromMap?.trim()) return fromMap.trim();
  return humanizeMapId(regionId);
}

export function formatEraLabel(eraId: string | undefined | null): string {
  if (!eraId) return '—';
  if (eraId === 'custom') return 'Community map';
  return ERA_LABELS[eraId] ?? humanizeMapId(eraId);
}

export function describeSecretMission(
  mission: SecretMissionPayload,
  players: PlayerState[],
  lookup?: MapNameLookup | null,
): string {
  if (mission.kind === 'capture_territories' && mission.territory_ids?.length) {
    const names = mission.territory_ids.map((id) => resolveTerritoryName(id, lookup));
    return `Own ${names.join(' and ')}`;
  }
  if (mission.kind === 'eliminate_player' && mission.target_player_id) {
    const target = players.find((p) => p.player_id === mission.target_player_id);
    return `Eliminate ${target?.username ?? 'opponent'}`;
  }
  if (mission.kind === 'control_regions' && mission.region_ids?.length) {
    const names = mission.region_ids.map((id) => resolveRegionName(id, lookup));
    return `Control ${names.join(', ')}`;
  }
  if (mission.kind === 'reach_era' && mission.era_id) {
    return `Advance to the ${formatEraLabel(mission.era_id)}`;
  }
  if (mission.kind === 'lunar_foothold' && mission.tiles) {
    return `Hold ${mission.tiles} Moon territories`;
  }
  if (mission.kind === 'lunar_denial' && mission.target_player_id) {
    const target = players.find((p) => p.player_id === mission.target_player_id);
    return `Hold the Moon while ${target?.username ?? 'an opponent'} holds none of it`;
  }
  return 'Complete your secret objective';
}

export type SecretMissionLike = {
  kind: string;
  territory_ids?: string[];
  target_player_id?: string;
  region_ids?: string[];
  ally_player_id?: string;
  era_id?: string;
  /** Space Age Moon Race, Phase 5: Lunar Foothold's tile count. */
  tiles?: number;
};

export type PlayerNameLookup = Pick<PlayerState, 'player_id' | 'username'>;

export function formatSecretMissionReveal(
  mission: SecretMissionLike,
  lookup?: MapNameLookup | null,
  players?: PlayerNameLookup[],
): string {
  switch (mission.kind) {
    case 'capture_territories':
      return `Capture ${(mission.territory_ids ?? [])
        .map((id) => resolveTerritoryName(id, lookup))
        .join(' and ')}`;
    case 'eliminate_player': {
      const target = players?.find((p) => p.player_id === mission.target_player_id);
      return `Eliminate ${target?.username ?? 'opponent'}`;
    }
    case 'control_regions':
      return `Control ${(mission.region_ids ?? [])
        .map((id) => resolveRegionName(id, lookup))
        .join(', ')}`;
    case 'alliance': {
      const ally = players?.find((p) => p.player_id === mission.ally_player_id);
      return `Form alliance with ${ally?.username ?? 'another player'}`;
    }
    case 'reach_era':
      return `Advance to the ${formatEraLabel(mission.era_id)}`;
    case 'lunar_foothold':
      return `Hold ${mission.tiles ?? 3} Moon territories`;
    case 'lunar_denial': {
      const denied = players?.find((p) => p.player_id === mission.target_player_id);
      return `Hold the Moon while ${denied?.username ?? 'an opponent'} holds none of it`;
    }
    default:
      return 'Unknown mission';
  }
}
