import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * The client's fonts and globe textures ship with it. They used to come from
 * Google Fonts and jsDelivr at run time: two third-party requests on every
 * visit, and where either was blocked the globe was a plain sphere.
 */
const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');
const THIRD_PARTY = /https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('self-hosted assets', () => {
  it('loads nothing from jsDelivr, unpkg or Google Fonts at run time', () => {
    const hits = [...sourceFiles(SRC), resolve(ROOT, 'index.html')].flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(THIRD_PARTY)].map((m) => `${relative(ROOT, file)}: ${m[0]}`),
    );
    expect(hits).toEqual([]);
  });

  it('declares Inter and Cinzel from font files that exist, without layout shift', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    const faces = [...html.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]);
    expect(faces.filter((f) => f.includes("'Inter'"))).toHaveLength(2);
    expect(faces.filter((f) => f.includes("'Cinzel'"))).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain('font-display: optional');
      for (const [, url] of face.matchAll(/url\(([^)]+)\)/g)) {
        expect(existsSync(resolve(ROOT, url)), url).toBe(true);
      }
    }
    for (const [, href] of html.matchAll(/<link rel="preload" href="([^"]+\.woff2)"/g)) {
      expect(existsSync(resolve(ROOT, href)), href).toBe(true);
    }
  });

  it('bundles the globe textures it points at', () => {
    for (const file of ['earth-blue-marble.jpg', 'earth-topology.png', 'moon_1024.jpg']) {
      expect(existsSync(resolve(SRC, 'assets/globe', file)), file).toBe(true);
    }
  });
});
