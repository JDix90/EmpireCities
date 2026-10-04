import { describe, it, expect } from 'vitest';
import { aiPlayerName, drawAiCommanders } from '@borderfall/shared';
import { nameLiveGameSeats } from './liveGameNames';

const seats = () => [
  { username: 'alice', player_index: 0, is_ai: false },
  { username: null, player_index: 1, is_ai: true },
  { username: null, player_index: 2, is_ai: true },
  { username: null, player_index: 3, is_ai: false },
];

describe('the live games list\'s seat names', () => {
  it('names bots by seat, as before, in a game without commanders', () => {
    const players = seats();
    nameLiveGameSeats('g', undefined, players);
    expect(players.map((p) => p.username)).toEqual(['alice', aiPlayerName(1), aiPlayerName(2), 'Player']);
  });

  it('names them by the commanders their game drew', () => {
    const players = seats();
    nameLiveGameSeats('g', true, players);
    const drawn = drawAiCommanders('g', [1, 2]);
    expect(players.map((p) => p.username)).toEqual(['alice', `${drawn[1]!.name} (AI)`, `${drawn[2]!.name} (AI)`, 'Player']);
  });
});
