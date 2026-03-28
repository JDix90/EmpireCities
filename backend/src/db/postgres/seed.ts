/**
 * Seed runner — reads all .sql files from database/seeds
 * and executes them against the configured PostgreSQL database.
 */
import fs from 'fs';
import path from 'path';
import { pgPool, connectPostgres } from './index';

async function runSeeds(): Promise<void> {
  await connectPostgres();

  const seedsDir = path.resolve(__dirname, '../../../../database/seeds');
  const files = fs
    .readdirSync(seedsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pgPool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf-8');
      console.log(`[Seed] Applying: ${file}`);
      await client.query(sql);
      console.log(`[Seed] Applied: ${file}`);
    }
    console.log('[Seed] All seeds complete.');
  } catch (err) {
    console.error('[Seed] Error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pgPool.end();
  }
}

runSeeds();
