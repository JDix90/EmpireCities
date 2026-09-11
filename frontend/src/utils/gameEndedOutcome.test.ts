import { describe, it, expect } from 'vitest';
import { describeEndedOutcome, type EndedOutcomeInput } from './gameEndedOutcome';
import type { GameLobbyPlayerRow } from '../types/gameLobbyApi';

const row = (over: Partial<GameLobbyPlayerRow>): GameLobbyPlayerRow => ({
  player_index: 0,
  user_id: null,
  username: null,
  player_color: '#fff',
  is_ai: false,
  ai_difficulty: null,
  is_eliminated: false,
  ...over,
});
const me = row({ player_index: 0, user_id: 'me', username: 'Darth_Jefe' });
const rival = row({ player_index: 1, user_id: 'u2', username: 'Ada' });
const bot = row({ player_index: 2, user_id: null, username: null, is_ai: true, ai_difficulty: 'medium' });
const displayName = (p: GameLobbyPlayerRow) => (p.is_ai ? `Bot ${p.player_index}` : p.username ?? 'Player');

const input = (over: Partial<EndedOutcomeInput>): EndedOutcomeInput => ({
  status: 'completed',
  winnerId: null,
  players: [me, rival, bot],
  viewerId: 'me',
  displayName,
  ...over,
});

describe('describeEndedOutcome', () => {
  it('speaks to the viewer when they won', () => {
    expect(describeEndedOutcome(input({ winnerId: 'me' }))).toBe('You won this one.');
  });

  it("names another human winner with the page's own naming rule", () => {
    expect(describeEndedOutcome(input({ winnerId: 'u2' }))).toBe('Ada won.');
  });

  it('reads a null winner on a completed game with bots as a bot win', () => {
    // finalizeGame persists NULL for AI winners; that is the whole signal.
    expect(describeEndedOutcome(input({ winnerId: null }))).toBe('An AI commander took this one.');
  });

  it('says nothing it cannot back up', () => {
    // No winner and no bots: whatever happened, guessing would be worse than
    // the generic copy.
    expect(describeEndedOutcome(input({ winnerId: null, players: [me, rival] }))).toBeNull();
    // A winner id that is not on the roster.
    expect(describeEndedOutcome(input({ winnerId: 'ghost' }))).toBeNull();
  });

  it('has no result for a match that was not played out', () => {
    expect(describeEndedOutcome(input({ status: 'abandoned', winnerId: 'me' }))).toBeNull();
    expect(describeEndedOutcome(input({ status: 'waiting' }))).toBeNull();
  });

  it('does not call a signed-out viewer the winner', () => {
    expect(describeEndedOutcome(input({ winnerId: 'me', viewerId: null }))).toBe('Darth_Jefe won.');
  });
});
