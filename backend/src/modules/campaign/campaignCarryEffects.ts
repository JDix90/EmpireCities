import {
  CAMPAIGN_PRESTIGE_DICE_CAP,
  CAMPAIGN_PRESTIGE_TURNS,
  CAMPAIGN_SURVIVOR_DICE_CAP,
} from '../../game-engine/combat/combatModifiers';
import {
  CAMPAIGN_SPIRIT_PER_REINFORCEMENT,
  CAMPAIGN_SPIRIT_REINFORCE_CAP,
} from '../../game-engine/state/techManager';

/**
 * What a campaign's carried stats do in the next stage, in words.
 *
 * A carry was shown as its stored number ("Prestige: 6 / 12"), and that number
 * is not what the engine applies: combat honours at most two dice of Prestige
 * or Survivor Bonus, and Revolutionary Spirit pays one reinforcement per two
 * points up to two. So the screens show the effect, built here from the same
 * constants the engine reads, and a number that does nothing is never shown.
 */
export interface CampaignCarryEffect {
  key: 'prestige' | 'survivor' | 'spirit';
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
}): CampaignCarryEffect[] {
  const out: CampaignCarryEffect[] = [];
  const prestige = Math.min(Math.max(0, Math.floor(input.prestigePoints ?? 0)), CAMPAIGN_PRESTIGE_DICE_CAP);
  if (prestige > 0) {
    out.push({
      key: 'prestige',
      label: 'Prestige',
      text: `+${dice(prestige).replace(/^(\d+) /, '$1 attack ')} in rounds 1–${CAMPAIGN_PRESTIGE_TURNS}`,
      until_round: CAMPAIGN_PRESTIGE_TURNS,
    });
  }
  const survivor = Math.min(Math.max(0, Math.floor(input.carry?.survivor_bonus ?? 0)), CAMPAIGN_SURVIVOR_DICE_CAP);
  if (survivor > 0) {
    out.push({
      key: 'survivor',
      label: 'Survivor Bonus',
      text: `+${dice(survivor).replace(/^(\d+) /, '$1 defense ')} on your home ground`,
    });
  }
  const spirit = Math.min(
    Math.floor(Math.max(0, input.carry?.revolutionary_spirit ?? 0) / CAMPAIGN_SPIRIT_PER_REINFORCEMENT),
    CAMPAIGN_SPIRIT_REINFORCE_CAP,
  );
  if (spirit > 0) {
    out.push({
      key: 'spirit',
      label: 'Revolutionary Spirit',
      text: `+${spirit} ${spirit === 1 ? 'reinforcement' : 'reinforcements'} every turn`,
    });
  }
  return out;
}
