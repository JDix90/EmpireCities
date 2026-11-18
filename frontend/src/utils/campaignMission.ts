import { humanizeMapId, type MapNameLookup } from './mapDisplayNames';
import { factionDisplayName } from './factionNames';

/**
 * A campaign stage's stated objective, as the stage's settings carry it
 * (`campaign_mission`, backend victory/missions.ts): the player's mission is
 * this one, and the bots hold none.
 */
export type CampaignStageMission =
  | { kind: 'control_regions'; region_ids: string[] }
  | { kind: 'capture_territories'; territory_ids: [string, string] }
  | { kind: 'eliminate_faction'; faction_id: string };

/** The setting, if it is shaped like an objective. */
export function readCampaignMission(raw: unknown): CampaignStageMission | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as { kind?: unknown; region_ids?: unknown; territory_ids?: unknown; faction_id?: unknown };
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
  if (m.kind === 'control_regions' && strings(m.region_ids)) {
    return { kind: 'control_regions', region_ids: m.region_ids };
  }
  if (m.kind === 'capture_territories' && strings(m.territory_ids) && m.territory_ids.length === 2) {
    return { kind: 'capture_territories', territory_ids: [m.territory_ids[0]!, m.territory_ids[1]!] };
  }
  if (m.kind === 'eliminate_faction' && typeof m.faction_id === 'string') {
    return { kind: 'eliminate_faction', faction_id: m.faction_id };
  }
  return null;
}

/**
 * A map name, or until the map has loaded the id made readable. The late-era
 * maps suffix their ids with the era ("manchuria_ww2", "korea_cw"), which the
 * shared fallback would print.
 */
function nameOf(id: string, named: Array<{ id: string; name: string }> | undefined): string {
  const fromMap = named?.find((n) => n.id === id)?.name.trim();
  return fromMap || humanizeMapId(id.replace(/_(ww2|cw|th)$/i, ''));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The objective as the stage's intro states it, before the game has dealt
 * anything: "Hold every territory in the Western Front". The map's names when
 * the map has loaded, the ids made readable until then.
 */
export function describeCampaignMission(
  mission: CampaignStageMission,
  opts: { lookup?: MapNameLookup | null; eraId?: string | null } = {},
): string {
  if (mission.kind === 'control_regions') {
    const regions = opts.lookup?.regions?.map((r) => ({ id: r.region_id, name: r.name }));
    return `Hold every territory in ${joinNames(mission.region_ids.map((id) => nameOf(id, regions)))}`;
  }
  if (mission.kind === 'capture_territories') {
    const territories = opts.lookup?.territories?.map((t) => ({ id: t.territory_id, name: t.name }));
    return `Capture ${joinNames(mission.territory_ids.map((id) => nameOf(id, territories)))}, and hold both`;
  }
  const name = factionDisplayName(opts.eraId, mission.faction_id) ?? 'the named power';
  return `Eliminate ${name} yourself`;
}
