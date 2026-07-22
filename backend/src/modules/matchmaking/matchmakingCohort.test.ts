/**
 * Unit tests (no DB) for the pure cohort-selection helpers behind multi-size
 * ranked matchmaking: pairOk / isCliqueCompatible / findCohort.
 */
import { describe, it, expect } from 'vitest';
import { pairOk, isCliqueCompatible, findCohort } from './matchmaking.routes';

const CFG = { threshold_base: 100, threshold_wait_bonus_per_30s: 25 };
const NOW = 1_700_000_000_000;

type Overrides = Partial<{
  mu: number;
  phi: number;
  enqueuedMsAgo: number;
  smurf: number;
  stalls: number;
  preferred: number;
}>;

let seq = 0;
function candidate(o: Overrides = {}) {
  seq += 1;
  return {
    id: `q${seq}`,
    user_id: `u${seq}`,
    era_id: 'ancient',
    bucket: 'blitz_120',
    mu: o.mu ?? 1500,
    phi: o.phi ?? 100,
    socket_id: null,
    enqueued_at: new Date(NOW - (o.enqueuedMsAgo ?? 0)),
    smurf_risk_score: o.smurf ?? 0,
    stall_penalties: o.stalls ?? 0,
    preferred_opponents: o.preferred ?? 1,
  };
}

describe('pairOk', () => {
  it('accepts equal-rated players immediately', () => {
    expect(pairOk(candidate(), candidate(), CFG, NOW)).toBe(true);
  });

  it('rejects a mu gap beyond base + max(phi), then accepts once the wait bonus widens it', () => {
    // gap 250 vs threshold 100 + 100 = 200 → rejected fresh...
    const a = candidate({ mu: 1500 });
    const b = candidate({ mu: 1750 });
    expect(pairOk(a, b, CFG, NOW)).toBe(false);
    // ...but 60s of waiting adds 2 × 25 = 50 → threshold 250 → accepted.
    const aWaited = candidate({ mu: 1500, enqueuedMsAgo: 60_000 });
    expect(pairOk(aWaited, b, CFG, NOW)).toBe(true);
  });

  it('blocks a high-smurf-risk vs low-risk pairing until the long-wait override', () => {
    const clean = candidate();
    const smurf = candidate({ smurf: 0.9 });
    expect(pairOk(clean, smurf, CFG, NOW)).toBe(false);
    const cleanWaited = candidate({ enqueuedMsAgo: 120_000 });
    expect(pairOk(cleanWaited, smurf, CFG, NOW)).toBe(true);
  });
});

describe('findCohort', () => {
  it('need=2 finds the first compatible pair (historical 1v1 behavior)', () => {
    const a = candidate({ mu: 1500 });
    const b = candidate({ mu: 2400 }); // incompatible with everyone
    const c = candidate({ mu: 1520 });
    const cohort = findCohort([a, b, c], 2, CFG, NOW);
    expect(cohort?.map((p) => p.user_id)).toEqual([a.user_id, c.user_id]);
  });

  it('need=4 greedily fills from the longest-waiting anchor', () => {
    const players = [
      candidate({ mu: 1500, enqueuedMsAgo: 90_000 }),
      candidate({ mu: 1540, enqueuedMsAgo: 60_000 }),
      candidate({ mu: 1460, enqueuedMsAgo: 30_000 }),
      candidate({ mu: 1510 }),
    ];
    const cohort = findCohort(players, 4, CFG, NOW);
    expect(cohort).toHaveLength(4);
  });

  it('returns null when fewer candidates than needed', () => {
    expect(findCohort([candidate(), candidate()], 3, CFG, NOW)).toBeNull();
  });

  it('skips an incompatible member and completes the cohort from later candidates', () => {
    const outlier = candidate({ mu: 2400 });
    const players = [
      candidate({ mu: 1500, enqueuedMsAgo: 60_000 }),
      outlier,
      candidate({ mu: 1520, enqueuedMsAgo: 30_000 }),
      candidate({ mu: 1490 }),
    ];
    const cohort = findCohort(players, 3, CFG, NOW);
    expect(cohort).toHaveLength(3);
    expect(cohort?.some((p) => p.user_id === outlier.user_id)).toBe(false);
  });

  it('falls back to a later anchor when the oldest cannot seed a full cohort', () => {
    // Anchor A is only compatible with B; B/C/D are mutually close.
    const a = candidate({ mu: 1200, phi: 50 });
    const b = candidate({ mu: 1300, phi: 50 });
    const c = candidate({ mu: 1400, phi: 50 });
    const d = candidate({ mu: 1390, phi: 50 });
    const cohort = findCohort([a, b, c, d], 3, CFG, NOW);
    expect(cohort?.map((p) => p.user_id)).toEqual([b.user_id, c.user_id, d.user_id]);
  });
});

describe('isCliqueCompatible', () => {
  it('accepts a tight group and rejects when any single pair is out of range', () => {
    const tight = [candidate({ mu: 1500 }), candidate({ mu: 1550 }), candidate({ mu: 1450 })];
    expect(isCliqueCompatible(tight, CFG, NOW)).toBe(true);
    const withOutlier = [...tight, candidate({ mu: 2400 })];
    expect(isCliqueCompatible(withOutlier, CFG, NOW)).toBe(false);
  });
});
