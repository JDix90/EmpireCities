import { CAMPAIGN_PATHS, getPathEraConfig, type PathId } from './campaignPaths';
import { describeCampaignCarry, type CampaignCarryEffect } from './campaignCarryEffects';

/**
 * What a campaign stage's result means for the campaign, sent with
 * `game:over` so the result screen can say it: the stage's own closing text,
 * what was carried forward, and what comes next. Without it the screen was
 * the ordinary one, and the closing text was only ever shown in a collapsed
 * row on the campaign page.
 */
export interface CampaignGameResult {
  campaign_id: string;
  /** Null for the classic campaign, which has no path. */
  path_id: string | null;
  path_name: string;
  /** One-based. */
  stage: number;
  stage_count: number;
  /** The stage's own name, where it has one. */
  stage_title: string | null;
  /** 'advanced': won, another stage follows. 'completed': won the last stage. 'lost': the stage is played again. */
  outcome: 'advanced' | 'completed' | 'lost';
  /** The era the next stage is set in, after 'advanced'. */
  next_era: string | null;
  /** The stage's closing text for this outcome; null where none is written. */
  outro_text: string | null;
  /** The path's signature carry before and after this result; null with no path. */
  carry: { label: string; before: number; after: number } | null;
  /** What the campaign now carries into its next stage, in words; empty once it is completed. */
  carry_effects: CampaignCarryEffect[];
}

export function buildCampaignGameResult(input: {
  campaignId: string;
  pathId: string | null;
  /** Zero-based index of the stage just played. */
  eraIndex: number;
  /** The side the campaign took, on a path that offers one. */
  lineId?: string | null;
  /** Times this stage has now been lost, this result included. */
  stageLosses?: number;
  /** The campaign's eras, in order. */
  eras: readonly string[];
  won: boolean;
  carryBefore: Record<string, number>;
  carryAfter: Record<string, number>;
  /** `prestige_points` after this result, what the next stage's combat reads. */
  prestigeAfter: number;
}): CampaignGameResult {
  const path = input.pathId ? CAMPAIGN_PATHS[input.pathId as PathId] ?? null : null;
  const stageConfig = path ? getPathEraConfig(path.path_id, input.eraIndex, input.lineId) : null;
  const isLast = input.eraIndex + 1 >= input.eras.length;
  const outcome = !input.won ? 'lost' : isLast ? 'completed' : 'advanced';
  return {
    campaign_id: input.campaignId,
    path_id: path ? path.path_id : null,
    path_name: path?.name ?? 'Classic Campaign',
    stage: input.eraIndex + 1,
    stage_count: input.eras.length,
    stage_title: stageConfig?.title ?? null,
    outcome,
    next_era: outcome === 'advanced' ? input.eras[input.eraIndex + 1] ?? null : null,
    outro_text: stageConfig ? (input.won ? stageConfig.outro_win_text : stageConfig.outro_loss_text) : null,
    carry: path
      ? {
          label: path.signature_carry_label,
          before: input.carryBefore[path.signature_carry_key] ?? 0,
          after: input.carryAfter[path.signature_carry_key] ?? 0,
        }
      : null,
    carry_effects: outcome === 'completed'
      ? []
      : describeCampaignCarry({
          prestigePoints: input.prestigeAfter,
          carry: input.carryAfter,
          // After a loss, what the next attempt at this stage opens with.
          stageLosses: outcome === 'lost' ? input.stageLosses : 0,
        }),
  };
}
