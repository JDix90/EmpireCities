export interface StrikeAnimationEvent {
  abilityId: string;
  attackerId: string;
  attackerName: string;
  attackerColor: string;
  territoryId: string;
  targetOwnerId: string | null;
  targetOwnerName: string | null;
  unitReduction?: number;
}

export interface StrikeViewerContext {
  userId?: string | null;
  username?: string | null;
  resolvedPlayerId?: string | null;
}

function isAttacker(event: StrikeAnimationEvent, viewer: StrikeViewerContext): boolean {
  if (viewer.resolvedPlayerId) return event.attackerId === viewer.resolvedPlayerId;
  if (viewer.userId) return event.attackerId === viewer.userId;
  return !!viewer.username && event.attackerName === viewer.username;
}

function isVictim(event: StrikeAnimationEvent, viewer: StrikeViewerContext): boolean {
  if (!event.targetOwnerId) return false;
  if (viewer.resolvedPlayerId) return event.targetOwnerId === viewer.resolvedPlayerId;
  if (viewer.userId) return event.targetOwnerId === viewer.userId;
  return !!viewer.username && !!event.targetOwnerName && event.targetOwnerName === viewer.username;
}

function unitReductionStrikeToast(
  event: StrikeAnimationEvent,
  targetName: string,
  viewer: StrikeViewerContext,
  config: { emoji: string; label: string; defaultLoss: number },
): string {
  const loss = event.unitReduction ?? config.defaultLoss;
  const attacker = event.attackerName;
  const victim = event.targetOwnerName;
  if (isAttacker(event, viewer)) {
    return `${config.emoji} Your ${config.label} hit ${targetName} (−${loss} unit${loss === 1 ? '' : 's'}).`;
  }
  if (isVictim(event, viewer)) {
    return `${config.emoji} ${attacker} ${config.label} on your territory ${targetName} (−${loss} unit${loss === 1 ? '' : 's'})!`;
  }
  return `${config.emoji} ${attacker} ${config.label} on ${targetName}${victim ? ` (${victim})` : ''} (−${loss} unit${loss === 1 ? '' : 's'}).`;
}

function unitReductionCombatLog(
  event: StrikeAnimationEvent,
  targetName: string,
  config: { emoji: string; label: string; defaultLoss: number },
): string {
  const loss = event.unitReduction ?? config.defaultLoss;
  const victimSuffix = event.targetOwnerName ? ` (${event.targetOwnerName})` : '';
  return `${config.emoji} ${event.attackerName} ${config.label} on ${targetName}${victimSuffix} — ${loss} unit${loss === 1 ? '' : 's'} lost`;
}

export function getStrikeToastMessage(
  event: StrikeAnimationEvent,
  targetName: string,
  viewer: StrikeViewerContext,
): string {
  const attacker = event.attackerName;
  const victim = event.targetOwnerName;

  if (event.abilityId === 'atom_bomb') {
    if (isAttacker(event, viewer)) {
      return `☢️ You dropped the Atom Bomb on ${targetName}!`;
    }
    if (isVictim(event, viewer)) {
      return `☢️ ${attacker} dropped the Atom Bomb on your territory ${targetName}!`;
    }
    return `☢️ ${attacker} dropped the Atom Bomb on ${targetName}${victim ? ` (${victim})` : ''}!`;
  }

  const toastByAbility: Record<string, { emoji: string; label: string; defaultLoss: number }> = {
    nuclear_strike: { emoji: '☢️', label: 'nuclear strike', defaultLoss: 2 },
    orbital_strike: { emoji: '🛰️', label: 'orbital strike', defaultLoss: 3 },
    hypersonic_strike: { emoji: '🚀', label: 'hypersonic strike', defaultLoss: 2 },
    cyber_attack: { emoji: '💻', label: 'cyber attack', defaultLoss: 1 },
    data_breach: { emoji: '🖥️', label: 'data breach', defaultLoss: 1 },
    swarm_strike: { emoji: '🐝', label: 'swarm strike', defaultLoss: 2 },
    dyson_beam: { emoji: '☀️', label: 'Dyson beam', defaultLoss: 4 },
    river_blockade: { emoji: '⚓', label: 'river blockade', defaultLoss: 1 },
    air_strike: { emoji: '✈️', label: 'air strike', defaultLoss: 1 },
  };

  const cfg = toastByAbility[event.abilityId];
  if (cfg) {
    return unitReductionStrikeToast(event, targetName, viewer, cfg);
  }

  return `☢️ ${attacker} used ${event.abilityId.replace(/_/g, ' ')} on ${targetName}.`;
}

export function getStrikeCombatLogLine(event: StrikeAnimationEvent, targetName: string): string {
  if (event.abilityId === 'atom_bomb') {
    return `☢️ ${event.attackerName} atom-bombed ${targetName} — all units eliminated`;
  }

  const logByAbility: Record<string, { emoji: string; label: string; defaultLoss: number }> = {
    nuclear_strike: { emoji: '☢️', label: 'nuclear strike', defaultLoss: 2 },
    orbital_strike: { emoji: '🛰️', label: 'orbital strike', defaultLoss: 3 },
    hypersonic_strike: { emoji: '🚀', label: 'hypersonic strike', defaultLoss: 2 },
    cyber_attack: { emoji: '💻', label: 'cyber attack', defaultLoss: 1 },
    data_breach: { emoji: '🖥️', label: 'data breach', defaultLoss: 1 },
    swarm_strike: { emoji: '🐝', label: 'swarm strike', defaultLoss: 2 },
    dyson_beam: { emoji: '☀️', label: 'Dyson beam', defaultLoss: 4 },
    river_blockade: { emoji: '⚓', label: 'river blockade', defaultLoss: 1 },
    air_strike: { emoji: '✈️', label: 'air strike', defaultLoss: 1 },
  };

  const cfg = logByAbility[event.abilityId];
  if (cfg) {
    return unitReductionCombatLog(event, targetName, cfg);
  }

  return `☢️ ${event.attackerName} struck ${targetName}`;
}
