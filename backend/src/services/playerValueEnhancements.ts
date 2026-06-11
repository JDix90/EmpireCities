import { query, queryOne } from '../db/postgres';
import type { GameState, ActionDecision } from '../types';

type ReplaySnapshotRow = { turn_number: number; state_json: GameState | string };

export interface InsightItem {
  turn: number;
  title: string;
  impact: 'high' | 'medium';
  explanation: string;
  alternative: string;
}

/**
 * Selection threshold: any decision with |Δprob| at or above this magnitude is
 * automatically promoted into the turning-points list, even if it pushes the
 * total beyond the default top-N. Tuned to match the user's UX requirement
 * that "any swing larger than 12%" should always be surfaced.
 */
const HIGH_IMPACT_DELTA = 0.12;

/** Default number of top-ranked decisions when no high-impact ones exceed it. */
const DEFAULT_TOP_N = 3;

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
/** Exported for tests — production callers go through generateAndStorePostMatchAnalysis. */
export function buildInsightsFromSnapshots(rows: ReplaySnapshotRow[]): InsightItem[] {
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

  // A resignation zeroes the player's territories and cliffs their win
  // probability in the final snapshot. That's a bookkeeping artifact, not a
  // strategic turning point — without this exclusion the top-ranked insight
  // on every resigned game was "You lost N territories this turn, weakening
  // your position", which misreads quitting as a catastrophic combat loss.
  if (humanPlayer.has_resigned) {
    byTurn.delete(lastState.turn_number);
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
    const tDelta = s.territoryDelta;
    const pDelta = s.probDelta;
    const probPct = Math.round(Math.abs(pDelta) * 100);
    const beforePct = Math.round(s.probBefore * 100);
    const afterPct = Math.round(s.probAfter * 100);
    const probPhrase = probPct > 0
      ? ` Win probability shifted from ${beforePct}% to ${afterPct}%.`
      : '';
    const impactHigh = probPct >= 10 || Math.abs(tDelta) >= 3;
    const tWord = (n: number) => `territor${Math.abs(n) === 1 ? 'y' : 'ies'}`;

    // Four distinct narrative cases based on whether territory and probability
    // move in the same or opposite directions.
    const isOverextension = tDelta > 0 && pDelta < 0;
    const isConsolidation = tDelta < 0 && pDelta > 0;
    const isStrongPush   = tDelta > 0 && direction > 0;

    if (isOverextension) {
      return {
        turn: s.turn,
        title: 'Overextension cost you ground',
        impact: impactHigh ? 'high' : 'medium',
        explanation:
          `You gained ${tDelta} ${tWord(tDelta)} this turn but overextended your position.` + probPhrase,
        alternative:
          'Reinforce existing holdings before expanding — thin frontlines are easier for opponents to exploit.',
      };
    }

    if (isConsolidation) {
      return {
        turn: s.turn,
        title: 'Consolidation improved your outlook',
        impact: impactHigh ? 'high' : 'medium',
        explanation:
          `You lost ${Math.abs(tDelta)} ${tWord(tDelta)} this turn, but consolidated into a stronger defensive position.` + probPhrase,
        alternative:
          'Hold the tighter perimeter and target region-completing territories to convert defense into bonus income.',
      };
    }

    if (isStrongPush || direction > 0) {
      const body = tDelta > 0
        ? `You gained ${tDelta} ${tWord(tDelta)} this turn, building a tempo advantage.`
        : tDelta < 0
          ? `Your opponents lost ground this turn, shifting momentum in your favor.`
          : 'Your position strengthened this turn, creating a tempo advantage.';
      return {
        turn: s.turn,
        title: 'Momentum swing captured',
        impact: impactHigh ? 'high' : 'medium',
        explanation: body + probPhrase,
        alternative:
          'Pressure adjacent weak borders next turn to convert momentum into region bonus control.',
      };
    }

    // isSetback or direction < 0 with no territory change
    const body = tDelta < 0
      ? `You lost ${Math.abs(tDelta)} ${tWord(tDelta)} this turn, weakening your position.`
      : tDelta > 0
        ? `Your gains this turn came at a strategic cost.`
        : 'Your position weakened this turn.';
    return {
      turn: s.turn,
      title: 'Map control slipped',
      impact: impactHigh ? 'high' : 'medium',
      explanation: body + probPhrase,
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

/**
 * Convert a verb phrase from a decision summary into a human-readable title.
 * Each summary follows the convention "<Verb> <object>" (e.g.
 * "Attacked Ukraine → Afghanistan with 5 units; captured Afghanistan").
 */
function titleFromDecision(decision: ActionDecision): string {
  switch (decision.action_type) {
    case 'attack':       return decision.summary.includes('captured') ? 'Decisive attack' : 'Costly attack';
    case 'naval_attack': return 'Naval engagement';
    case 'fortify':      return 'Fortification move';
    case 'naval_move':   return 'Fleet repositioning';
    case 'draft':        return 'Reinforcement deployment';
    case 'redeem_cards': return 'Card set redemption';
    case 'build':        return 'Construction project';
    case 'research':     return 'Research breakthrough';
    case 'ability':      return 'Special ability';
    case 'influence':    return 'Influence projection';
    case 'event_choice': return 'Event card decision';
    default:             return 'Pivotal decision';
  }
}

/**
 * Generates a structured insight from a single decision's probability swing.
 * The narrative is grounded in the *exact* observed change in win probability
 * caused by that specific player choice — no inference required.
 */
function insightFromDecision(decision: ActionDecision): InsightItem {
  const before = Math.round(decision.prob_before * 100);
  const after = Math.round(decision.prob_after * 100);
  const deltaPct = Math.round(decision.prob_delta * 100);
  const swung = decision.prob_delta > 0 ? 'rose' : 'fell';
  const direction = decision.prob_delta > 0 ? 'gained ground' : 'lost ground';
  const impactHigh = Math.abs(decision.prob_delta) >= HIGH_IMPACT_DELTA;
  const explanation =
    `${decision.summary}. Win probability ${swung} from ${before}% to ${after}% (${deltaPct >= 0 ? '+' : ''}${deltaPct} pts).`;

  const alternative =
    decision.prob_delta < 0
      ? actionTypeAlternative(decision.action_type, false)
      : actionTypeAlternative(decision.action_type, true);

  return {
    turn: decision.turn,
    title: `${titleFromDecision(decision)} — ${direction}`,
    impact: impactHigh ? 'high' : 'medium',
    explanation,
    alternative,
  };
}

function actionTypeAlternative(type: ActionDecision['action_type'], wasPositive: boolean): string {
  if (wasPositive) {
    switch (type) {
      case 'attack':
      case 'naval_attack':
        return 'Pressure adjacent weak borders next turn to convert momentum into region control.';
      case 'build':
      case 'research':
        return 'Stack synergistic upgrades on the same theatre to compound this advantage.';
      case 'draft':
      case 'fortify':
      case 'naval_move':
        return 'Hold the strengthened position and look for a low-risk capture next turn.';
      default:
        return 'Maintain the current strategic momentum without overextending.';
    }
  }
  switch (type) {
    case 'attack':
    case 'naval_attack':
      return 'Wait for a higher dice advantage (≥2:1) before committing to attacks; thin frontlines compound losses.';
    case 'build':
    case 'research':
      return 'Prioritise upgrades that defend or feed your current contested territories before speculative tech.';
    case 'draft':
    case 'fortify':
    case 'naval_move':
      return 'Concentrate units on a connected defensive cluster rather than spreading across the map.';
    case 'redeem_cards':
      return 'Time card redemption with an immediate offensive plan; idle bonus units invite counter-attacks.';
    case 'event_choice':
      return 'Re-read the event text carefully — many choices have a hidden cost paid over later turns.';
    case 'influence':
      return 'Influence works best on weakly-defended territories that complete a region; solo grabs rarely move probability.';
    case 'ability':
      return 'Powerful abilities are best saved for moments where they tip a fight you would otherwise lose.';
    default:
      return 'Reassess the strategic plan before committing to the next major action.';
  }
}

/**
 * Build insights from the per-action decision log captured during the game.
 * Each row has an exact, observed win-probability delta — selection is just
 * "sort by |delta| descending and take the top N, plus everything above the
 * high-impact threshold". No inference, no aggregation, no guessing.
 *
 * Exported for testing.
 */
export function buildInsightsFromDecisionLog(decisions: ActionDecision[]): InsightItem[] {
  if (decisions.length === 0) return [];

  // Score by absolute probability impact; ignore decisions that didn't move
  // the needle so we don't surface "deployed 1 unit, no change" as a turning point.
  const ranked = decisions
    .filter((d) => Math.abs(d.prob_delta) >= 0.01)
    .map((d) => ({ decision: d, magnitude: Math.abs(d.prob_delta) }))
    .sort((a, b) => b.magnitude - a.magnitude);

  if (ranked.length === 0) return [];

  // Always include any decision above the high-impact threshold, but
  // guarantee at least DEFAULT_TOP_N entries even if none clear the bar.
  const highImpact = ranked.filter((r) => r.magnitude >= HIGH_IMPACT_DELTA);
  const selected = highImpact.length >= DEFAULT_TOP_N
    ? highImpact
    : ranked.slice(0, Math.max(DEFAULT_TOP_N, highImpact.length));

  // Re-sort the surfaced subset chronologically so the modal reads like a
  // narrative ("Turn 1 → Turn 4 → Turn 7") rather than by magnitude.
  return selected
    .sort((a, b) => a.decision.step - b.decision.step)
    .map((r) => insightFromDecision(r.decision));
}

export async function generateAndStorePostMatchAnalysis(
  gameId: string,
  decisionLog?: ActionDecision[],
): Promise<void> {
  const rows = await query<ReplaySnapshotRow>(
    'SELECT turn_number, state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number ASC LIMIT 300',
    [gameId],
  );
  if (rows.length === 0) return;

  // Prefer the per-action decision log when available (precise, captured
  // server-side as actions occur). Fall back to the snapshot-diff heuristic
  // for legacy games or sessions where the in-memory log was lost (server
  // restart, eviction, etc.).
  const insights = decisionLog && decisionLog.length > 0
    ? buildInsightsFromDecisionLog(decisionLog)
    : buildInsightsFromSnapshots(rows);
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
