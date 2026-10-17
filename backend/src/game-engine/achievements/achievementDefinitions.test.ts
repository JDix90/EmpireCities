/**
 * Every achievement can be earned. Five were shown to players with nothing in
 * the code that awarded them, and most were defined only by seed files a
 * deploy runs with --seed alone, so a database could lack a row a game then
 * failed to insert. These hold the definitions, the seeds and the code to
 * ACHIEVEMENT_IDS.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ACHIEVEMENT_IDS } from './achievementIds';
import { ACHIEVEMENT_COSMETIC_MAP } from './achievementService';

const repo = path.resolve(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

interface Definition { id: string; name: string; description: string; xp: number }

/** The rows of every `INSERT INTO achievements … VALUES …` in a SQL file. */
function definitions(sql: string): Definition[] {
  const out: Definition[] = [];
  const inserts = sql.matchAll(/INSERT INTO achievements\b[^;]*?VALUES([\s\S]*?)ON CONFLICT/g);
  const str = `'((?:[^']|'')*)'`;
  const row = new RegExp(`\\(\\s*${str}\\s*,\\s*${str}\\s*,\\s*${str}\\s*,\\s*(\\d+)\\s*\\)`, 'g');
  for (const [, values] of inserts) {
    for (const m of values.matchAll(row)) {
      out.push({ id: m[1], name: m[2], description: m[3], xp: Number(m[4]) });
    }
  }
  return out;
}

/** The id, type, name and description of every `INSERT INTO cosmetics` row in a SQL file. */
function cosmetics(sql: string): string[][] {
  const out: string[][] = [];
  const str = `'((?:[^']|'')*)'`;
  const row = new RegExp(`\\(\\s*${str}\\s*,\\s*${str}\\s*,\\s*${str}\\s*,\\s*${str}`, 'g');
  for (const [, values] of sql.matchAll(/INSERT INTO cosmetics\b[^;]*?VALUES([\s\S]*?)ON CONFLICT/g)) {
    for (const m of values.matchAll(row)) out.push(m.slice(1, 5));
  }
  return out;
}

const migrationSql = read('database/migrations/051_achievement_definitions.sql');
const migration = definitions(migrationSql);
const elsewhere = [
  'database/seeds/001_seed_data.sql',
  'database/seeds/002_seed_medals.sql',
  'database/seeds/003_acw_achievement.sql',
  'database/migrations/014_progression_phase1.sql',
].flatMap((file) => definitions(read(file)).map((d) => ({ ...d, file })));

/** Non-test backend source, where achievements are granted. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}
const source = sourceFiles(path.join(repo, 'backend/src'))
  .filter((f) => !f.endsWith('achievementIds.ts'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

describe('achievement definitions', () => {
  it('are all inserted by a migration, so no database depends on the seeds for them', () => {
    expect(migration.map((d) => d.id).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  it('match the seeds and migration 014 that inserted them first', () => {
    // The migration adds a row only where one is missing, so it must say what
    // the existing rows say, or databases would disagree about an achievement.
    expect(elsewhere.length).toBe(ACHIEVEMENT_IDS.length);
    for (const d of elsewhere) {
      const m = migration.find((x) => x.id === d.id);
      expect(m, `${d.id} in ${d.file}`).toEqual({ id: d.id, name: d.name, description: d.description, xp: d.xp });
    }
  });

  it('include the medals the unlocks hand out, as seed 002 has them', () => {
    // user_cosmetics references cosmetics too: a medal missing from a database
    // failed First Blood's unlock as surely as a missing achievement.
    const medals = cosmetics(migrationSql);
    const handedOut = [...Object.values(ACHIEVEMENT_COSMETIC_MAP), 'frame_silver'].sort();
    expect(medals.map((m) => m[0]).sort()).toEqual(handedOut);
    const seeded = cosmetics(read('database/seeds/002_seed_medals.sql'));
    for (const medal of medals) {
      expect(seeded, medal[0]).toContainEqual(medal);
    }
  });

  it.each([...ACHIEVEMENT_IDS])('%s is granted somewhere in the code', (id) => {
    const granted = new RegExp(
      `push\\('${id}'\\)` + // the end-of-game check
      `|grantAchievements\\w*\\([^)]*'${id}'` + // earned away from a game's end
      `|^\\s+\\w+: '${id}',$`, // the era wins table
      'm',
    );
    expect(source).toMatch(granted);
  });
});
