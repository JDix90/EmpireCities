import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The static copies under public/maps/regional/ exist so the client can load
 * curated maps without depending on a fresh database seed (mapService prefers
 * them). That only works if they stay byte-equivalent to the canonical files
 * in database/maps/ — this guard failed to exist while era_space_age drifted
 * to a 55-territory snapshot of the 63-territory map (and 8 other maps
 * accumulated silent balance drift, e.g. divided_japan's us_zone bonus).
 *
 * If this test fails after editing database/maps/<map>.json, re-copy it:
 *   cp database/maps/<map>.json frontend/public/maps/regional/<map>.json
 */
const REGIONAL_DIR = join(__dirname, '../../public/maps/regional');
const CANONICAL_DIR = join(__dirname, '../../../database/maps');

describe('static regional map copies', () => {
  const files = readdirSync(REGIONAL_DIR).filter((f) => f.endsWith('.json'));

  it('has at least the era_space_age copy to guard', () => {
    expect(files).toContain('era_space_age.json');
  });

  for (const file of files) {
    it(`${file} matches database/maps`, () => {
      const canonicalPath = join(CANONICAL_DIR, file);
      expect(existsSync(canonicalPath), `${file} has no canonical counterpart in database/maps`).toBe(true);
      const copy = JSON.parse(readFileSync(join(REGIONAL_DIR, file), 'utf8'));
      const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8'));
      expect(copy).toEqual(canonical);
    });
  }
});
