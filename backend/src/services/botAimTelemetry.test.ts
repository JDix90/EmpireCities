import { describe, it, expect } from 'vitest';
import type { GameState } from '../types';
import {
  botAimProperties,
  botAimStandings,
  countBotCapture,
  emptyBotAimCounts,
} from './botAimTelemetry';

const BOT = 'bot';

/** Seats by id (a human unless `bot` is in its id), each holding `held[id]` tiles. */
function board(held: Record<string, number>, extras: Partial<GameState> = {}, out: string[] = []): GameState {
  const territories: Record<string, { territory_id: string; owner_id: string | null; unit_count: number }> = {};
  let n = 0;
  for (const [owner, count] of Object.entries(held)) {
    for (let i = 0; i < count; i += 1) {
      const id = `t${(n += 1)}`;
      territories[id] = { territory_id: id, owner_id: owner === 'neutral' ? null : owner, unit_count: 1 };
    }
  }
  const players = Object.keys(held)
    .filter((id) => id !== 'neutral')
    .map((id, i) => ({ player_id: id, player_index: i, is_ai: id.includes('bot'), is_eliminated: out.includes(id) }));
  return { players, territories, turn_number: 5, current_player_index: 0, ...extras } as unknown as GameState;
}

describe('botAimStandings', () => {
  it('reads the leading and weakest rivals by territories held, leaving out the bot itself', () => {
    const s = botAimStandings(board({ [BOT]: 20, human: 9, bot2: 4, bot3: 6, neutral: 5 }), BOT);
    expect([...s.leaders]).toEqual(['human']);
    expect([...s.weakest]).toEqual(['bot2']);
  });

  it('keeps every rival tied for the most or the fewest', () => {
    const s = botAimStandings(board({ [BOT]: 3, human: 5, bot2: 5, bot3: 2, bot4: 2 }), BOT);
    expect([...s.leaders].sort()).toEqual(['bot2', 'human']);
    expect([...s.weakest].sort()).toEqual(['bot3', 'bot4']);
  });

  it('leaves out players who are out and the bot\'s allies', () => {
    const state = board(
      { [BOT]: 5, human: 3, ally_bot: 9, out_bot: 0, bot2: 4 },
      { teams: [{ team_id: 'blue', player_ids: [BOT, 'ally_bot'] }] } as unknown as Partial<GameState>,
      ['out_bot'],
    );
    const s = botAimStandings(state, BOT);
    expect([...s.leaders]).toEqual(['bot2']);
    expect([...s.weakest]).toEqual(['human']);
  });

  it('makes a last rival both the leader and the weakest, and finds none when no rival is left', () => {
    const duel = botAimStandings(board({ [BOT]: 10, human: 2 }), BOT);
    expect([...duel.leaders]).toEqual(['human']);
    expect([...duel.weakest]).toEqual(['human']);
    const alone = botAimStandings(board({ [BOT]: 10, human: 0 }, {}, ['human']), BOT);
    expect(alone.leaders.size + alone.weakest.size).toBe(0);
  });
});

describe('countBotCapture', () => {
  it('counts every capture from a player, and which were a human\'s, the leader\'s and the weakest\'s', () => {
    const standings = { leaders: new Set(['human']), weakest: new Set(['bot2']) };
    const counts = emptyBotAimCounts();
    countBotCapture(counts, standings, { player_id: 'human', is_ai: false });
    countBotCapture(counts, standings, { player_id: 'bot2', is_ai: true });
    countBotCapture(counts, standings, { player_id: 'bot3', is_ai: true });
    expect(counts).toEqual({ from_players: 3, from_humans: 1, from_leader: 1, from_weakest: 1 });
  });
});

describe('botAimProperties', () => {
  it('names the counts for game_finished, and reads zeros where the bots took nothing', () => {
    expect(botAimProperties({ from_players: 7, from_humans: 3, from_leader: 2, from_weakest: 4 })).toEqual({
      ai_captures_from_players: 7,
      ai_captures_from_humans: 3,
      ai_captures_from_leader: 2,
      ai_captures_from_weakest: 4,
    });
    expect(botAimProperties(undefined)).toEqual({
      ai_captures_from_players: 0,
      ai_captures_from_humans: 0,
      ai_captures_from_leader: 0,
      ai_captures_from_weakest: 0,
    });
  });
});
