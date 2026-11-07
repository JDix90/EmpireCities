import { describe, it, expect } from 'vitest';
import {
  CAMPAIGN_START_GATE,
  CAMPAIGN_START_GATE_SAVE,
  CAMPAIGN_START_GATE_V2,
  accountBoardsPerk,
  leaderboardGuestRankedNotice,
  withGuestsRanked,
} from './guestGate';

/** Once guests are ranked (guest_leaderboards_enabled), no copy may offer a leaderboard place as an account-only perk. */
const offersBoardPlace = (text: string) => /leaderboard|on the boards/i.test(text);

describe('guest copy once guests are ranked on the leaderboards', () => {
  it('drops the leaderboard place from every campaign gate, and keeps the rest', () => {
    for (const gate of [CAMPAIGN_START_GATE, CAMPAIGN_START_GATE_V2, CAMPAIGN_START_GATE_SAVE]) {
      expect(gate.bullets.some(offersBoardPlace)).toBe(true);
      const ranked = withGuestsRanked(gate);
      expect(ranked.bullets.some(offersBoardPlace)).toBe(false);
      expect(ranked.title).toBe(gate.title);
      expect(ranked.body).toBe(gate.body);
    }
    expect(withGuestsRanked(CAMPAIGN_START_GATE).bullets).toHaveLength(CAMPAIGN_START_GATE.bullets.length - 1);
    expect(withGuestsRanked(CAMPAIGN_START_GATE_SAVE).bullets).toContain('Compete in ranked and play with friends.');
  });

  it('names ranked play and the Daily Challenge board as what an account adds', () => {
    expect(accountBoardsPerk(false)).toMatch(/leaderboards/);
    expect(accountBoardsPerk(true)).toBe('Play ranked and get on the Daily Challenge board.');
  });

  it('tells a guest on /leaderboards that they are on the boards, in each wording', () => {
    for (const [v2, save] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const notice = leaderboardGuestRankedNotice(v2, save);
      expect(notice.title).toBe('You are on the boards as a guest');
      expect(notice.body).not.toMatch(/never ranked|do not appear/);
      expect(notice.body).toMatch(/ranked/);
    }
  });
});
