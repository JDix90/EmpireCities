import { describe, it, expect } from 'vitest';
import { buildChallengeRows, getChallengeParams } from './challengeService';
import type { ChallengeCondition } from './challengeService';

const ALL_TYPES: ChallengeCondition['type'][] = [
  'wins', 'ranked_games', 'buildings_built', 'techs_researched',
  'territories_conquered', 'unique_eras_played', 'win_streak', 'daily_streak',
];

describe('buildChallengeRows', () => {
  it('generates exactly 8 challenges for a given month', () => {
    const rows = buildChallengeRows(2026, 5); // June 2026 (0-indexed)
    expect(rows).toHaveLength(8);
  });

  it('generates one challenge per condition type', () => {
    const rows = buildChallengeRows(2026, 5);
    const types = rows.map((r) => JSON.parse(r.condition_json).type);
    expect(types).toEqual(ALL_TYPES);
  });

  it('produces correct challenge_id format', () => {
    const rows = buildChallengeRows(2026, 5); // June = index 5 = 'jun'
    for (const row of rows) {
      expect(row.challenge_id).toMatch(/^jun26_/);
    }

    const decRows = buildChallengeRows(2027, 11); // December 2027
    for (const row of decRows) {
      expect(row.challenge_id).toMatch(/^dec27_/);
    }
  });

  it('sets month field to YYYY-MM-01 format', () => {
    const rows = buildChallengeRows(2026, 5);
    for (const row of rows) {
      expect(row.month).toBe('2026-06-01');
    }
  });

  it('is deterministic — same inputs produce identical output', () => {
    const first = buildChallengeRows(2026, 8);
    const second = buildChallengeRows(2026, 8);
    expect(first).toEqual(second);
  });

  it('produces different challenges for different months', () => {
    const june = buildChallengeRows(2026, 5);
    const july = buildChallengeRows(2026, 6);
    // IDs differ
    expect(june[0].challenge_id).not.toBe(july[0].challenge_id);
    // At least some targets should differ due to difficulty cycling
    const junTargets = june.map((r) => r.target_count);
    const julTargets = july.map((r) => r.target_count);
    expect(junTargets).not.toEqual(julTargets);
  });

  it('fills in {target} placeholder in descriptions', () => {
    const rows = buildChallengeRows(2026, 5);
    for (const row of rows) {
      expect(row.description).not.toContain('{target}');
      expect(row.description).toMatch(/\d+/); // should have a number
    }
  });

  it('generates valid JSON in condition_json', () => {
    const rows = buildChallengeRows(2026, 5);
    for (const row of rows) {
      const parsed = JSON.parse(row.condition_json);
      expect(parsed).toHaveProperty('type');
      expect(ALL_TYPES).toContain(parsed.type);
    }
  });

  it('has positive reward values for all challenges', () => {
    const rows = buildChallengeRows(2026, 5);
    for (const row of rows) {
      expect(row.target_count).toBeGreaterThan(0);
      expect(row.reward_gold).toBeGreaterThan(0);
      expect(row.reward_xp).toBeGreaterThan(0);
    }
  });
});

describe('getChallengeParams', () => {
  it('tier 0 produces lower targets than tier 5 for all types', () => {
    for (const type of ALL_TYPES) {
      const easy = getChallengeParams(type, 0);
      const hard = getChallengeParams(type, 5);
      expect(easy.target_count).toBeLessThanOrEqual(hard.target_count);
      expect(easy.reward_gold).toBeLessThanOrEqual(hard.reward_gold);
      expect(easy.reward_xp).toBeLessThanOrEqual(hard.reward_xp);
    }
  });

  it('intermediate tiers produce intermediate values', () => {
    for (const type of ALL_TYPES) {
      const t0 = getChallengeParams(type, 0);
      const t3 = getChallengeParams(type, 3);
      const t5 = getChallengeParams(type, 5);
      expect(t3.target_count).toBeGreaterThanOrEqual(t0.target_count);
      expect(t3.target_count).toBeLessThanOrEqual(t5.target_count);
    }
  });

  it('clamps tier above max to tier 5', () => {
    for (const type of ALL_TYPES) {
      const t5 = getChallengeParams(type, 5);
      const t99 = getChallengeParams(type, 99);
      expect(t5).toEqual(t99);
    }
  });
});

describe('difficulty cycling', () => {
  it('cycles every 6 months producing the same difficulty tier', () => {
    // Month 0 (Jan 2026) and month 6 (Jul 2026) should have the same tier
    const jan26 = buildChallengeRows(2026, 0);
    const jul26 = buildChallengeRows(2026, 6);
    // Same target_counts (same tier), different IDs/titles
    expect(jan26.map((r) => r.target_count)).toEqual(jul26.map((r) => r.target_count));
    expect(jan26[0].challenge_id).not.toBe(jul26[0].challenge_id);
  });
});
