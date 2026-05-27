import { isFullScreenStrikeAbility } from './mapStrikeEffects';

export function shouldShowFullScreenStrike(options: {
  abilityId: string;
  prefersReducedMotion: boolean;
  liteMode?: boolean;
}): boolean {
  if (!isFullScreenStrikeAbility(options.abilityId)) return false;
  if (options.prefersReducedMotion) return false;
  if (options.liteMode) return false;
  return true;
}
