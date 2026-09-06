import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The bare `pt-safe` / `pb-safe` / `px-safe` utilities SET padding rather than
 * adding to it, and they are emitted at the same specificity as Tailwind's own
 * `p*-*` classes. Combining them on one element silently deleted the base
 * padding on every device without a notch — every Android, every desktop, the
 * iPhone SE, and both horizontal edges of every portrait iPhone.
 *
 * The additive scale in tailwind.config.js (`pt-safe-4` = 1rem + the inset) is
 * the fix. This test stops the pairing coming back: it is a source scan rather
 * than a render test because the failure is invisible in jsdom, which reports
 * `env(safe-area-inset-*)` as 0 exactly like the broken production case.
 */

const AXES = [
  { safe: 'pt-safe', base: /\b(?:p|py|pt)-(?:\d+(?:\.\d+)?|px)\b/ },
  { safe: 'pb-safe', base: /\b(?:p|py|pb)-(?:\d+(?:\.\d+)?|px)\b/ },
  { safe: 'px-safe', base: /\b(?:p|px|pl|pr)-(?:\d+(?:\.\d+)?|px)\b/ },
];

/** A bare utility: `pt-safe` but not `pt-safe-4`. */
const bare = (safe: string) => new RegExp(`\\b${safe}(?![-\\w])`);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx$/.test(full)) acc.push(full);
  }
  return acc;
}

/** Class strings, as they appear inside a className attribute or clsx call. */
function classStrings(source: string): string[] {
  return [...source.matchAll(/(['"`])([^'"`\n]*?-safe[^'"`\n]*?)\1/g)].map((m) => m[2]);
}

describe('safe-area padding never cancels base padding', () => {
  const files = sourceFiles(join(__dirname, '..'));

  it('scans a realistic number of components', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never pairs a bare *-safe utility with a base padding class', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const classes of classStrings(readFileSync(file, 'utf8'))) {
        for (const { safe, base } of AXES) {
          if (bare(safe).test(classes) && base.test(classes)) {
            offenders.push(`${file.split('/src/')[1]} — "${classes.trim()}" (${safe} deletes the base padding)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still allows a bare *-safe on its own, for inset-only edges', () => {
    // The bottom nav and the in-game action bar supply their own height and
    // want the inset alone — that usage stays legal.
    for (const { safe, base } of AXES) {
      expect(bare(safe).test(`fixed bottom-0 ${safe} min-h-[56px]`)).toBe(true);
      expect(base.test(`fixed bottom-0 ${safe} min-h-[56px]`)).toBe(false);
    }
  });

  it('treats the additive scale as safe', () => {
    for (const { safe } of AXES) {
      expect(bare(safe).test(`px-3 ${safe}-4 sm:px-4`)).toBe(false);
    }
  });
});
