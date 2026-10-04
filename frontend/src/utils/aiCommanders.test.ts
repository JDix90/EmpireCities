import { describe, it, expect } from 'vitest';
import { aiPlayerName, drawAiCommanders } from '@borderfall/shared';
import { lobbyBotName, lobbyCommanders } from './aiCommanders';

const players = [
  { player_index: 0, is_ai: false, ai_difficulty: null },
  { player_index: 1, is_ai: true, ai_difficulty: 'hard' },
  { player_index: 2, is_ai: true, ai_difficulty: 'easy' },
];

describe('the commanders a waiting game will seat', () => {
  it('are none for a game made without them', () => {
    expect(lobbyCommanders({ game_id: 'g', settings_json: {}, players })).toBeNull();
    expect(lobbyCommanders({ game_id: 'g', settings_json: null, players })).toBeNull();
    expect(lobbyCommanders(null)).toBeNull();
    expect(lobbyBotName(1, null)).toBe(aiPlayerName(1));
  });

  it('are the draw the server makes as the game starts, with no style below Medium', () => {
    const drawn = drawAiCommanders('g', [1, 2]);
    const commanders = lobbyCommanders({ game_id: 'g', settings_json: { ai_personalities: true }, players });
    expect(commanders).toEqual({
      1: { name: `${drawn[1]!.name} (AI)`, style: drawn[1]!.style },
      2: { name: `${drawn[2]!.name} (AI)`, style: null },
    });
    expect(lobbyBotName(1, commanders)).toBe(`${drawn[1]!.name} (AI)`);
  });
});
