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

  if (event.abilityId === 'nuclear_strike') {
    const loss = event.unitReduction ?? 2;
    if (isAttacker(event, viewer)) {
      return `☢️ Your nuclear strike hit ${targetName} (−${loss} units).`;
    }
    if (isVictim(event, viewer)) {
      return `☢️ ${attacker} launched a nuclear strike on your territory ${targetName} (−${loss} units)!`;
    }
    return `☢️ ${attacker} launched a nuclear strike on ${targetName}${victim ? ` (${victim})` : ''} (−${loss} units).`;
  }

  return `☢️ ${attacker} used ${event.abilityId.replace(/_/g, ' ')} on ${targetName}.`;
}

export function getStrikeCombatLogLine(event: StrikeAnimationEvent, targetName: string): string {
  if (event.abilityId === 'atom_bomb') {
    return `☢️ ${event.attackerName} atom-bombed ${targetName} — all units eliminated`;
  }
  if (event.abilityId === 'nuclear_strike') {
    const loss = event.unitReduction ?? 2;
    const victimSuffix = event.targetOwnerName ? ` (${event.targetOwnerName})` : '';
    return `☢️ ${event.attackerName} nuclear strike on ${targetName}${victimSuffix} — ${loss} units lost`;
  }
  return `☢️ ${event.attackerName} struck ${targetName}`;
}
