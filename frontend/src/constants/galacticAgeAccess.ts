/** Era / map ids for the in-development Galactic Age (lobby + API gated). */
export const GALACTIC_AGE_ERA_ID = 'galaxy_age';
export const GALACTIC_AGE_MAP_ID = 'era_galaxy';

export function canAccessGalacticAge(user: { is_admin?: boolean; is_guest?: boolean } | null | undefined): boolean {
  return !!user && user.is_admin === true && user.is_guest !== true;
}
