/**
 * What a player is wearing: one cosmetic per slot, or null.
 *
 * Banners used to share `equipped_frame` with frames, so wearing a banner took
 * the frame off. Migration 045 gave them `equipped_banner`. A banner in the
 * frame slot counts as the banner (and no frame) until its owner next equips
 * something. Every reader goes through `effectiveLoadout` so the profile, the
 * store and matches agree on what a player is wearing.
 *
 * Only the old equip route, removed with the old store page, put a banner in
 * the frame slot, and the equip route moves any it finds out of it. So a
 * banner still in the frame slot was chosen after anything in
 * `equipped_banner`, and wins.
 */
export interface Loadout {
  frame: string | null;
  banner: string | null;
  marker: string | null;
  dice: string | null;
}

/** The columns `effectiveLoadout` reads; select them with `loadoutColumns`. */
export interface LoadoutRow {
  equipped_frame: string | null;
  /** The catalog type of `equipped_frame`: tells a legacy banner from a frame. */
  equipped_frame_type: string | null;
  equipped_banner: string | null;
  equipped_marker: string | null;
  equipped_dice: string | null;
}

/** SQL select list for a `LoadoutRow`, from the users table aliased `alias`. */
export function loadoutColumns(alias: string): string {
  return `${alias}.equipped_frame, ${alias}.equipped_banner, ${alias}.equipped_marker, ${alias}.equipped_dice,
          (SELECT fc.type FROM cosmetics fc WHERE fc.cosmetic_id = ${alias}.equipped_frame) AS equipped_frame_type`;
}

export function effectiveLoadout(row: LoadoutRow): Loadout {
  const legacyBanner = row.equipped_frame_type === 'profile_banner' ? row.equipped_frame : null;
  return {
    frame: legacyBanner ? null : row.equipped_frame,
    banner: legacyBanner ?? row.equipped_banner,
    marker: row.equipped_marker,
    dice: row.equipped_dice,
  };
}
