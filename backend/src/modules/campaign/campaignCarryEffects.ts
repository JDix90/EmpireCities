import {
  campaignPrestigeDice,
  campaignRetryUnits,
  campaignPrestigeRounds,
  campaignSpiritReinforcements,
  campaignSurvivorDice,
} from '../../game-engine/campaign/carryLadder';

/**
 * What a campaign's carried stats do in the next stage, in words.
 *
 * A carry was shown as its stored number ("Prestige: 6 / 12"), and that number
 * is not what the engine applies: each carry is a short ladder of dice, rounds
 * or reinforcements (game-engine/campaign/carryLadder.ts). So the screens show
 * the effect, built here from the same functions the engine reads, and a
 * number that does nothing is never shown.
 */
export interface CampaignCarryEffect {
  key: 'prestige' | 'survivor' | 'spirit' | 'retry';
  label: string;
  /** The effect, e.g. "+2 attack dice in rounds 1–3". */
  text: string;
  /** The last round the effect applies in; absent when it lasts the stage. */
  until_round?: number;
}

const dice = (n: number) => `${n} ${n === 1 ? 'die' : 'dice'}`;

export function describeCampaignCarry(input: {
  /** `user_campaigns.prestige_points`, what combat reads as Prestige. */
  prestigePoints: number | null | undefined;
  carry: { survivor_bonus?: number; revolutionary_spirit?: number } | null | undefined;
  /** Times the stage about to be played has been lost: what trying again adds. */
  stageLosses?: number | null;
}): CampaignCarryEffect[] {
  const out: CampaignCarryEffect[] = [];
  const prestige = campaignPrestigeDice(input.prestigePoints);
  if (prestige > 0) {
    const rounds = campaignPrestigeRounds(input.prestigePoints);
    out.push({
      key: 'prestige',
      label: 'Prestige',
      text: `+${dice(prestige).replace(/^(\d+) /, '$1 attack ')} in rounds 1–${rounds}`,
      until_round: rounds,
    });
  }
  const survivor = campaignSurvivorDice(input.carry?.survivor_bonus);
  if (survivor > 0) {
    out.push({
      key: 'survivor',
      label: 'Survivor Bonus',
      text: `+${dice(survivor).replace(/^(\d+) /, '$1 defense ')} on your home ground`,
    });
  }
  const spirit = campaignSpiritReinforcements(input.carry?.revolutionary_spirit);
  if (spirit > 0) {
    out.push({
      key: 'spirit',
      label: 'Revolutionary Spirit',
      text: `+${spirit} ${spirit === 1 ? 'reinforcement' : 'reinforcements'} every turn`,
    });
  }
  // Not a carry: it belongs to this stage, and is listed last.
  const retry = campaignRetryUnits(input.stageLosses);
  if (retry > 0) {
    out.push({
      key: 'retry',
      label: 'Trying again',
      text: `+${retry} starting ${retry === 1 ? 'unit' : 'units'} on this era`,
      // Placed at the deal: said in the intro, and not a standing effect on the HUD.
      until_round: 1,
    });
  }
  return out;
}
