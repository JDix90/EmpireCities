import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne } from '../../db/postgres';

interface CosmeticRow {
  cosmetic_id: string;
  type: string;
  name: string;
  description: string | null;
  asset_url: string | null;
  price_gems: number;
  is_premium: boolean;
  rarity: string;
  owned: boolean;
}

const BuySchema = z.object({
  cosmetic_id: z.string().min(1),
});

export async function storeRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/store/catalog ───────────────────────────────────────────────
  fastify.get('/catalog', { preHandler: authenticate }, async (request, reply) => {
    const rows = await query<CosmeticRow>(
      `SELECT c.cosmetic_id, c.type, c.name, c.description, c.asset_url,
              COALESCE(c.price_gems, 0) AS price_gems,
              COALESCE(c.is_premium, false) AS is_premium,
              COALESCE(c.rarity, 'common') AS rarity,
              (uc.cosmetic_id IS NOT NULL) AS owned
       FROM cosmetics c
       LEFT JOIN user_cosmetics uc
         ON uc.cosmetic_id = c.cosmetic_id AND uc.user_id = $1
       ORDER BY c.is_premium ASC, c.price_gems ASC, c.name ASC`,
      [request.userId],
    );
    return reply.send({ catalog: rows });
  });

  // ── POST /api/store/buy ──────────────────────────────────────────────────
  fastify.post('/buy', { preHandler: [authenticate, rejectGuest] }, async (request, reply) => {
    const parsed = BuySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { cosmetic_id } = parsed.data;

    // Load cosmetic
    const cosmetic = await queryOne<{ price_gems: number; name: string; rarity: string }>(
      'SELECT price_gems, name, COALESCE(rarity, $2) AS rarity FROM cosmetics WHERE cosmetic_id = $1',
      [cosmetic_id, 'common'],
    );
    if (!cosmetic) {
      return reply.status(404).send({ error: 'Item not found' });
    }

    // Legendary and mythic cosmetics cannot be purchased
    if (cosmetic.rarity === 'legendary' || cosmetic.rarity === 'mythic') {
      return reply.status(403).send({ error: 'This cosmetic can only be earned through achievements or seasonal rewards' });
    }

    // Check already owned
    const alreadyOwned = await queryOne<{ cosmetic_id: string }>(
      'SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2',
      [request.userId, cosmetic_id],
    );
    if (alreadyOwned) {
      return reply.status(409).send({ error: 'You already own this item' });
    }

    // Free items — no gold check
    if (cosmetic.price_gems === 0) {
      await query(
        'INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES ($1, $2)',
        [request.userId, cosmetic_id],
      );
      return reply.send({ message: 'Item added to your collection', cosmetic_id });
    }

    // Check gold balance
    const userRow = await queryOne<{ gold: number }>(
      'SELECT COALESCE(gold, 0) AS gold FROM users WHERE user_id = $1',
      [request.userId],
    );
    if (!userRow) return reply.status(404).send({ error: 'User not found' });
    if (userRow.gold < cosmetic.price_gems) {
      return reply.status(402).send({ error: 'Insufficient gold', required: cosmetic.price_gems, balance: userRow.gold });
    }

    // Deduct gold, grant item, record transaction (all in a single round-trip via CTE)
    await query(
      `WITH deduct AS (
         UPDATE users SET gold = gold - $1 WHERE user_id = $2
       ),
       grant_item AS (
         INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES ($2, $3)
       )
       INSERT INTO gold_transactions (user_id, amount, reason)
       VALUES ($2, $4, $5)`,
      [cosmetic.price_gems, request.userId, cosmetic_id, -cosmetic.price_gems, `Purchased: ${cosmetic.name}`],
    );

    const updatedUser = await queryOne<{ gold: number }>(
      'SELECT COALESCE(gold, 0) AS gold FROM users WHERE user_id = $1',
      [request.userId],
    );

    return reply.send({
      message: 'Purchase successful',
      cosmetic_id,
      new_balance: updatedUser?.gold ?? 0,
    });
  });
}
