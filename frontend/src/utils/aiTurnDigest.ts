import type { AiTurnDigest } from '../store/gameStore';

/** Whether the bot did anything the digest reports: a tile, a region or a knockout. */
export function digestReportsAction(digest: AiTurnDigest): boolean {
  return digest.taken.length + digest.regionsTaken.length + digest.regionsBroken.length + digest.eliminated.length > 0;
}

/**
 * One line for the recap row of a bot's turn: the regions it completed or
 * broke, who it knocked out, then, if it did not just meet it, the goal it
 * is playing toward. Null when there is nothing to say. `viewerId` is the
 * player reading it, so their own losses read "your".
 */
export function describeAiTurnDigest(
  digest: AiTurnDigest,
  viewerId: string | null | undefined,
  nameOf: (playerId: string) => string,
): string | null {
  const parts: string[] = [];
  for (const r of digest.regionsTaken) parts.push(`Took ${r.name}`);
  for (const r of digest.regionsBroken) {
    parts.push(r.fromPlayerId === viewerId ? `Broke your hold on ${r.name}` : `Broke ${nameOf(r.fromPlayerId)}’s hold on ${r.name}`);
  }
  for (const id of digest.eliminated) parts.push(id === viewerId ? 'Knocked you out' : `Knocked out ${nameOf(id)}`);

  const goal = digest.goal;
  if (goal) {
    if (goal.kind === 'take_region' && !digest.regionsTaken.some((r) => r.regionId === goal.target)) {
      parts.push(`Pushing into ${goal.name}`);
    } else if (goal.kind === 'break_region' && !digest.regionsBroken.some((r) => r.regionId === goal.target)) {
      parts.push(`Going after ${goal.name}`);
    } else if (goal.kind === 'hunt' && !digest.eliminated.includes(goal.target)) {
      parts.push(goal.target === viewerId ? 'Hunting you' : `Hunting ${goal.name}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
