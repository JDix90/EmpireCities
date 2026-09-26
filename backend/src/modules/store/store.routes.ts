import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { rejectGuest } from '../../middleware/rejectGuest';
import { query, queryOne, withTransaction } from '../../db/postgres';
import { formatZodError } from '../../utils/formatZodError';
import { grantCosmetic, spendGold } from './purchase';

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
  /** Earned through gameplay (levels, seasons, achievements, …) — never claimable in the store. */
  earned_only: boolean;
  /** True when the item isn't owned and the store doesn't sell it (earned-only, legendary/mythic, or unpriced). */
  locked: boolean;
}

interface StoreRefundRow {
  item: string;
  gold: number;
  refunded_at: Date;
}

const BuySchema = z.object({
  cosmetic_id: z.string().min(1).max(128),
});

type PurchaseOutcome =
  | { code: 'ok'; gold: number }
  | { code: 'already_owned' }
  | { code: 'insufficient_gold' };

/** Thrown inside the purchase transaction so a refused purchase rolls back. */
class PurchaseRefused extends Error {
  constructor(readonly code: 'already_owned' | 'insufficient_gold') {
    super(code);
  }
}

export async function storeRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/store/catalog ───────────────────────────────────────────────
  fastify.get('/catalog', { preHandler: authenticate }, async (request, reply) => {
    const rows = await query<CosmeticRow>(
      `SELECT c.cosmetic_id, c.type, c.name, c.description, c.asset_url,
              COALESCE(c.price_gems, 0) AS price_gems,
              COALESCE(c.is_premium, false) AS is_premium,
              COALESCE(c.rarity, 'common') AS rarity,
              COALESCE(c.earned_only, false) AS earned_only,
              (uc.cosmetic_id IS NOT NULL) AS owned,
              (
                uc.cosmetic_id IS NULL
                AND (COALESCE(c.earned_only, false)
                     OR COALESCE(c.rarity, 'common') IN ('legendary', 'mythic')
                     OR COALESCE(c.price_gems, 0) <= 0)
              ) AS locked
       FROM cosmetics c
       LEFT JOIN user_cosmetics uc
         ON uc.cosmetic_id = c.cosmetic_id AND uc.user_id = $1
       ORDER BY c.is_premium ASC, c.price_gems ASC, c.name ASC`,
      [request.userId],
    );
    // Items the store retired (migration 044) and refunded, for the store
    // page's one-time notice. The ledger row is the only record, and players
    // can't see their gold history anywhere else in the app.
    const refunds = await query<StoreRefundRow>(
      `SELECT substring(reason FROM '^Refund: (.*) \\(retired from the store\\)$') AS item,
              amount AS gold, created_at AS refunded_at
       FROM gold_transactions
       WHERE user_id = $1 AND reason LIKE 'Refund: % (retired from the store)'
       ORDER BY created_at, reason`,
      [request.userId],
    );
    return reply.send({ catalog: rows, refunds });
  });

  // ── POST /api/store/buy ──────────────────────────────────────────────────
  fastify.post('/buy', { preHandler: [authenticate, rejectGuest], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = BuySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send(formatZodError(parsed.error));
    }
    const { cosmetic_id } = parsed.data;

    // Load cosmetic
    const cosmetic = await queryOne<{ price_gems: number; name: string; rarity: string; earned_only: boolean }>(
      'SELECT price_gems, name, COALESCE(rarity, $2) AS rarity, COALESCE(earned_only, false) AS earned_only FROM cosmetics WHERE cosmetic_id = $1',
      [cosmetic_id, 'common'],
    );
    if (!cosmetic) {
      return reply.status(404).send({ error: 'Item not found' });
    }

    // Legendary and mythic cosmetics cannot be purchased
    if (cosmetic.rarity === 'legendary' || cosmetic.rarity === 'mythic') {
      return reply.status(403).send({ error: 'This cosmetic can only be earned through achievements or seasonal rewards' });
    }

    // Earned-only cosmetics (level/season/prestige/rating/achievement rewards)
    // are granted exclusively by gameplay services — never via the store. This
    // is the single authoritative gate that closes the free-claim bypass; the
    // services that award these still INSERT into user_cosmetics directly.
    if (cosmetic.earned_only) {
      return reply.status(403).send({ error: 'This item is earned through gameplay, not the store' });
    }

    // The store only sells priced items. Its free-claim path is gone with the
    // starter items it served (migration 044); twice it handed out rewards
    // meant to be earned, so a free item is refused rather than granted.
    if (cosmetic.price_gems <= 0) {
      return reply.status(403).send({ error: 'This item is not sold in the store' });
    }

    // Paid purchase: the grant and the charge run in one transaction, so
    // either both happen or neither does. The grant goes first so an owner is
    // never charged twice, and the charge's `gold >= price` guard stops a
    // concurrent spend from overdrawing. A refusal must THROW to roll the grant
    // back: returning from the callback commits, which is how a short balance
    // used to answer 402 and still leave the item granted.
    try {
      const result = await withTransaction<PurchaseOutcome>(async (client) => {
        if (!(await grantCosmetic(client, request.userId, cosmetic_id))) {
          throw new PurchaseRefused('already_owned');
        }
        const gold = await spendGold(
          client, request.userId, cosmetic.price_gems, `Purchased: ${cosmetic.name}`,
        );
        if (gold === null) throw new PurchaseRefused('insufficient_gold');
        return { code: 'ok', gold };
      }).catch((err: unknown): PurchaseOutcome => {
        if (err instanceof PurchaseRefused) return { code: err.code };
        throw err;
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
