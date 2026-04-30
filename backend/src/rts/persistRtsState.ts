import { query, queryOne } from '../db/postgres';

export async function saveRtsState(gameId: string, state: unknown): Promise<void> {
  const json = JSON.stringify(state);
  await query(
    `INSERT INTO rts_game_states (game_id, state_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (game_id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()`,
    [gameId, json],
  );
}

export async function loadRtsState(gameId: string): Promise<unknown | null> {
  const row = await queryOne<{ state_json: unknown }>(
    'SELECT state_json FROM rts_game_states WHERE game_id = $1',
    [gameId],
  );
  if (!row) return null;
  return typeof row.state_json === 'string' ? JSON.parse(row.state_json) : row.state_json;
}
