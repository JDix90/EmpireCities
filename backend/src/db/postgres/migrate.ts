/**
 * Migration runner — reads all .sql files from database/migrations
 * and executes them in order against the configured PostgreSQL database.
 */
import fs from 'fs';
import path from 'path';
import { pgPool, connectPostgres } from './index';

async function runMigrations(): Promise<void> {
  await connectPostgres();

  const migrationsDir = path.resolve(__dirname, '../../../../database/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pgPool.connect();
  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT id FROM _migrations WHERE filename = $1',
        [file]
      );
      if (rows.length > 0) {
        console.log(`[Migration] Skipping (already applied): ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`[Migration] Applying: ${file}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[Migration] Applied: ${file}`);
    }

    console.log('[Migration] All migrations complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migration] Error — rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pgPool.end();
  }
}

runMigrations();
