import { describe, it, expect } from 'vitest';
import { buildLobbySnapshotPayload, isEndedGameStatus } from './gameSocket';

/**
 * A finished game answers `game:join` with a lobby snapshot.
 *
 * It used to answer with nothing: the handler emits a waiting lobby for
 * 'waiting' and a live room for 'in_progress', and a completed game matched
 * neither. The client could not tell that apart from a server that never
 * replied, so `/game/:id` for a game the player had just finished sat on
 * "Loading lobby…" — a Pre-Game Room screen whose every navigation control is
 * inside `{lobby && …}` and so never rendered — until a 15s timeout swapped it
 * for "the game may no longer exist".
 */
describe('isEndedGameStatus', () => {
  it('covers both ways a game can be over', () => {
    expect(isEndedGameStatus('completed')).toBe(true);
    expect(isEndedGameStatus('abandoned')).toBe(true);
  });

  it('leaves the statuses that already have their own join branch', () => {
    // 'waiting' broadcasts the waiting lobby; 'in_progress' loads the room.
    expect(isEndedGameStatus('waiting')).toBe(false);
    expect(isEndedGameStatus('in_progress')).toBe(false);
  });
});

describe('buildLobbySnapshotPayload', () => {
  const lobby = {
    game: {
      game_id: 'g1',
      era_id: 'ancient',
      map_id: 'era_ancient',
      status: 'completed',
      settings_json: null,
      join_code: null,
      is_ranked: false,
      winner_id: 'u1',
    },
    players: [
      {
        player_index: 0,
        user_id: 'u1',
        username: 'Darth_Jefe',
        player_color: '#e05c4a',
        is_ai: false,
        ai_difficulty: null,
        is_eliminated: false,
        faction_id: null,
      },
      {
        player_index: 1,
        user_id: null,
        username: 'Marshal Okonkwo',
        player_color: '#4aa3e0',
        is_ai: true,
        ai_difficulty: 'medium',
        is_eliminated: true,
        faction_id: null,
      },
    ],
    settings: {},
    humanPlayers: [],
  } as unknown as Parameters<typeof buildLobbySnapshotPayload>[0];

  it('carries the status through — it is what tells the client the match is over', () => {
    expect(buildLobbySnapshotPayload(lobby).status).toBe('completed');
  });

  it('carries the winner so the ended screen can say who won', () => {
    expect(buildLobbySnapshotPayload(lobby).winner_id).toBe('u1');
  });

  it('sends a bot win as null rather than inventing an id', () => {
    // finalizeGame persists NULL for AI winners (bot ids are not UUIDs); the
    // client is told that plainly instead of being handed a made-up value.
    const botWin = { ...lobby, game: { ...lobby.game, winner_id: null } };
    expect(buildLobbySnapshotPayload(botWin).winner_id).toBeNull();
    const legacyRow = { ...lobby, game: { ...lobby.game, winner_id: undefined } };
    expect(buildLobbySnapshotPayload(legacyRow).winner_id).toBeNull();
  });

  it('carries the roster so the ended screen can name who played', () => {
    const payload = buildLobbySnapshotPayload(lobby);
    expect(payload.game_id).toBe('g1');
    expect(payload.players.map((p) => p.username)).toEqual(['Darth_Jefe', 'Marshal Okonkwo']);
    expect(payload.players[1].is_ai).toBe(true);
  });
});
