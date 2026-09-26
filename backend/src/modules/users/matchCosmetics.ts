import type { PlayerCosmetics } from '@borderfall/shared';
import { query } from '../../db/postgres';
import { featureFlags } from '../../config/featureFlags';
import { effectiveLoadout, loadoutColumns, type Loadout, type LoadoutRow } from './loadout';

/** The slots a loadout fills, or undefined when it fills none. */
export function playerCosmetics(loadout: Loadout): PlayerCosmetics | undefined {
  const worn: PlayerCosmetics = {};
  if (loadout.frame) worn.frame = loadout.frame;
  if (loadout.banner) worn.banner = loadout.banner;
  if (loadout.marker) worn.marker = loadout.marker;
  if (loadout.dice) worn.dice = loadout.dice;
  return Object.keys(worn).length > 0 ? worn : undefined;
}

/**
 * What each of these players wears into a match, by user id, for the game to
 * snapshot at its start. Empty with store_v2_enabled off (no query at all), for
 * players wearing nothing, and if the read fails: cosmetics never stop a game
 * from starting.
 */
export async function loadMatchCosmetics(userIds: string[]): Promise<Map<string, PlayerCosmetics>> {
  const byUser = new Map<string, PlayerCosmetics>();
  if (!featureFlags.storeV2Enabled || userIds.length === 0) return byUser;
  try {
    const rows = await query<LoadoutRow & { user_id: string }>(
      `SELECT u.user_id, ${loadoutColumns('u')} FROM users u WHERE u.user_id = ANY($1)`,
      [userIds],
    );
    for (const row of rows) {
      const worn = playerCosmetics(effectiveLoadout(row));
      if (worn) byUser.set(row.user_id, worn);
    }
  } catch (err) {
    console.warn('[cosmetics] Could not read loadouts; the match starts without them', err);
  }
  return byUser;
}
