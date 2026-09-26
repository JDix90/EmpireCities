import type { PoolClient } from 'pg';

/**
 * Give a player a cosmetic. Idempotent: false when they already own it.
 *
 * It knows nothing about payment. The store pairs it with `spendGold` inside
 * one transaction; another way of paying for an item would pair it with its
 * own charge the same way, without touching the grant.
 */
export async function grantCosmetic(
  client: PoolClient,
  userId: string,
  cosmeticId: string,
): Promise<boolean> {
  const granted = await client.query(
    `INSERT INTO user_cosmetics (user_id, cosmetic_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, cosmetic_id) DO NOTHING
     RETURNING cosmetic_id`,
    [userId, cosmeticId],
  );
  return (granted.rowCount ?? 0) > 0;
}

/**
 * Take `amount` gold and write the ledger row. The balance guard sits in the
 * UPDATE itself, so concurrent spends can't overdraw. Returns the new balance,
 * or null when the balance is short, in which case nothing was written.
 */
export async function spendGold(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
): Promise<number | null> {
  const spent = await client.query<{ gold: number }>(
    `UPDATE users
     SET gold = gold - $1
     WHERE user_id = $2 AND COALESCE(gold, 0) >= $1
     RETURNING gold`,
    [amount, userId],
  );
  if (!spent.rows[0]) return null;
  await client.query(
    `INSERT INTO gold_transactions (user_id, amount, reason)
     VALUES ($1, $2, $3)`,
    [userId, -amount, reason],
  );
  return spent.rows[0].gold;
}
