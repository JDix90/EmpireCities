import { describe, it, expect } from 'vitest';
import {
  markStoreRefundsSeen,
  storeRefundNoticeText,
  storeRefundsSeenKey,
  unseenStoreRefunds,
  type StoreRefund,
} from './storeRefundNotice';

const RADAR: StoreRefund = { item: 'Radar Screen', gold: 600, refunded_at: '2026-09-27T03:00:00.000Z' };
const SHERMAN: StoreRefund = { item: 'Sherman Tank', gold: 350, refunded_at: '2026-09-27T03:00:00.000Z' };
const ROMAN: StoreRefund = { item: 'Roman Legionary', gold: 300, refunded_at: '2026-09-27T03:00:00.000Z' };

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('store refund notice', () => {
  it('shows every refund until the player dismisses it', () => {
    expect(unseenStoreRefunds([RADAR, SHERMAN], memoryStorage(), 'u1')).toEqual([RADAR, SHERMAN]);
  });

  it('stays dismissed for that account, and only that account', () => {
    const storage = memoryStorage();
    markStoreRefundsSeen([RADAR, SHERMAN], storage, 'u1');

    expect(storage.data.get(storeRefundsSeenKey('u1'))).toBe(RADAR.refunded_at);
    expect(unseenStoreRefunds([RADAR, SHERMAN], storage, 'u1')).toEqual([]);
    expect(unseenStoreRefunds([RADAR, SHERMAN], storage, 'u2')).toEqual([RADAR, SHERMAN]);
  });

  it('shows a later refund after an earlier one was dismissed', () => {
    const storage = memoryStorage({ [storeRefundsSeenKey('u1')]: '2026-09-01T00:00:00.000Z' });
    expect(unseenStoreRefunds([RADAR], storage, 'u1')).toEqual([RADAR]);
  });

  it('treats an unreadable stored value, or unusable storage, as nothing dismissed', () => {
    const corrupt = memoryStorage({ [storeRefundsSeenKey('u1')]: 'not a date' });
    expect(unseenStoreRefunds([RADAR], corrupt, 'u1')).toEqual([RADAR]);

    const throwing = { getItem: () => { throw new Error('SecurityError'); } };
    expect(unseenStoreRefunds([RADAR], throwing, 'u1')).toEqual([RADAR]);
    expect(() => markStoreRefundsSeen([RADAR], { setItem: () => { throw new Error('QuotaExceeded'); } }, 'u1'))
      .not.toThrow();
  });

  it('names the items, says why, and totals the gold', () => {
    expect(storeRefundNoticeText([RADAR])).toBe(
      'Radar Screen was retired from the store because it had no effect in matches. We refunded the 600 gold you paid.',
    );
    expect(storeRefundNoticeText([RADAR, SHERMAN])).toBe(
      'Radar Screen and Sherman Tank were retired from the store because they had no effect in matches. We refunded the 950 gold you paid.',
    );
    expect(storeRefundNoticeText([ROMAN, RADAR, SHERMAN])).toBe(
      'Roman Legionary, Radar Screen and Sherman Tank were retired from the store because they had no effect in matches. ' +
        `We refunded the ${(1250).toLocaleString()} gold you paid.`,
    );
  });
});
