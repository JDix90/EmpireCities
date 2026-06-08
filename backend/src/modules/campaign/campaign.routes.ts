import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';
import {
  type PathId,
  type PathCarry,
  CAMPAIGN_PATHS,
  CAMPAIGN_PATH_LIST,
  getPathEraConfig,
} from './campaignPaths';
import { applyAdminSnapshotsToSettings } from '../../services/adminConfig';

const CAMPAIGN_ERAS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'] as const;
type CampaignEra = typeof CAMPAIGN_ERAS[number];

const ERA_MAP_IDS: Record<CampaignEra, string> = {
  ancient:   'era_ancient',
  medieval:  'era_medieval',
  discovery: 'era_discovery',
  ww2:       'era_ww2',
  coldwar:   'era_coldwar',
  modern:    'era_modern',
};

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6'];

const ERA_AI_DIFFICULTY: Record<CampaignEra, string> = {
  ancient:   'easy',
  medieval:  'medium',
  discovery: 'medium',
  ww2:       'hard',
  coldwar:   'hard',
  modern:    'expert',
};

const ERA_AI_COUNT: Record<CampaignEra, number> = {
  ancient:   3,
  medieval:  3,
  discovery: 3,
  ww2:       3,
  coldwar:   4,
  modern:    4,
};


export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/campaign/start
   * Start a new campaign. Accepts optional `path_id` to begin a narrative path.
   */
  app.post('/start', { preHandler: [authenticate, rejectGuest] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const body = (req.body ?? {}) as { path_id?: string };
    const pathId = body.path_id as PathId | undefined;

    if (pathId && !CAMPAIGN_PATHS[pathId]) {
      return reply.status(400).send({ error: 'Invalid path_id' });
    }

    // Prevent two active campaigns on the SAME path — each path has unique narrative
    // state, so starting a duplicate would be confusing. Different paths (including
    // Classic + a narrative path) are allowed to run concurrently.
    if (pathId) {
      const duplicate = await queryOne<{ campaign_id: string }>(
        `SELECT campaign_id FROM user_campaigns
         WHERE user_id = $1 AND status = 'active' AND path_id = $2`,
        [userId, pathId],
      );
      if (duplicate) {
        return reply.status(409).send({
          error: 'You already have an active campaign on this path',
          campaign_id: duplicate.campaign_id,
        });
      }
    } else {
      const duplicate = await queryOne<{ campaign_id: string }>(
        `SELECT campaign_id FROM user_campaigns
         WHERE user_id = $1 AND status = 'active' AND path_id IS NULL`,
        [userId],
      );
      if (duplicate) {
        return reply.status(409).send({
          error: 'You already have an active classic campaign',
          campaign_id: duplicate.campaign_id,
        });
      }
    }

    const userRow = await queryOne<{ username: string }>(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!userRow) return reply.status(404).send({ error: 'User not found' });

    const campaignId = uuidv4();
    const initialCarry: Partial<PathCarry> = {};

    await query(
      `INSERT INTO user_campaigns (campaign_id, user_id, current_era_index, prestige_points, status, path_id, path_carry, path_narrative)
       VALUES ($1, $2, 0, 0, 'active', $3, $4::jsonb, '{}'::jsonb)`,
      [campaignId, userId, pathId ?? null, JSON.stringify(initialCarry)],
    );

    const { gameId, eraId } = await createEraGame({
      userId,
      campaignId,
      eraIndex: 0,
      pathId: pathId ?? null,
      pathCarry: initialCarry,
      prestigePoints: 0,
    });

    return reply.status(201).send({
      campaign_id: campaignId,
      current_era: eraId,
      current_era_index: 0,
      prestige_points: 0,
      path_id: pathId ?? null,
      path_carry: initialCarry,
      game_id: gameId,
    });
  });

  /**
   * POST /api/campaign/continue
   * Create the next era game for an active campaign.
   */
  app.post('/continue', { preHandler: [authenticate, rejectGuest] }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const body = (req.body ?? {}) as { campaign_id?: string };
    const requestedId = body.campaign_id;

    const campaign = requestedId
      ? await queryOne<{
          campaign_id: string;
          current_era_index: number;
          prestige_points: number;
          path_id: string | null;
          path_carry: Partial<PathCarry>;
          path_narrative: Record<string, string>;
        }>(
          `SELECT campaign_id, current_era_index, prestige_points, path_id,
                  path_carry, path_narrative
           FROM user_campaigns WHERE campaign_id = $1 AND user_id = $2 AND status = 'active'`,
          [requestedId, userId],
        )
      : await queryOne<{
          campaign_id: string;
          current_era_index: number;
          prestige_points: number;
          path_id: string | null;
          path_carry: Partial<PathCarry>;
          path_narrative: Record<string, string>;
        }>(
          `SELECT campaign_id, current_era_index, prestige_points, path_id,
                  path_carry, path_narrative
           FROM user_campaigns WHERE user_id = $1 AND status = 'active'
           ORDER BY started_at DESC LIMIT 1`,
          [userId],
        );
    if (!campaign) return reply.status(404).send({ error: 'No active campaign' });

    const eraIndex = campaign.current_era_index;
    if (eraIndex >= CAMPAIGN_ERAS.length) {
      return reply.status(409).send({ error: 'Campaign already completed' });
    }

    // Look up any existing era game (regardless of status). If the prior
    // attempt ended (won=false means a loss since completion handler would
    // have advanced the era on a win), or the game is stuck in a terminal
    // state but was never finalized, abandon it and start fresh. Only a
    // genuinely in-progress game — one where the human is still alive and
    // the phase is not game_over — should be resumable.
    const existingGame = await queryOne<{
      game_id: string;
      status: string;
      won: boolean;
    }>(
      `SELECT ce.game_id, g.status, ce.won
       FROM campaign_entries ce
       JOIN games g ON g.game_id = ce.game_id
       WHERE ce.campaign_id = $1 AND ce.era_id = $2`,
      [campaign.campaign_id, CAMPAIGN_ERAS[eraIndex]],
    );

    let shouldCreateFresh = !existingGame;

    if (existingGame) {
      if (existingGame.status === 'completed' || existingGame.status === 'abandoned') {
        shouldCreateFresh = true;
      } else {
        // status is 'waiting' or 'in_progress'. Inspect the latest snapshot
        // to decide whether the game can really be resumed, or whether it
        // was effectively lost (e.g. finalize failed previously) and should
        // be abandoned so the user can retry.
        const snapshot = await queryOne<{ state_json: any }>(
          `SELECT state_json FROM game_states
           WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1`,
          [existingGame.game_id],
        );
        const stateJson = snapshot?.state_json as
          | {
              phase?: string;
              players?: Array<{ is_ai?: boolean; territory_count?: number }>;
            }
          | undefined;
        const humanPlayer = stateJson?.players?.find((p) => !p.is_ai);
        const humanEliminated = humanPlayer != null && (humanPlayer.territory_count ?? 0) === 0;
        const gameIsOver = stateJson?.phase === 'game_over';

        if (humanEliminated || gameIsOver) {
          await query(
            `UPDATE games SET status = 'abandoned', ended_at = NOW()
             WHERE game_id = $1 AND status <> 'completed'`,
            [existingGame.game_id],
          );
          shouldCreateFresh = true;
        } else {
          return reply.send({
            campaign_id: campaign.campaign_id,
            current_era: CAMPAIGN_ERAS[eraIndex],
            current_era_index: eraIndex,
            prestige_points: campaign.prestige_points,
            path_id: campaign.path_id,
            path_carry: campaign.path_carry,
            game_id: existingGame.game_id,
          });
        }
      }
    }

    // Clear any stale per-era narrative outcome (e.g. 'lost' from a previous
    // attempt) so the retro outro text does not linger into the retry.
    if (shouldCreateFresh) {
      const narrativeKey = `era_${eraIndex}_outcome`;
      if (campaign.path_narrative && narrativeKey in campaign.path_narrative) {
        const cleanedNarrative: Record<string, string> = { ...campaign.path_narrative };
        delete cleanedNarrative[narrativeKey];
        await query(
          `UPDATE user_campaigns SET path_narrative = $1::jsonb WHERE campaign_id = $2`,
          [JSON.stringify(cleanedNarrative), campaign.campaign_id],
        );
      }
    }

    const userRow = await queryOne<{ username: string }>(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!userRow) return reply.status(404).send({ error: 'User not found' });

    const { gameId, eraId } = await createEraGame({
      userId,
      campaignId: campaign.campaign_id,
      eraIndex,
      pathId: campaign.path_id as PathId | null,
      pathCarry: campaign.path_carry,
      prestigePoints: campaign.prestige_points,
    });

    return reply.status(201).send({
      campaign_id: campaign.campaign_id,
      current_era: eraId,
      current_era_index: eraIndex,
      prestige_points: campaign.prestige_points,
      path_id: campaign.path_id,
      path_carry: campaign.path_carry,
      game_id: gameId,
    });
  });

  /**
   * GET /api/campaign/list
   * Return ALL campaigns (active + completed) for the authenticated user.
   * Used by the multi-campaign picker UI.
   */
  app.get('/list', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;

    const campaigns = await query<{
      campaign_id: string;
      current_era_index: number;
      prestige_points: number;
      status: string;
      started_at: string;
      completed_at: string | null;
      path_id: string | null;
      path_carry: Partial<PathCarry>;
      path_narrative: Record<string, string>;
    }>(
      `SELECT campaign_id, current_era_index, prestige_points, status, started_at, completed_at,
              path_id, path_carry, path_narrative
       FROM user_campaigns
       WHERE user_id = $1
       ORDER BY
         CASE WHEN status = 'active' THEN 0 ELSE 1 END,
         started_at DESC`,
      [userId],
    );

    if (campaigns.length === 0) {
      return reply.send({ campaigns: [] });
    }

    const campaignIds = campaigns.map((c) => c.campaign_id);
    const allEntries = await query<{
      campaign_id: string;
      era_id: string;
      game_id: string | null;
      won: boolean;
      completed_at: string;
      faction_id: string | null;
      map_id_override: string | null;
    }>(
      `SELECT campaign_id, era_id, game_id, won, completed_at, faction_id, map_id_override
       FROM campaign_entries
       WHERE campaign_id = ANY($1::uuid[])
       ORDER BY completed_at ASC`,
      [campaignIds],
    );

    const out = campaigns.map((c) => {
      const entries = allEntries.filter((e) => e.campaign_id === c.campaign_id);
      const pathConfig = c.path_id ? CAMPAIGN_PATHS[c.path_id as PathId] : null;
      const currentEraIndex = c.current_era_index;
      const currentEra = CAMPAIGN_ERAS[currentEraIndex] ?? null;
      const nextEra = currentEraIndex + 1 < CAMPAIGN_ERAS.length
        ? CAMPAIGN_ERAS[currentEraIndex + 1]
        : null;

      const erasWithNarrative = CAMPAIGN_ERAS.map((era, idx) => {
        const entry = entries.find((e) => e.era_id === era);
        const pathEra = pathConfig?.eras[idx];
        // "completed" must mean the era game reached a terminal outcome (won or
        // lost) — not merely that an entry row was created at era start. The
        // authoritative terminal signal is the per-era outcome stored in
        // path_narrative by handleCampaignCompletion. Using `!!entry` here made
        // in-progress / abandoned eras show as "Failed" on the campaign page.
        const outcome = c.path_narrative?.[`era_${idx}_outcome`];
        const isTerminal = outcome === 'won' || outcome === 'lost';
        return {
          era_id: era,
          index: idx,
          won: outcome === 'won' || (isTerminal ? false : (entry?.won ?? false)),
          completed: isTerminal,
          game_id: entry?.game_id ?? null,
          faction_id: entry?.faction_id ?? pathEra?.locked_faction ?? null,
          map_id: entry?.map_id_override ?? pathEra?.map_id ?? ERA_MAP_IDS[era as CampaignEra],
          intro_text: pathEra?.intro_text ?? null,
          outro_win_text: pathEra?.outro_win_text ?? null,
          outro_loss_text: pathEra?.outro_loss_text ?? null,
        };
      });

      return {
        campaign_id: c.campaign_id,
        status: c.status,
        current_era: currentEra,
        current_era_index: currentEraIndex,
        next_era: nextEra,
        prestige_points: c.prestige_points,
        started_at: c.started_at,
        completed_at: c.completed_at,
        path_id: c.path_id,
        path_carry: c.path_carry,
        path_narrative: c.path_narrative,
        path_config: pathConfig
          ? {
              path_id: pathConfig.path_id,
              name: pathConfig.name,
              tagline: pathConfig.tagline,
              description: pathConfig.description,
              signature_carry_key: pathConfig.signature_carry_key,
              signature_carry_label: pathConfig.signature_carry_label,
              signature_carry_max: pathConfig.signature_carry_max,
            }
          : null,
        eras: erasWithNarrative,
      };
    });

    return reply.send({ campaigns: out });
  });

  /**
   * GET /api/campaign/me
   * Return the active (or most recent) campaign for the authenticated user.
   * Retained for backward compatibility; new code should prefer /campaign/list.
   */
  app.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).userId as string;

    const campaign = await queryOne<{
      campaign_id: string;
      current_era_index: number;
      prestige_points: number;
      status: string;
      started_at: string;
      completed_at: string | null;
      path_id: string | null;
      path_carry: Partial<PathCarry>;
      path_narrative: Record<string, string>;
    }>(
      `SELECT campaign_id, current_era_index, prestige_points, status, started_at, completed_at,
              path_id, path_carry, path_narrative
       FROM user_campaigns
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [userId],
    );

    if (!campaign) {
      return reply.status(404).send({ error: 'No campaign found' });
    }

    const entries = await query<{
      era_id: string;
      game_id: string | null;
      won: boolean;
      completed_at: string;
      faction_id: string | null;
      map_id_override: string | null;
    }>(
      `SELECT era_id, game_id, won, completed_at, faction_id, map_id_override
       FROM campaign_entries
       WHERE campaign_id = $1
       ORDER BY completed_at ASC`,
      [campaign.campaign_id],
    );

    const currentEraIndex = campaign.current_era_index;
    const currentEra = CAMPAIGN_ERAS[currentEraIndex] ?? null;
    const nextEra = currentEraIndex + 1 < CAMPAIGN_ERAS.length
      ? CAMPAIGN_ERAS[currentEraIndex + 1]
      : null;

    // Build era list, using path config for narrative text when available
    const pathConfig = campaign.path_id ? CAMPAIGN_PATHS[campaign.path_id as PathId] : null;

    const erasWithNarrative = CAMPAIGN_ERAS.map((era, idx) => {
      const entry = entries.find((e) => e.era_id === era);
      const pathEra = pathConfig?.eras[idx];
      return {
        era_id: era,
        index: idx,
        won: entry?.won ?? false,
        completed: !!entry,
        game_id: entry?.game_id ?? null,
        faction_id: entry?.faction_id ?? pathEra?.locked_faction ?? null,
        map_id: entry?.map_id_override ?? pathEra?.map_id ?? ERA_MAP_IDS[era as CampaignEra],
        intro_text: pathEra?.intro_text ?? null,
        outro_win_text: pathEra?.outro_win_text ?? null,
        outro_loss_text: pathEra?.outro_loss_text ?? null,
      };
    });

    return reply.send({
      campaign_id: campaign.campaign_id,
      status: campaign.status,
      current_era: currentEra,
      current_era_index: currentEraIndex,
      next_era: nextEra,
      prestige_points: campaign.prestige_points,
      started_at: campaign.started_at,
      completed_at: campaign.completed_at,
      path_id: campaign.path_id,
      path_carry: campaign.path_carry,
      path_narrative: campaign.path_narrative,
      path_config: pathConfig
        ? {
            path_id: pathConfig.path_id,
            name: pathConfig.name,
            tagline: pathConfig.tagline,
            description: pathConfig.description,
            signature_carry_key: pathConfig.signature_carry_key,
            signature_carry_label: pathConfig.signature_carry_label,
            signature_carry_max: pathConfig.signature_carry_max,
          }
        : null,
      eras: erasWithNarrative,
    });
  });

  /**
   * GET /api/campaign/paths
   * Return the list of available campaign paths for the selection screen.
   */
  app.get('/paths', { preHandler: [authenticate] }, async (_req, reply) => {
    return reply.send(
      CAMPAIGN_PATH_LIST.map((p) => ({
        path_id: p.path_id,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        signature_carry_key: p.signature_carry_key,
        signature_carry_label: p.signature_carry_label,
        signature_carry_max: p.signature_carry_max,
        era_count: p.eras.length,
      })),
    );
  });
}

// ── Helper: create an era game ──────────────────────────────────────────

interface CreateEraGameArgs {
  userId: string;
  campaignId: string;
  eraIndex: number;
  pathId: PathId | null;
  pathCarry: Partial<PathCarry>;
  prestigePoints: number;
}

async function createEraGame({
  userId,
  campaignId,
  eraIndex,
  pathId,
  pathCarry,
  prestigePoints,
}: CreateEraGameArgs): Promise<{ gameId: string; eraId: string; mapId: string }> {
  const eraId = CAMPAIGN_ERAS[eraIndex];
  const pathConfig = pathId ? CAMPAIGN_PATHS[pathId] : null;
  const pathEra = pathId ? getPathEraConfig(pathId, eraIndex) : null;

  const mapId = pathEra?.map_id ?? ERA_MAP_IDS[eraId];
  const aiCount = pathEra?.ai_count ?? ERA_AI_COUNT[eraId];
  const aiDifficulty = pathEra?.ai_difficulty ?? ERA_AI_DIFFICULTY[eraId];

  const settings: Record<string, unknown> = {
    era: eraId,
    map_id: mapId,
    is_campaign: true,
    campaign_prestige_bonus: prestigePoints,
    player_count: aiCount + 1,
    factions_enabled: true,
    // Display-only fields consumed by the in-game campaign intro modal so the
    // client doesn't need a second round-trip to /api/campaign/list.
    campaign_path_name: pathConfig?.name ?? 'Classic Campaign',
    campaign_era_index: eraIndex,
    campaign_era_count: CAMPAIGN_ERAS.length,
  };

  if (pathConfig) {
    settings.campaign_path_tagline = pathConfig.tagline;
    settings.campaign_signature_carry_label = pathConfig.signature_carry_label;
  }
  if (pathEra?.intro_text) {
    settings.campaign_intro_text = pathEra.intro_text;
  }

  if (pathId) {
    settings.campaign_path_id = pathId;
    if (pathEra?.locked_faction) {
      settings.campaign_locked_faction = pathEra.locked_faction;
    }
    // Inject carry stats for the game engine
    const carryStats: Record<string, number> = {};
    if (pathCarry.survivor_bonus) carryStats.survivor_bonus = pathCarry.survivor_bonus;
    if (pathCarry.revolutionary_spirit) carryStats.revolutionary_spirit = pathCarry.revolutionary_spirit;
    if (Object.keys(carryStats).length > 0) {
      settings.campaign_carry = carryStats;
    }
    if (pathEra?.allowed_victory_conditions) {
      settings.allowed_victory_conditions = pathEra.allowed_victory_conditions;
    }
    if (pathEra?.victory_threshold != null) {
      settings.victory_threshold = pathEra.victory_threshold;
    }
  }

  const gameId = uuidv4();

  await query(
    `INSERT INTO games (game_id, status, game_type, era_id, map_id, settings_json)
     VALUES ($1, 'waiting', 'solo', $2, $3, $4::jsonb)`,
    [gameId, eraId, mapId, JSON.stringify(applyAdminSnapshotsToSettings(settings))],
  );

  // Add human player — with locked faction if path requires it
  const humanFactionId = pathEra?.locked_faction ?? null;
  if (humanFactionId) {
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, faction_id)
       VALUES ($1, $2, 0, $3, false, $4)`,
      [gameId, userId, PLAYER_COLORS[0], humanFactionId],
    );
  } else {
    await query(
      `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai)
       VALUES ($1, $2, 0, $3, false)`,
      [gameId, userId, PLAYER_COLORS[0]],
    );
  }

  // Add AI opponents — with path-specific factions when available
  const aiFactions = pathEra?.ai_factions ?? [];
  for (let i = 1; i <= aiCount; i++) {
    const aiFactionId = aiFactions[i - 1] ?? null;
    if (aiFactionId) {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty, faction_id)
         VALUES ($1, NULL, $2, $3, true, $4, $5)`,
        [gameId, i, PLAYER_COLORS[i], aiDifficulty, aiFactionId],
      );
    } else {
      await query(
        `INSERT INTO game_players (game_id, user_id, player_index, player_color, is_ai, ai_difficulty)
         VALUES ($1, NULL, $2, $3, true, $4)`,
        [gameId, i, PLAYER_COLORS[i], aiDifficulty],
      );
    }
  }

  // Record carry snapshot at era start. On retry, update game_id so completion handler can find it.
  await query(
    `INSERT INTO campaign_entries (id, campaign_id, era_id, game_id, won, completed_at, faction_id, map_id_override, carry_snapshot)
     VALUES (gen_random_uuid(), $1, $2, $3, false, NOW(), $4, $5, $6::jsonb)
     ON CONFLICT (campaign_id, era_id) DO UPDATE
       SET game_id = EXCLUDED.game_id, won = false, completed_at = NOW(),
           faction_id = EXCLUDED.faction_id, carry_snapshot = EXCLUDED.carry_snapshot`,
    [
      campaignId,
      eraId,
      gameId,
      humanFactionId,
      pathEra?.map_id !== ERA_MAP_IDS[eraId] ? pathEra?.map_id ?? null : null,
      JSON.stringify(pathCarry),
    ],
  );

  return { gameId, eraId, mapId };
}
