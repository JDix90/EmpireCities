import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayHash, type Replay } from './sim';

/**
 * Golden replays: each fixture is a seed, a scenario, a command log, a tick count and
 * the hash the final state must have. The regression net for everything that follows —
 * any change to the sim that alters a hash is a replay-format break and must be
 * deliberate. Regenerate on purpose with `pnpm run golden:update` and explain the
 * change in the PR.
 *
 * Each replay is run twice from scratch in the same process: a hash that matches the
 * fixture but not its own re-run is exactly the class of bug this file exists to catch.
 */
interface GoldenFixture {
  name: string;
  ticks: number;
  expectedHash: string;
  replay: Replay;
}

const GOLDEN_DIR = join(__dirname, '..', 'golden');
const UPDATE = process.env.WARFRONT_GOLDEN_UPDATE === '1';

const fixtures = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as GoldenFixture }));

describe('golden replays', () => {
  it('has at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const { file, fixture } of fixtures) {
    it(`${fixture.name} (${file}) hashes to ${fixture.expectedHash}`, () => {
      const first = replayHash(fixture.replay, fixture.ticks);
      const second = replayHash(fixture.replay, fixture.ticks);
      expect(second).toBe(first);
      if (UPDATE && first !== fixture.expectedHash) {
        writeFileSync(
          join(GOLDEN_DIR, file),
          JSON.stringify({ ...fixture, expectedHash: first }, null, 2) + '\n',
        );
        console.log(`[golden] ${file}: ${fixture.expectedHash} -> ${first}`);
      }
      expect(first).toBe(UPDATE ? first : fixture.expectedHash);
    });
  }
});
