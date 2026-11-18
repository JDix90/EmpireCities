/**
 * A path that lets the player take a side partway through, as `/campaign/list`
 * describes it (backend campaignPaths `describeLineChoice`). Absent from a
 * path with no sides and from an older server.
 */
export interface CampaignLineChoice {
  /** Index of the stage that offers the choice. */
  choose_at: number;
  /** The side this campaign has taken, or null while it has taken none. */
  chosen: string | null;
  options: Array<{
    line_id: string;
    name: string;
    pitch: string;
    /** The stage the side opens on ("The Second Front, 1944"). */
    title: string | null;
    faction_id: string | null;
  }>;
}

/**
 * The sides to offer before this campaign's next game, or null when it has no
 * choice to make now. The stage that offers the choice asks on a first attempt
 * and again on a retry, since a player who lost as one side may try the other.
 * A stage game still in progress is resumed on the side it was started on.
 */
export function pendingLineChoice(campaign: {
  status: string;
  current_era_index: number;
  line_choice?: CampaignLineChoice | null;
  eras: Array<{ index: number; game_id: string | null; completed: boolean }>;
}): CampaignLineChoice | null {
  const choice = campaign.line_choice;
  if (!choice || choice.options.length < 2) return null;
  if (campaign.status !== 'active' || campaign.current_era_index !== choice.choose_at) return null;
  const stage = campaign.eras.find((e) => e.index === choice.choose_at);
  const inProgress = !!stage?.game_id && !stage.completed;
  return inProgress ? null : choice;
}
