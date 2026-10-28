/** Era / map ids for the in-development Galactic Age (lobby + API gated). */
export const GALACTIC_AGE_ERA_ID = 'galaxy_age';

type AccessUser = { is_admin?: boolean; is_guest?: boolean } | null | undefined;

function isAdmin(user: AccessUser): boolean {
  return !!user && user.is_admin === true && user.is_guest !== true;
}

/**
 * Whether this player may pick the Galactic Age: an admin always, and every
 * signed-in player, guests included, while the open beta is on
 * (`galaxy_age_beta_enabled`). The server enforces the same rule.
 */
export function canAccessGalacticAge(user: AccessUser, betaEnabled = false): boolean {
  return isAdmin(user) || (!!user && betaEnabled);
}

/**
 * Space to Stars, the board that climbs from the Space Age into the galaxy,
 * stays admin-only while the Galactic Age itself is in beta.
 */
export function canAccessSpaceToStars(user: AccessUser): boolean {
  return isAdmin(user);
}

/** The era's name where players pick it: in beta, or not yet open. */
export function galacticAgeLabel(betaEnabled: boolean): string {
  return betaEnabled ? 'Galactic Age · Beta' : 'Galactic Age — Coming Soon';
}

/**
 * A label for an era or its board, with the Galactic Age's swapped for its
 * current state: the lists that name every era carry the "Coming Soon" form.
 */
export function withGalacticAgeLabel(eraOrMapId: string, label: string, betaEnabled: boolean): string {
  return eraOrMapId === GALACTIC_AGE_ERA_ID || eraOrMapId === 'era_galaxy' ? galacticAgeLabel(betaEnabled) : label;
}

/** A Galactic Age game: its era, or the galaxy board under another era id. Mirrors backend lobbyCapacity.ts. */
export function isGalacticAgeGame(eraId: string | null | undefined, mapId: string | null | undefined): boolean {
  return eraId === GALACTIC_AGE_ERA_ID || mapId === 'era_galaxy';
}
