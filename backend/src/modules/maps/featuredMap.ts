/**
 * The map of the week: one approved community map, the same for everyone all
 * week, drawn from the best-rated so the slot is a reward, and rotating by
 * the week number so a good map is not the slot forever.
 */

import { hashStringToSeed } from '../../game-engine/victory/missions';

export interface FeaturedCandidate {
  map_id: string;
  rating: number;
  rating_count: number;
  play_count: number;
  created_at: Date | string;
}

/** How many of the best-rated maps the week's pick rotates among. */
export const FEATURED_POOL_SIZE = 10;

/** The ISO week a date falls in, as "2026-W45" (UTC). */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday of this week decides the year the week belongs to.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Best first: rating, then plays, then the older map; ids break the last tie. */
export function rankFeaturedCandidates<T extends FeaturedCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) =>
    b.rating - a.rating
    || b.play_count - a.play_count
    || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    || a.map_id.localeCompare(b.map_id),
  );
}

/**
 * The week's pick: a fixed slot in the ranked top FEATURED_POOL_SIZE, chosen
 * by the week key, so the same week always names the same map (until the
 * ranking itself moves). Null with nothing approved.
 */
export function pickFeaturedMap<T extends FeaturedCandidate>(candidates: T[], weekKey: string): T | null {
  const pool = rankFeaturedCandidates(candidates).slice(0, FEATURED_POOL_SIZE);
  if (pool.length === 0) return null;
  return pool[hashStringToSeed(weekKey) % pool.length] ?? null;
}
