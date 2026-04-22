import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne, withTransaction } from '../../db/postgres';

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
  cosmetic_id: z.string().min(1).max(128),
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

    // Free items — no gold check, but still need atomic "insert if not owned".
    if (cosmetic.price_gems === 0) {
      const inserted = await query<{ cosmetic_id: string }>(
        `INSERT INTO user_cosmetics (user_id, cosmetic_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, cosmetic_id) DO NOTHING
         RETURNING cosmetic_id`,
        [request.userId, cosmetic_id],
      );
      if (inserted.length === 0) {
        return reply.status(409).send({ error: 'You already own this item' });
      }
      return reply.send({ message: 'Item added to your collection', cosmetic_id });
    }

    // Paid purchase: run the whole flow inside a transaction so the balance
    // check, deduction, grant, and audit log are atomic against concurrent
    // requests. The UPDATE has an explicit `gold >= $price` guard so a race
    // that slips past the pre-check still can't overdraw.
    try {
      const result = await withTransaction(async (client) => {
        // Insert grant first; if already owned, bail out early so we never
        // charge for a cosmetic the user already has.
        const grant = await client.query<{ cosmetic_id: string }>(
          `INSERT INTO user_cosmetics (user_id, cosmetic_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, cosmetic_id) DO NOTHING
           RETURNING cosmetic_id`,
          [request.userId, cosmetic_id],
        );
        if (grant.rowCount === 0) {
          return { code: 'already_owned' as const };
        }

        const deduct = await client.query<{ gold: number }>(
          `UPDATE users
           SET gold = gold - $1
           WHERE user_id = $2 AND COALESCE(gold, 0) >= $1
           RETURNING gold`,
          [cosmetic.price_gems, request.userId],
        );
        if (deduct.rowCount === 0) {
          return { code: 'insufficient_gold' as const };
        }

        await client.query(
          `INSERT INTO gold_transactions (user_id, amount, reason)
           VALUES ($1, $2, $3)`,
          [request.userId, -cosmetic.price_gems, `Purchased: ${cosmetic.name}`],
        );

        return { code: 'ok' as const, gold: deduct.rows[0].gold };
      });

      if (result.code === 'already_owned') {
        return reply.status(409).send({ error: 'You already own this item' });
      }
      if (result.code === 'insufficient_gold') {
        const bal = await queryOne<{ gold: number }>(
          'SELECT COALESCE(gold, 0) AS gold FROM users WHERE user_id = $1',
          [request.userId],
        );
        return reply.status(402).send({
          error: 'Insufficient gold',
          required: cosmetic.price_gems,
          balance: bal?.gold ?? 0,
        });
      }

      return reply.send({
        message: 'Purchase successful',
        cosmetic_id,
        new_balance: result.gold,
      });
    } catch (err) {
      request.log.error({ err, userId: request.userId, cosmetic_id }, 'store purchase failed');
      return reply.status(500).send({ error: 'Purchase failed' });
    }
  });
}
