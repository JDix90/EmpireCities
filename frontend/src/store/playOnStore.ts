import { create } from 'zustand';

/**
 * Play on after a win (`play_on_enabled`): the finished game's offer, the
 * table's vote and how it ended, for the Victory screen's PlayOnPanel.
 *
 * GamePage fills it from the socket (`game:over`'s `play_on`, `game:play_on`,
 * `game:play_on_result`, `game:play_on_refused`), so an answer that lands
 * while the results are still opening is not lost. The server's times arrive
 * as durations and are kept as this browser's clock times.
 */

/** Who may ask, and who would play on (server `PlayOnOfferPayload`). */
export interface PlayOnOffer {
  proposer_ids: string[];
  human_ids: string[];
  bot_count: number;
  /** Local ms after which the winner can no longer ask. */
  expires_at: number;
}

export interface PlayOnVoter {
  player_id: string;
  username: string;
  color: string;
  vote: boolean | null;
}

/** The vote as it stands (server `game:play_on`). */
export interface PlayOnVoteView {
  proposer_id: string;
  proposer_name: string;
  voters: PlayOnVoter[];
  bot_count: number;
  /** Local ms after which a vote still open has failed. */
  expires_at: number;
}

export interface PlayOnResult {
  outcome: 'accepted' | 'declined' | 'expired' | 'failed';
  new_game_id?: string;
}

interface PlayOnState {
  /** The finished game all of this is about. */
  gameId: string | null;
  offer: PlayOnOffer | null;
  vote: PlayOnVoteView | null;
  result: PlayOnResult | null;
  /** This player's ask or answer is on its way to the server. */
  sending: boolean;
  /** A game ended: start over with what it offers. */
  setOffer: (gameId: string, offer: PlayOnOffer | null) => void;
  setVote: (gameId: string, vote: PlayOnVoteView) => void;
  setResult: (gameId: string, result: PlayOnResult) => void;
  setSending: (sending: boolean) => void;
  reset: () => void;
}

const EMPTY = { gameId: null, offer: null, vote: null, result: null, sending: false };

export const usePlayOnStore = create<PlayOnState>((set) => ({
  ...EMPTY,
  setOffer: (gameId, offer) => set({ ...EMPTY, gameId, offer }),
  // An update for another game (a socket still in a room it left) is ignored.
  setVote: (gameId, vote) => set((s) => (s.gameId === gameId && !s.result ? { vote, sending: false } : s)),
  setResult: (gameId, result) => set((s) => (s.gameId === gameId ? { result, sending: false } : s)),
  setSending: (sending) => set({ sending }),
  reset: () => set(EMPTY),
}));
