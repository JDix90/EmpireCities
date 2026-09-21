/**
 * No two routes may declare the same path.
 *
 * React Router picks the first of two identical paths, silently, and the loser
 * simply stops existing. That is how a marketing `/maps` page shipped on top of
 * the authenticated Map Hub: both routes were valid, both rendered fine in
 * isolation, every test passed, and the Hub became unreachable in production
 * for every logged-in player.
 *
 * Nothing in the type system or the router warns about this, so it is asserted
 * here. Parsing App.tsx rather than importing it is deliberate: importing the
 * route table would pull in the whole lazy-loaded app.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const APP = fs.readFileSync(path.resolve(__dirname, 'App.tsx'), 'utf-8');

/** Every `path="..."` on a <Route>, in declaration order. */
const declaredPaths = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

describe('the route table', () => {
  it('declares enough routes to be worth checking', () => {
    // Guards the regex itself: a refactor that changed the JSX shape would
    // otherwise turn this whole file into a test that always passes.
    expect(declaredPaths.length).toBeGreaterThan(20);
  });

  it('never declares the same path twice', () => {
    const seen = new Map<string, number>();
    for (const p of declaredPaths) seen.set(p, (seen.get(p) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(
      duplicates.length === 0
        ? true
        : `duplicate route paths (the second never renders): ${duplicates.join(', ')}`,
    ).toBe(true);
  });

  it('keeps /maps with the Map Hub', () => {
    // The specific collision that shipped. Named explicitly because the generic
    // check above passes the moment either route is deleted, including the
    // wrong one.
    expect(APP).toContain('<Route path="/maps" element={<PrivateRoute><MapHubPage /></PrivateRoute>} />');
    expect(declaredPaths.filter((p) => p === '/maps')).toHaveLength(1);
  });
});
