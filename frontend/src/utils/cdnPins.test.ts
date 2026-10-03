import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * Every file the client loads from GitHub through jsDelivr names a fixed
 * version. A branch name such as `@master` serves whatever upstream pushes, so
 * an outside change could break the map editor or the Moon without a deploy.
 */
const SRC = resolve(process.cwd(), 'src');
const FLOATING = /cdn\.jsdelivr\.net\/gh\/[^'"`\s]+@(?:master|main|latest)\//g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('CDN files', () => {
  it('pin a version instead of following a branch', () => {
    const floating = sourceFiles(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(FLOATING)].map((m) => `${relative(SRC, file)}: ${m[0]}`),
    );
    expect(floating).toEqual([]);
  });
});
