/**
 * Seeded engine randomness for the balance harnesses.
 *
 * The engine draws from node's CSPRNG wherever live play must be
 * unpredictable to clients: the stability tick (population growth and
 * rebellions), the territory-card deck, the mission salt, the event deck, a
 * Schism deal, the faction shuffle. A harness seeds its dice and its AI jitter,
 * but every one of those draws stayed unseeded, so two runs of one
 * configuration on one seed were not the same run: the galaxy control drifted
 * in PP banked (population feeds production), and once powers spent that PP,
 * whole games diverged.
 *
 * A harness owns its process, so it can swap the three `crypto` functions the
 * engine calls for one seeded generator, reseeded at the start of every game.
 * That makes every draw above repeatable, and any added later, without a line
 * of the live game changing: the engine still imports `randomInt` from
 * 'crypto', and only this process answers it from a seed. The engine's modules
 * resolve `crypto.randomInt` at call time (CommonJS), so the swap reaches them
 * after they have loaded.
 *
 * The one draw it cannot reach is a library that captured its own reference at
 * load, which is how `uuid` builds territory-card ids; the harness renames
 * those with `seededUuid` after each game starts (the engine picks a card set
 * by sorting on card id, so the ids are not cosmetic).
 *
 * Never import this from `src/`: a live server must keep its CSPRNG.
 */

import crypto from 'crypto';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

let rng: () => number = createSeededRng(hashStringToSeed('seededEngineRandomness:unseeded'));
let installed = false;

/** A uniform fraction in [0, 1) with 53 bits, from two 32-bit draws. */
function fraction(): number {
  const high = Math.floor(rng() * 0x200000); // 21 bits
  const low = Math.floor(rng() * 0x100000000); // 32 bits
  return (high * 0x100000000 + low) / 2 ** 53;
}

/** `crypto.randomInt`'s contract: [min, max), integers, `max` alone meaning min 0. */
function seededInt(a: number, b?: number): number {
  const [min, max] = b === undefined ? [0, a] : [a, b];
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) {
    throw new RangeError(`seeded randomInt: bad range [${min}, ${max})`);
  }
  return min + Math.floor(fraction() * (max - min));
}

function seededBytes(size: number): Buffer {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

/** A v4-shaped UUID from the seeded stream. */
export function seededUuid(): string {
  const b = seededBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Callback<T> = (err: Error | null, value: T) => void;

function install(): void {
  const target = crypto as unknown as Record<string, unknown>;
  // Each keeps crypto's call shapes, including the rarely used callback form.
  target.randomInt = (a: number, b?: number | Callback<number>, c?: Callback<number>): number | undefined => {
    const cb = typeof b === 'function' ? b : c;
    const value = seededInt(a, typeof b === 'function' ? undefined : b);
    if (!cb) return value;
    process.nextTick(cb, null, value);
    return undefined;
  };
  target.randomBytes = (size: number, cb?: Callback<Buffer>): Buffer | undefined => {
    const value = seededBytes(size);
    if (!cb) return value;
    process.nextTick(cb, null, value);
    return undefined;
  };
  target.randomUUID = (): string => seededUuid();
  installed = true;
}

/**
 * Answer the engine's `crypto` draws from a generator seeded with `seed`, from
 * now until the next call. Call it at the start of every game with a seed that
 * names the game, so one game's draws never shift another's.
 */
export function seedEngineRandomness(seed: string): void {
  rng = createSeededRng(hashStringToSeed(seed));
  if (!installed) install();
}
