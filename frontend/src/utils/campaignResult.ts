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

/** The carry line: what was gained, or what is held; null with no path or nothing held. */
export function campaignCarryLine(result: Pick<CampaignGameResult, 'carry'>): string | null {
  const c = result.carry;
  if (!c) return null;
  if (c.after > c.before) return `${c.label} +${c.after - c.before} (now ${c.after})`;
  return c.after > 0 ? `${c.label}: ${c.after}` : null;
}
