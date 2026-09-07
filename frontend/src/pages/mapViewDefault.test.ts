import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GamePage used to run an effect on every game load that did `setMapView('globe')`
 * unconditionally. `getInitialMapView()` already answers globe unless the player
 * explicitly picked 2D, so the effect's only effect was to throw that choice
 * away: Settings → "Default map view: 2D" saved, and reverted on screen the
 * moment a game opened.
 *
 * A source scan rather than a render test: GamePage is ~5000 lines with a live
 * socket, a WebGL globe and a dozen stores behind it, and the failure mode is a
 * single stray line rather than anything a shallow render would surface.
 */
const SOURCE = readFileSync(join(__dirname, 'GamePage.tsx'), 'utf8');

describe('GamePage map view', () => {
  it('switches to the globe only where the player asked for it', () => {
    const hits = SOURCE.match(/setMapView\(\s*'globe'\s*\)/g) ?? [];
    // The one survivor is `switchToGlobeView`, wired to the Globe buttons.
    expect(hits).toHaveLength(1);
    expect(SOURCE).toMatch(/switchToGlobeView\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]{0,200}setMapView\(\s*'globe'\s*\)/);
  });

  it('has no "apply the globe default once per game" latch left', () => {
    expect(SOURCE).not.toMatch(/globeDefaultApplied/);
  });

  it('still seeds the view from the stored preference', () => {
    expect(SOURCE).toMatch(/useState<'2d' \| 'globe'>\(getInitialMapView\)/);
  });
});
