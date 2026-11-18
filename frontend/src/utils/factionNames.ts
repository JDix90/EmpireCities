import { FACTION_NAMES } from '../constants/factionNames.generated';

/** A faction's display name in an era ("Parthian Empire"), or null when the id is not one of that era's. */
export function factionDisplayName(eraId: string | null | undefined, factionId: string | null | undefined): string | null {
  if (!eraId || !factionId) return null;
  return FACTION_NAMES[eraId]?.[factionId] ?? null;
}

/**
 * How a bot is named in a campaign stage: for the power it plays, with its
 * commander's name kept beside it, since battles and the log still use that.
 * A stage's text names its opponents ("Parthia bleeds invaders dry"); the
 * board named them "Marshal Okonkwo (AI)", the same three in every stage.
 * Null for anyone else: a person, a bot with no faction, a game that is not a
 * campaign stage.
 */
export function campaignBotFaction(input: {
  isCampaign: boolean;
  eraId: string | null | undefined;
  player: { is_ai?: boolean; faction_id?: string | null };
  /** The stage's own names for its factions, where it plays one period on another's (`campaign_display`). */
  names?: Record<string, string> | null;
}): string | null {
  if (!input.isCampaign || !input.player.is_ai) return null;
  const own = input.player.faction_id ? input.names?.[input.player.faction_id] : undefined;
  return own ?? factionDisplayName(input.eraId, input.player.faction_id);
}
