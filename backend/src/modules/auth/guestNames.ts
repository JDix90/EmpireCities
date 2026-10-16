import { randomInt } from 'crypto';
import { isDisallowedUsername } from '../../utils/profanity';

/**
 * Friendly guest names (`friendly_guest_names_enabled`): "SwiftFalcon_48213"
 * instead of "Guest_" and 8 hex characters. It is the name other players see in
 * turn order, battles and results, so it should read as a name.
 *
 * 30 adjectives x 30 animals x 100,000 numbers is 90 million names. The guest
 * route inserts with ON CONFLICT and retries, so a collision costs one retry,
 * as it did with the hex names. Every name is a valid username (letters,
 * digits and an underscore, at most 32 characters), so a guest who signs up
 * could keep it.
 */
export const GUEST_ADJECTIVES = [
  'Swift', 'Bold', 'Iron', 'Silent', 'Golden', 'Crimson', 'Northern', 'Steady',
  'Clever', 'Brave', 'Quiet', 'Bright', 'Stone', 'Storm', 'Amber', 'Silver',
  'Rapid', 'Lone', 'Proud', 'Wise', 'Keen', 'Hardy', 'Royal', 'Wild',
  'Calm', 'Fierce', 'Noble', 'Stout', 'Eager', 'Gallant',
] as const;

export const GUEST_ANIMALS = [
  'Falcon', 'Wolf', 'Lion', 'Bear', 'Hawk', 'Fox', 'Stag', 'Raven',
  'Eagle', 'Tiger', 'Bison', 'Otter', 'Lynx', 'Heron', 'Badger', 'Boar',
  'Kestrel', 'Mustang', 'Panther', 'Owl', 'Jaguar', 'Condor', 'Moose', 'Ram',
  'Puma', 'Crane', 'Gryphon', 'Mammoth', 'Orca', 'Ibex',
] as const;

/** One draw: an adjective, an animal and five digits (leading zeros kept). */
function draw(pick: (n: number) => number): string {
  const adjective = GUEST_ADJECTIVES[pick(GUEST_ADJECTIVES.length)];
  const animal = GUEST_ANIMALS[pick(GUEST_ANIMALS.length)];
  const number = String(pick(100_000)).padStart(5, '0');
  return `${adjective}${animal}_${number}`;
}

/**
 * A friendly guest name. The username filter matches substrings after reading
 * digits as letters (5 as s, 4 as a), so a word and its number can spell
 * something it refuses; such a draw is redrawn.
 */
export function friendlyGuestName(pick: (n: number) => number = randomInt): string {
  for (let i = 0; i < 20; i++) {
    const name = draw(pick);
    if (!isDisallowedUsername(name)) return name;
  }
  // Twenty refused draws in a row would mean the lists themselves are broken.
  throw new Error('friendlyGuestName: no allowed name in 20 draws');
}
