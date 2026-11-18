import type { AnalyticsPayload } from '../../services/analyticsEvents';

/**
 * The properties of `campaign_stage_finished`: one stage game played to a
 * result. `rounds` and `ended_by` say how long the stage ran and what decided
 * it ('threshold', 'turn_limit', 'secret_mission', ...); `failed_attempts` is
 * the stage attempts the campaign had lost before this result; `line` is the
 * side played, on a stage that has sides.
 */
export function campaignStageFinishedProperties(input: {
  campaignId: string;
  pathId: string | null;
  isGuest: boolean;
  /** Zero-based index of the stage in its path. */
  eraIndex: number;
  eraId: string;
  gameId: string;
  won: boolean;
  rounds: number;
  gameStartedAt: number | null | undefined;
  endedBy: string | null | undefined;
  failedAttempts: number | null;
  line?: string | null;
  now?: number;
}): AnalyticsPayload {
  return {
    campaign_id: input.campaignId,
    path_id: input.pathId ?? 'classic',
    is_guest: input.isGuest,
    stage: input.eraIndex + 1,
    era_id: input.eraId,
    game_id: input.gameId,
    won: input.won,
    rounds: input.rounds,
    duration_ms: input.gameStartedAt ? (input.now ?? Date.now()) - input.gameStartedAt : null,
    ended_by: input.endedBy ?? null,
    failed_attempts: input.failedAttempts ?? 0,
    line: input.line ?? null,
  };
}
