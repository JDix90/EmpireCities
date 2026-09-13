import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPLAY_VERSION, replayHash, type Replay } from './sim';
import { TerrainGrid, type TerrainAsset } from './terrain';

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
  /** Repo-relative path of a committed terrain asset the replay runs on (optional). */
  terrain?: string;
  replay: Replay;
}

const GOLDEN_DIR = join(__dirname, '..', 'golden');
const REPO_ROOT = join(__dirname, '..', '..', '..');
const UPDATE = process.env.WARFRONT_GOLDEN_UPDATE === '1';

const fixtures = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as GoldenFixture }));

const grids = new Map<string, TerrainGrid>();
function loadTerrain(path: string): TerrainGrid {
  let grid = grids.get(path);
  if (!grid) {
    grid = TerrainGrid.decode(JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as TerrainAsset);
    grids.set(path, grid);
  }
  return grid;
}

describe('golden replays', () => {
  it('has at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const { file, fixture } of fixtures) {
    it(`${fixture.name} (${file}) hashes to ${fixture.expectedHash}`, () => {
      const terrain = fixture.terrain ? loadTerrain(fixture.terrain) : null;
      const replay: Replay = { ...fixture.replay };
      if (terrain && UPDATE) replay.terrain_checksum = terrain.checksum();
      // Carry the fixture across a deliberate REPLAY_VERSION bump, the same way the
      // terrain checksum is carried. Without this the updater cannot do the one job it
      // exists for: `replayHash` refuses an older version outright, so a hashed-state
      // change fails every fixture AND fails to regenerate any of them, and the only way
      // through is editing seven JSON files by hand.
      //
      // Safe only because the bump guards the shape of the HASHED STATE, not the shape of
      // the stored replay — a seed, a scenario and a command log, none of which this
      // change touches. A future version that alters the replay's own shape cannot be
      // migrated like this: those fixtures have to be re-recorded, and this line would be
      // quietly wrong about it.
      if (UPDATE) replay.version = REPLAY_VERSION;
      const first = replayHash(replay, fixture.ticks, terrain);
      const second = replayHash(replay, fixture.ticks, terrain);
      expect(second).toBe(first);
      const changed =
        first !== fixture.expectedHash ||
        replay.terrain_checksum !== fixture.replay.terrain_checksum ||
        replay.version !== fixture.replay.version;
      if (UPDATE && changed) {
        writeFileSync(
          join(GOLDEN_DIR, file),
          JSON.stringify({ ...fixture, expectedHash: first, replay }, null, 2) + '\n',
        );
        console.log(`[golden] ${file}: ${fixture.expectedHash} -> ${first}`);
      }
      expect(first).toBe(UPDATE ? first : fixture.expectedHash);
    });
  }
});
