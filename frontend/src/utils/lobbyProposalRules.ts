/**
 * Whether a waiting-room proposal is on offer in this lobby. The server holds
 * a vote to the rules a create request is (backend createGameSettings.ts,
 * lobbySettingVoteRejection) and refuses what the create form would never
 * produce; the form hides those choices rather than offer an error.
 */
export function isLobbyProposalOffered(
  settings: { async_mode?: boolean; territory_selection?: boolean } | null | undefined,
  key: string,
  value?: unknown,
): boolean {
  // An async game runs on its own daily deadline, not the turn timer.
  if (key === 'turn_timer_seconds' && settings?.async_mode === true) return false;
  // Territory Draft cannot be combined with Asymmetric Factions.
  if (key === 'factions_enabled' && value === true && settings?.territory_selection === true) return false;
  return true;
}
