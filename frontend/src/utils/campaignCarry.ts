/**
 * What a campaign's carried stats do in a stage, as the server describes them
 * (backend modules/campaign/campaignCarryEffects.ts). The screens show these
 * lines and not the stored numbers, which run past what the game applies.
 */
export interface CampaignCarryEffect {
  key: string;
  label: string;
  /** The effect, e.g. "+2 attack dice in rounds 1–3". */
  text: string;
  /** The last round the effect applies in; absent when it lasts the stage. */
  until_round?: number;
}

/** "Prestige: +2 attack dice in rounds 1–3". */
export function carryEffectLine(effect: CampaignCarryEffect): string {
  return `${effect.label}: ${effect.text}`;
}

/** The effects still in force in a round: one that ran out is no longer shown as active. */
export function activeCarryEffects(effects: readonly CampaignCarryEffect[] | null | undefined, round: number): CampaignCarryEffect[] {
  return (effects ?? []).filter((e) => e.until_round == null || round <= e.until_round);
}
