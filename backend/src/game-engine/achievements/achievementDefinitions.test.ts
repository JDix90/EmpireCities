/**
 * Every achievement can be earned. Five were shown to players with nothing in
 * the code that awarded them, and most were defined only by seed files a
 * deploy runs with --seed alone, so a database could lack a row a game then
 * failed to insert. These hold the definitions, the seeds and the code to
 * ACHIEVEMENT_IDS. What each one asks for is tested in achievementService.test.ts.
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

// 051 adds any row a database lacks; 052, the latest to touch them, writes
// every row over with the words in use now.
const migrationSql = read('database/migrations/051_achievement_definitions.sql');
const migration = definitions(migrationSql);
const current = definitions(read('database/migrations/052_achievement_rules.sql'));
const seeded = [
  'database/seeds/001_seed_data.sql',
  'database/seeds/002_seed_medals.sql',
  'database/seeds/003_acw_achievement.sql',
].flatMap((file) => definitions(read(file)).map((d) => ({ ...d, file })));
/** Defined by migration 014 and never by a seed. */
const onlyInMigration014 = definitions(read('database/migrations/014_progression_phase1.sql')).map((d) => d.id);

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

  it('are all written by the latest migration, so no database keeps an old wording', () => {
    expect(current.map((d) => d.id).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
  });

  it('match the seeds', () => {
    // A fresh database runs the seeds after the migrations, and they add a row
    // only where one is missing, so they change nothing; they still say what
    // the database does, for whoever reads them.
    expect(seeded.map((d) => d.id).sort())
      .toEqual(ACHIEVEMENT_IDS.filter((id) => !onlyInMigration014.includes(id)).sort());
    for (const d of seeded) {
      const m = current.find((x) => x.id === d.id);
      expect(m, `${d.id} in ${d.file}`).toEqual({ id: d.id, name: d.name, description: d.description, xp: d.xp });
    }
  });

  it('include the medals the unlocks hand out, the first six as seed 002 has them', () => {
    // user_cosmetics references cosmetics too: a medal missing from a database
    // failed First Blood's unlock as surely as a missing achievement. Migration
    // 053 brought back the Warlord Frame and Emperor Marker; no seed has them.
    const medals = [...cosmetics(migrationSql), ...cosmetics(read('database/migrations/053_earned_rewards_return.sql'))];
    const handedOut = [...Object.values(ACHIEVEMENT_COSMETIC_MAP), 'frame_silver'].sort();
    expect(medals.map((m) => m[0]).sort()).toEqual(handedOut);
    const seeded = cosmetics(read('database/seeds/002_seed_medals.sql'));
    for (const medal of cosmetics(migrationSql)) {
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
