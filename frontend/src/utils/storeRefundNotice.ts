/**
 * The one-time notice on the store page for players whose items the store
 * retired (migration 044): which items, why, and the gold that came back.
 *
 * The refund's ledger row is its only record, and players can't see their
 * gold history anywhere in the app, so without this a refund reads as an
 * unexplained jump in the balance plus an item missing from the collection.
 *
 * Pure functions with the storage passed in, so the decision is unit-testable
 * (same shape as utils/referralSurvey.ts).
 */

/** One refund, as GET /store/catalog returns it. */
export interface StoreRefund {
  /** The item's name, as the refund's ledger row recorded it. */
  item: string;
  gold: number;
  /** ISO timestamp of the refund. */
  refunded_at: string;
}

/** Per account, so two players sharing a browser each see their own notice. */
export function storeRefundsSeenKey(userId: string): string {
  return `cc-store-refunds-seen-${userId}`;
}

/**
 * Refunds newer than the newest one this account dismissed in this browser.
 * A missing or unreadable stored value means nothing was dismissed yet.
 */
export function unseenStoreRefunds(
  refunds: readonly StoreRefund[],
  storage: Pick<Storage, 'getItem'>,
  userId: string,
): StoreRefund[] {
  let seenUntil = Number.NEGATIVE_INFINITY;
  try {
    const stored = Date.parse(storage.getItem(storeRefundsSeenKey(userId)) ?? '');
    if (Number.isFinite(stored)) seenUntil = stored;
  } catch {
    // Storage unavailable: nothing is remembered, so the notice shows.
  }
  return refunds.filter((r) => Date.parse(r.refunded_at) > seenUntil);
}

/** Remember the newest refund shown so the notice doesn't return. Never throws. */
export function markStoreRefundsSeen(
  refunds: readonly StoreRefund[],
  storage: Pick<Storage, 'setItem'>,
  userId: string,
): void {
  const times = refunds.map((r) => Date.parse(r.refunded_at)).filter(Number.isFinite);
  if (times.length === 0) return;
  try {
    storage.setItem(storeRefundsSeenKey(userId), new Date(Math.max(...times)).toISOString());
  } catch {
    // Storage unavailable: the notice returns next visit, which is harmless.
  }
}

/**
 * "Radar Screen was retired from the store because it had no effect in
 * matches. We refunded the 600 gold you paid." — plural for several items.
 */
export function storeRefundNoticeText(refunds: readonly StoreRefund[]): string {
  const names = refunds.map((r) => r.item);
  const gold = refunds.reduce((sum, r) => sum + r.gold, 0);
  const one = names.length === 1;
  const list = one ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${one ? 'was' : 'were'} retired from the store because ${one ? 'it' : 'they'} had no effect in matches. We refunded the ${gold.toLocaleString()} gold you paid.`;
}
