import { carryEffectLine, type CampaignCarryEffect } from './campaignCarry';

/**
 * What a campaign stage's result means for the campaign, as `game:over` sends
 * it (backend modules/campaign/campaignResult.ts). The result screen shows the
 * stage's closing text and what was carried forward, and its main button goes
 * where the campaign goes next.
 */
export interface CampaignGameResult {
  campaign_id: string;
  path_id: string | null;
  path_name: string;
  stage: number;
  stage_count: number;
  outcome: 'advanced' | 'completed' | 'lost';
  next_era: string | null;
  outro_text: string | null;
  carry: { label: string; before: number; after: number } | null;
  /** What the campaign now carries into its next stage, in words. Absent from an older server. */
  carry_effects?: CampaignCarryEffect[];
}

/** The main button on a campaign stage's results. */
export function campaignResultButtonLabel(result: Pick<CampaignGameResult, 'outcome'>, nextEraLabel?: string | null): string {
  if (result.outcome === 'lost') return 'Try again';
  if (result.outcome === 'completed') return 'See your campaign';
  return nextEraLabel ? `Next era: ${nextEraLabel}` : 'Next era';
}

/** "Era 2 of 6" for the result's stage. */
export function campaignStageLine(result: Pick<CampaignGameResult, 'stage' | 'stage_count'>): string {
  return `Era ${result.stage} of ${result.stage_count}`;
}

/**
 * What the result screen says is carried on: the effect each stat will have in
 * the next stage, as the server words it. From a server that sends no effects,
 * the stat's name alone when it grew, since its number is not what the game
 * applies. Empty with nothing carried.
 */
export function campaignCarryLines(result: Pick<CampaignGameResult, 'carry' | 'carry_effects' | 'outcome'>): string[] {
  if (result.outcome === 'completed') return [];
  if (result.carry_effects) return result.carry_effects.map(carryEffectLine);
  const c = result.carry;
  return c && c.after > c.before ? [`${c.label} earned`] : [];
}
