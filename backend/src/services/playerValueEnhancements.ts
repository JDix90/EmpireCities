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

interface TurnAggregate {
  turn: number;
  probBefore: number;
  probAfter: number;
  probDelta: number;
  territoryDelta: number;
}

/**
 * Build coaching insights from the human player's perspective.
 *
 * Prior versions iterated over *every* snapshot pair and over *every* player,
 * which meant a dominant AI opponent's territory gains were attributed to the
 * viewer ("You gained 3…") and multiple swings within the same turn clustered
 * onto the same turn label. This rewrite:
 *   - scopes all swings to the human (first `!is_ai`) player,
 *   - aggregates per-turn (start-of-turn vs end-of-turn) so each insight maps
 *     to a distinct integer turn on the endgame chart,
 *   - leans on `win_probability_history` (the exact series the chart renders)
 *     as the primary signal so coaching points line up with chart movement,
 *   - falls back to territory-count deltas when an older game state has no
 *     probability history attached.
 */
function buildInsightsFromSnapshots(rows: ReplaySnapshotRow[]): InsightItem[] {
  if (rows.length < 2) return [];
  const lastState = parseState(rows[rows.length - 1]);
  const humanPlayer = lastState.players.find((p) => !p.is_ai);
  if (!humanPlayer) return [];
  const humanId = humanPlayer.player_id;

  // ── Territory trajectory per turn (from game_states snapshots) ────────
  const territoryByTurn = new Map<number, { first: number; last: number }>();
  for (const row of rows) {
    const state = parseState(row);
    const counts = getPlayerTerritoryCounts(state);
    const humanCount = counts[humanId] ?? 0;
    const existing = territoryByTurn.get(row.turn_number);
    if (!existing) {
      territoryByTurn.set(row.turn_number, { first: humanCount, last: humanCount });
    } else {
      existing.last = humanCount;
    }
  }

  const byTurn = new Map<number, TurnAggregate>();
  const orderedTurns = Array.from(territoryByTurn.keys()).sort((a, b) => a - b);
  for (let i = 0; i < orderedTurns.length; i++) {
    const t = orderedTurns[i];
    const endCount = territoryByTurn.get(t)!.last;
    const baseline = i === 0
      ? territoryByTurn.get(t)!.first
      : territoryByTurn.get(orderedTurns[i - 1])!.last;
    byTurn.set(t, {
      turn: t,
      probBefore: 0,
      probAfter: 0,
      probDelta: 0,
      territoryDelta: endCount - baseline,
    });
  }

  // ── Win-probability trajectory per turn (same data the chart renders) ─
  const history = lastState.win_probability_history ?? [];
  if (history.length >= 2) {
    const historyByTurn = new Map<number, { first: number; last: number }>();
    for (const snap of history) {
      const prob = snap.probabilities[humanId] ?? 0;
      const existing = historyByTurn.get(snap.turn);
      if (!existing) historyByTurn.set(snap.turn, { first: prob, last: prob });
      else existing.last = prob;
    }
    const probTurns = Array.from(historyByTurn.keys()).sort((a, b) => a - b);
    for (let i = 0; i < probTurns.length; i++) {
      const t = probTurns[i];
      const endProb = historyByTurn.get(t)!.last;
      const baseline = i === 0
        ? historyByTurn.get(t)!.first
        : historyByTurn.get(probTurns[i - 1])!.last;
      const agg = byTurn.get(t) ?? {
        turn: t,
        probBefore: baseline,
        probAfter: endProb,
        probDelta: endProb - baseline,
        territoryDelta: 0,
      };
      agg.probBefore = baseline;
      agg.probAfter = endProb;
      agg.probDelta = endProb - baseline;
      byTurn.set(t, agg);
    }
  }

  // ── Rank turns by combined impact and keep the top 3 ──────────────────
  const scored = Array.from(byTurn.values())
    .filter((a) => Math.abs(a.probDelta) >= 0.04 || Math.abs(a.territoryDelta) >= 2)
    .map((a) => ({
      ...a,
      // Blend probability and raw territory swing so games with no
      // probability history still produce meaningful rankings.
      score: Math.abs(a.probDelta) + Math.abs(a.territoryDelta) * 0.02,
    }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((s) => {
    // Prefer probability-delta direction when we have chart data; otherwise
    // fall back to the territory count trend.
    const direction = s.probDelta !== 0 ? Math.sign(s.probDelta) : Math.sign(s.territoryDelta);
    const territoryPhrase = s.territoryDelta === 0
      ? null
      : s.territoryDelta > 0
        ? `gained ${s.territoryDelta} territor${s.territoryDelta === 1 ? 'y' : 'ies'}`
        : `lost ${Math.abs(s.territoryDelta)} territor${Math.abs(s.territoryDelta) === 1 ? 'y' : 'ies'}`;
    const probPct = Math.round(Math.abs(s.probDelta) * 100);
    const beforePct = Math.round(s.probBefore * 100);
    const afterPct = Math.round(s.probAfter * 100);
    const probPhrase = probPct > 0
      ? ` Win probability shifted from ${beforePct}% to ${afterPct}%.`
      : '';
    const impactHigh = probPct >= 10 || Math.abs(s.territoryDelta) >= 3;

    if (direction > 0) {
      return {
        turn: s.turn,
        title: 'Momentum swing captured',
        impact: impactHigh ? 'high' : 'medium',
        explanation: (territoryPhrase
          ? `You ${territoryPhrase} this turn, creating a tempo advantage.`
          : 'Your position strengthened this turn, creating a tempo advantage.') + probPhrase,
        alternative:
          'Pressure adjacent weak borders next turn to convert momentum into region bonus control.',
      };
    }
    return {
      turn: s.turn,
      title: 'Map control slipped',
      impact: impactHigh ? 'high' : 'medium',
      explanation: (territoryPhrase
        ? `You ${territoryPhrase} this turn, which reduced map control.`
        : 'Your position weakened this turn, which reduced map control.') + probPhrase,
      alternative:
        'Reinforce a connected defensive cluster before attacking to avoid overextension and chain losses.',
    };
  });
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
