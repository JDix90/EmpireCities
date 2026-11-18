/**
 * Names a campaign stage shows in place of the era's own (backend types
 * `CampaignStageDisplay`): the American Revolution runs on the WW2 era, whose
 * label and factions would otherwise be on screen in 1776.
 */
export interface CampaignStageDisplay {
  era_label?: string;
  factions?: Record<string, string>;
  objective?: string;
}

/** The setting, read defensively: an older server sends none. */
export function readCampaignDisplay(raw: unknown): CampaignStageDisplay {
  if (!raw || typeof raw !== 'object') return {};
  const d = raw as { era_label?: unknown; factions?: unknown; objective?: unknown };
  const out: CampaignStageDisplay = {};
  if (typeof d.era_label === 'string' && d.era_label) out.era_label = d.era_label;
  if (typeof d.objective === 'string' && d.objective) out.objective = d.objective;
  if (d.factions && typeof d.factions === 'object') {
    const factions: Record<string, string> = {};
    for (const [id, name] of Object.entries(d.factions as Record<string, unknown>)) {
      if (typeof name === 'string' && name) factions[id] = name;
    }
    out.factions = factions;
  }
  return out;
}
