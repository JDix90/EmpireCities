/**
 * The phone's overlay budget (docs/MOBILE_UX_PLAN.md M-12).
 *
 * On a phone the map is the whole screen, so what may float over it is
 * decided in one place: the turn strip carries what the player needs to
 * glance at, the map animates only what the player did themselves, and a
 * lost territory is named and pulsed rather than shown by covering the map.
 * These are the pure rules; `MobileTurnStrip` and `GamePage` apply them.
 */
import type { CombatResult } from '../store/gameStore';
import type { MapVisualEvent, MapVisualKind } from './mapVisualEvents';
import type { TurnRecapEntry } from '../components/game/AiTurnRecapPanel';

/** Whether the viewer was on either side of the exchange. */
export function combatInvolves(result: CombatResult | null | undefined, viewerId: string | null | undefined): boolean {
  if (!result || !viewerId) return false;
  return result.attackerId === viewerId || result.defenderId === viewerId;
}

/**
 * Visuals about the board rather than about one player's move. They play on
 * every client, whoever's turn it is: an era advancing or a frontier opening
 * is news to everyone, and an event card has its own modal to match.
 */
export const BOARD_LEVEL_VISUALS: ReadonlySet<MapVisualKind> = new Set<MapVisualKind>([
  'era_advance',
  'frontier_unlock',
  'board_transform',
  'event',
]);

/**
 * Whether a map visual plays on a phone. The viewer's own moves do, and so
 * does anything board-level; another player's attack, reinforcement, fortify,
 * strike, naval move or influence does not. The board still updates from
 * state the moment it happens, and the strip says what happened.
 */
export function keepsMapVisualOnPhone(ev: MapVisualEvent, viewerId: string | null | undefined): boolean {
  if (ev.global || BOARD_LEVEL_VISUALS.has(ev.kind)) return true;
  return !!viewerId && ev.playerId === viewerId;
}

export interface RecapSummary {
  turns: number;
  battles: number;
  captures: number;
  /** Battles in which the viewer defended. */
  attacksOnViewer: number;
  /** Territories the viewer lost, in the order they fell, each named once. */
  lost: Array<{ id: string | null; name: string }>;
}

/** What the strip says about the turns the viewer sat through. */
export function summarizeRecapsForViewer(recaps: TurnRecapEntry[], viewerId: string | null | undefined): RecapSummary {
  const out: RecapSummary = { turns: recaps.length, battles: 0, captures: 0, attacksOnViewer: 0, lost: [] };
  const seenLoss = new Set<string>();
  for (const recap of recaps) {
    for (const c of recap.combats) {
      out.battles += 1;
      if (c.territory_captured) out.captures += 1;
      if (!viewerId || c.defenderId !== viewerId) continue;
      out.attacksOnViewer += 1;
      if (!c.territory_captured) continue;
      const name = c.toName ?? c.toId ?? '?';
      const key = c.toId ?? name;
      if (seenLoss.has(key)) continue;
      seenLoss.add(key);
      out.lost.push({ id: c.toId ?? null, name });
    }
  }
  return out;
}

/** The ids of the territories the viewer lost, for the map to pulse. */
export function lostTerritoryIds(recaps: TurnRecapEntry[], viewerId: string | null | undefined): string[] {
  return summarizeRecapsForViewer(recaps, viewerId).lost
    .map((l) => l.id)
    .filter((id): id is string => !!id);
}
