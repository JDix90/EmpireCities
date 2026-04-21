import { query, queryOne } from '../db/postgres';
import type { GameState } from '../types';

type ReplaySnapshotRow = { turn_number: number; state_json: GameState | string };

export interface InsightItem {
  turn: number;
  title: string;
  impact: 'high' | 'medium';
  explanation: string;
  alternative: string;
}

export interface ReplayHighlightItem {
  turn: number;
  label: string;
  type: 'turning_point' | 'capture' | 'swing';
}

function parseState(row: ReplaySnapshotRow): GameState {
  return typeof row.state_json === 'string' ? JSON.parse(row.state_json) as GameState : row.state_json;
}

function getPlayerTerritoryCounts(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of state.players) counts[p.player_id] = 0;
  for (const territory of Object.values(state.territories)) {
    if (!territory.owner_id) continue;
    counts[territory.owner_id] = (counts[territory.owner_id] ?? 0) + 1;
  }
  return counts;
}

function buildInsightsFromSnapshots(rows: ReplaySnapshotRow[]): InsightItem[] {
  if (rows.length < 2) return [];
  const parsed = rows.map((r) => ({ turn: r.turn_number, state: parseState(r) }));
  const swings: Array<{ turn: number; playerId: string; delta: number }> = [];

  for (let i = 1; i < parsed.length; i++) {
    const prevCounts = getPlayerTerritoryCounts(parsed[i - 1].state);
    const nextCounts = getPlayerTerritoryCounts(parsed[i].state);
    for (const [playerId, next] of Object.entries(nextCounts)) {
      const prev = prevCounts[playerId] ?? 0;
      const delta = next - prev;
      if (Math.abs(delta) >= 2) swings.push({ turn: parsed[i].turn, playerId, delta });
    }
  }

  swings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return swings.slice(0, 3).map((s) => ({
    turn: s.turn,
    title: s.delta > 0 ? 'Momentum swing captured' : 'Map control slipped',
    impact: Math.abs(s.delta) >= 3 ? 'high' : 'medium',
    explanation:
      s.delta > 0
        ? `You gained ${s.delta} net territories in this window, creating a tempo advantage.`
        : `You lost ${Math.abs(s.delta)} net territories in this window, which reduced map control.`,
    alternative:
      s.delta > 0
        ? 'Pressure adjacent weak borders earlier next turn to convert momentum into region bonus control.'
        : 'Reinforce a connected defensive cluster before attacking to avoid overextension and chain losses.',
  }));
}

function buildHighlightsFromInsights(insights: InsightItem[]): ReplayHighlightItem[] {
  return insights.map((insight) => ({
    turn: insight.turn,
    label: insight.title,
    type: 'turning_point',
  }));
}

export async function generateAndStorePostMatchAnalysis(gameId: string): Promise<void> {
  const rows = await query<ReplaySnapshotRow>(
    'SELECT turn_number, state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number ASC LIMIT 300',
    [gameId],
  );
  if (rows.length === 0) return;

  const insights = buildInsightsFromSnapshots(rows);
  const highlights = buildHighlightsFromInsights(insights);

  await query(
    `INSERT INTO match_insight_reports (game_id, insights_json, generated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (game_id) DO UPDATE
     SET insights_json = EXCLUDED.insights_json,
         generated_at = NOW()`,
    [gameId, JSON.stringify({ version: 1, insights })],
  );

  await query(
    `INSERT INTO match_replay_highlights (game_id, highlights_json, generated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (game_id) DO UPDATE
     SET highlights_json = EXCLUDED.highlights_json,
         generated_at = NOW()`,
    [gameId, JSON.stringify({ version: 1, highlights })],
  );
}

export async function getInsights(gameId: string): Promise<InsightItem[]> {
  const row = await queryOne<{ insights_json: { insights?: InsightItem[] } }>(
    'SELECT insights_json FROM match_insight_reports WHERE game_id = $1',
    [gameId],
  );
  return row?.insights_json?.insights ?? [];
}

export async function getReplayHighlights(gameId: string): Promise<ReplayHighlightItem[]> {
  const row = await queryOne<{ highlights_json: { highlights?: ReplayHighlightItem[] } }>(
    'SELECT highlights_json FROM match_replay_highlights WHERE game_id = $1',
    [gameId],
  );
  return row?.highlights_json?.highlights ?? [];
}

export async function getOrCreateWeeklyChallenge(): Promise<{
  challenge_id: string;
  week_start_date: string;
  seed: number;
  rules_json: Record<string, unknown>;
}> {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  const weekStart = monday.toISOString().slice(0, 10);

  let row = await queryOne<{
    challenge_id: string;
    week_start_date: string;
    seed: number;
    rules_json: Record<string, unknown>;
  }>(
    `SELECT challenge_id, week_start_date::text, seed, rules_json
     FROM weekly_seeded_challenges
     WHERE week_start_date = $1`,
    [weekStart],
  );

  if (!row) {
    const seed = Math.abs(Math.floor((Date.now() / 1000) % 2147483647));
    const rules = {
      scoring: 'score_desc_efficiency_desc_duration_asc',
      objective: 'maximize territory control with minimal losses',
      turn_limit: 20,
    };
    await query(
      `INSERT INTO weekly_seeded_challenges (week_start_date, seed, status, rules_json)
       VALUES ($1, $2, 'active', $3::jsonb)`,
      [weekStart, seed, JSON.stringify(rules)],
    );
    row = await queryOne<{
      challenge_id: string;
      week_start_date: string;
      seed: number;
      rules_json: Record<string, unknown>;
    }>(
      `SELECT challenge_id, week_start_date::text, seed, rules_json
       FROM weekly_seeded_challenges
       WHERE week_start_date = $1`,
      [weekStart],
    );
  }

  if (!row) throw new Error('Failed to create weekly challenge');
  return row;
}

export async function updateSkillProfilesFromGameState(state: GameState): Promise<void> {
  const weaknessesByPlayer = new Map<string, string[]>();

  for (const player of state.players) {
    if (player.is_ai) continue;
    const weaknesses: string[] = [];
    if ((player.territory_count ?? 0) <= 3) weaknesses.push('defensive_hold');
    if ((player.cards_redeemed_count ?? 0) === 0 && state.turn_number >= 8) weaknesses.push('card_timing');
    if ((player.unlocked_techs?.length ?? 0) === 0 && state.turn_number >= 10) weaknesses.push('tech_timing');
    if ((player.territories_captured_turn_max ?? 0) <= 1 && state.turn_number >= 10) weaknesses.push('attack_conversion');
    weaknessesByPlayer.set(player.player_id, weaknesses);
  }

  for (const [userId, weaknesses] of weaknessesByPlayer.entries()) {
    const prior = await queryOne<{ profile_json: Record<string, unknown> }>(
      'SELECT profile_json FROM player_skill_profiles WHERE user_id = $1',
      [userId],
    );
    const priorWeaknesses = Array.isArray(prior?.profile_json?.weaknesses)
      ? (prior?.profile_json?.weaknesses as string[])
      : [];
    const mergedWeaknesses = [...new Set([...weaknesses, ...priorWeaknesses])].slice(0, 8);
    const nextProfile = {
      weaknesses: mergedWeaknesses,
      last_turn_count: state.turn_number,
      updated_from_game: state.game_id,
      updated_at: new Date().toISOString(),
    };
    await query(
      `INSERT INTO player_skill_profiles (user_id, profile_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET profile_json = EXCLUDED.profile_json,
           updated_at = NOW()`,
      [userId, JSON.stringify(nextProfile)],
    );
  }
}
