/**
 * The chance of taking each attack target, for the player choosing one
 * (combat_explain_enabled, socket `game:attack_odds`). The same exact odds the
 * bots plan with (ai/aiEdgeOdds.ts): the assault pressed until the garrison
 * falls or the stack drops below two, with every dice modifier the resolver
 * would apply on that edge.
 *
 * Only pairs the player could actually be asking about are priced: a source
 * they own with an army to attack with, a neighbour they don't own, and, in a
 * fog game, a target they can see. Odds for a hidden territory would leak its
 * garrison, so it gets none.
 */
import type { GameMap, GameState } from '../../types';
import { edgeCaptureOdds } from '../ai/aiEdgeOdds';
import { isJumpGateOnlyEdge } from '../state/jumpGates';

export interface AttackOddsPair {
  fromId: string;
  toId: string;
}

export interface AttackOddsEntry extends AttackOddsPair {
  /** P(capture), 0..1, to three places. */
  p: number;
}

/** A panel shows a source's neighbours plus the stacks bordering one target; this covers both. */
export const MAX_ODDS_PAIRS = 24;

const ID_MAX = 128;

/** The pairs a client asked about, kept to well-formed, distinct, bounded entries. */
export function sanitizeOddsPairs(raw: unknown): AttackOddsPair[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const pairs: AttackOddsPair[] = [];
  for (const item of raw) {
    if (pairs.length >= MAX_ODDS_PAIRS) break;
    if (!item || typeof item !== 'object') continue;
    const { fromId, toId } = item as Record<string, unknown>;
    if (typeof fromId !== 'string' || typeof toId !== 'string') continue;
    if (!fromId || !toId || fromId.length > ID_MAX || toId.length > ID_MAX) continue;
    const key = `${fromId}>${toId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ fromId, toId });
  }
  return pairs;
}

/**
 * Odds for each legal pair; pairs that are not a legal attack for `playerId`,
 * or whose target `visible` (a fog game's visibility set) leaves out, are dropped.
 */
export function attackOddsFor(
  state: GameState,
  map: GameMap,
  playerId: string,
  pairs: AttackOddsPair[],
  visible: Set<string> | null,
): AttackOddsEntry[] {
  const out: AttackOddsEntry[] = [];
  for (const { fromId, toId } of pairs) {
    const from = state.territories[fromId];
    const to = state.territories[toId];
    if (!from || !to) continue;
    if (from.owner_id !== playerId || from.unit_count < 2) continue;
    if (to.owner_id === playerId || to.unit_count < 1) continue;
    if (visible && !visible.has(toId)) continue;
    const adjacent = map.connections.some(
      (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId),
    );
    if (!adjacent || isJumpGateOnlyEdge(map, fromId, toId)) continue;
    const p = edgeCaptureOdds(state, map, playerId, fromId, toId);
    out.push({ fromId, toId, p: Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000 });
  }
  return out;
}
