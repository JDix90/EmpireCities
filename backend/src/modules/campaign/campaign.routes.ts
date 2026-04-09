import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';

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

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/campaign/start
   * Start a new era campaign for the authenticated user.
   * Fails if they already have an active campaign.
   */
  app.post('/start', { preHandler: [authenticate, rejectGuest] }, async (req, reply) => {
    const userId = (req as any).user.user_id as string;

    const existing = await queryOne<{ campaign_id: string }>(
      `SELECT campaign_id FROM user_campaigns WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    if (existing) {
      return reply.status(409).send({ error: 'Active campaign already in progress' });
    }

    const userRow = await queryOne<{ username: string }>(
      `SELECT username FROM users WHERE user_id = $1`,
      [userId],
    );
    if (!userRow) return reply.status(404).send({ error: 'User not found' });

    const campaignId = uuidv4();
    await query(
      `INSERT INTO user_campaigns (campaign_id, user_id, current_era_index, prestige_points, status)
       VALUES ($1, $2, 0, 0, 'active')`,
      [campaignId, userId],
    );

    const eraId = CAMPAIGN_ERAS[0];
    const mapId = ERA_MAP_IDS[eraId];
    const gameId = uuidv4();
    const settings = {
      era: eraId,
      map_id: mapId,
      is_campaign: true,
      campaign_prestige_bonus: 0,
      player_count: 4,
    };

    await query(
      `INSERT INTO games (game_id, status, game_type, settings_json, created_by)
       VALUES ($1, 'waiting', 'solo', $2::jsonb, $3)`,
      [gameId, JSON.stringify(settings), userId],
    );

    await query(
      `INSERT INTO campaign_entries (id, campaign_id, era_id, game_id, won, completed_at)
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())
       ON CONFLICT DO NOTHING`,
      [campaignId, eraId, gameId],
    );

    return reply.status(201).send({
      campaign_id: campaignId,
      current_era: eraId,
      current_era_index: 0,
      prestige_points: 0,
      game_id: gameId,
    });
  });

  /**
   * GET /api/campaign/me
   * Return the active (or most recent) campaign for the authenticated user.
   */
  app.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = (req as any).user.user_id as string;

    const campaign = await queryOne<{
      campaign_id: string;
      current_era_index: number;
      prestige_points: number;
      status: string;
      started_at: string;
      completed_at: string | null;
    }>(
      `SELECT campaign_id, current_era_index, prestige_points, status, started_at, completed_at
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
    }>(
      `SELECT era_id, game_id, won, completed_at
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

    return reply.send({
      campaign_id: campaign.campaign_id,
      status: campaign.status,
      current_era: currentEra,
      current_era_index: currentEraIndex,
      next_era: nextEra,
      prestige_points: campaign.prestige_points,
      started_at: campaign.started_at,
      completed_at: campaign.completed_at,
      eras: CAMPAIGN_ERAS.map((era, idx) => {
        const entry = entries.find((e) => e.era_id === era);
        return {
          era_id: era,
          index: idx,
          won: entry?.won ?? false,
          completed: !!entry,
          game_id: entry?.game_id ?? null,
        };
      }),
    });
  });
}
