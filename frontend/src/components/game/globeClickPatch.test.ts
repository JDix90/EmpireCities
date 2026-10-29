/**
 * globe.gl's tap handler (2.45.1, still in 2.46.2) reads the tapped object's
 * `__globeObjType` before checking it found one. The object it is handed is
 * the one last under the finger, and on a phone the globe's render loop
 * pauses when idle, so a territory redrawn since then (an AI move, a
 * selection) has left the scene: the lookup comes back null and the tap
 * throws "Cannot read properties of null (reading '__globeObjType')" instead
 * of doing nothing. patches/globe.gl@2.45.1.patch adds the check; this keeps
 * it from going missing in an upgrade.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('globe.gl tap handler', () => {
  it('checks the tapped object was found before reading its type', () => {
    const source = readFileSync(require.resolve('globe.gl'), 'utf8');
    expect(source).not.toMatch(/var objType = globeObj\.__globeObjType;/);
    expect(source.match(/var objType = globeObj && globeObj\.__globeObjType;/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
