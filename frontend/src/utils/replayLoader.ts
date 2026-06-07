import { api } from '../services/api';
import type { GameState } from '../store/gameStore';

export interface ReplaySnapshot {
  turn_number: number;
  state: GameState;
}

export interface PublicReplayPlayer {
  user_id: string | null;
  username: string;
  player_color: string;
  is_ai: boolean;
}

export interface LoadedReplay {
  snapshots: ReplaySnapshot[];
  /** True when the data came from the unauthenticated public-replay endpoint. */
  isPublic: boolean;
  players?: PublicReplayPlayer[];
  era_id?: string;
  winner_id?: string;
}

/** Raised when a replay exists but is not viewable by the requester. */
export class ReplayNotPublicError extends Error {
  constructor() {
    super('Replay is not public');
    this.name = 'ReplayNotPublicError';
  }
}

// Safety cap: 40 pages × 500 rows = 20k snapshots. Long enough for any real
// match, bounded so a misbehaving backend can't spin the client forever.
const MAX_PAGES = 40;
const PARTICIPANT_LIMIT = 200;
const PUBLIC_LIMIT = 500;

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Authenticated participant endpoint. Returns `{ snapshots }` and caps each
 * request at 200 rows. `from` is a 0-based row offset, so we advance by the
 * number of rows received — every snapshot is returned exactly once.
 */
async function loadParticipantReplay(gameId: string, retries: number): Promise<ReplaySnapshot[]> {
  const all: ReplaySnapshot[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let batch: ReplaySnapshot[] = [];
    for (let attempt = retries; attempt >= 1; attempt--) {
      try {
        const res = await api.get<{ snapshots: ReplaySnapshot[] }>(
          `/games/${gameId}/replay`,
          { params: { from, limit: PARTICIPANT_LIMIT } },
        );
        batch = res.data.snapshots ?? [];
        break;
      } catch (err) {
        const status = httpStatus(err);
        // Snapshot writes can lag a fresh game:over; retry transient misses.
        if (attempt > 1 && (status === 404 || status === 503)) {
          await delay(2000);
          continue;
        }
        throw err;
      }
    }
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PARTICIPANT_LIMIT) break; // last (partial) page
    from += batch.length;
  }
  return all;
}

interface PublicReplayResponse {
  era_id?: string;
  winner_id?: string;
  players?: PublicReplayPlayer[];
  snapshots: ReplaySnapshot[];
  pagination?: { next_from: number | null };
}

/** Unauthenticated public endpoint; follows `pagination.next_from` (row offset). */
async function loadPublicReplay(gameId: string, retries: number): Promise<LoadedReplay> {
  const all: ReplaySnapshot[] = [];
  let from = 0;
  let players: PublicReplayPlayer[] | undefined;
  let eraId: string | undefined;
  let winnerId: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    let data: PublicReplayResponse | null = null;
    for (let attempt = retries; attempt >= 1; attempt--) {
      try {
        const res = await api.get<PublicReplayResponse>(
          `/share/${gameId}/public-replay`,
          { params: { from, limit: PUBLIC_LIMIT } },
        );
        data = res.data;
        break;
      } catch (err) {
        const status = httpStatus(err);
        if (status === 403) throw new ReplayNotPublicError();
        if (attempt > 1 && (status === 404 || status === 503 || status === 409)) {
          await delay(2000);
          continue;
        }
        throw err;
      }
    }
    if (!data) break;
    players = data.players ?? players;
    eraId = data.era_id ?? eraId;
    winnerId = data.winner_id ?? winnerId;
    all.push(...(data.snapshots ?? []));
    const next = data.pagination?.next_from ?? null;
    if (next == null || next <= from) break;
    from = next;
  }

  return { snapshots: all, isPublic: true, players, era_id: eraId, winner_id: winnerId };
}

/**
 * Load every snapshot for a replay.
 *
 * Authenticated participants get the full (private) replay. Logged-out viewers
 * and authenticated non-participants fall back to the public endpoint, which
 * only succeeds when the owner flipped `is_replay_public`. Throws
 * `ReplayNotPublicError` when no viewable data is available.
 */
export async function loadReplaySnapshots(
  gameId: string,
  opts: { authenticated: boolean; retries?: number },
): Promise<LoadedReplay> {
  const retries = opts.retries ?? 3;

  if (opts.authenticated) {
    try {
      const snapshots = await loadParticipantReplay(gameId, retries);
      if (snapshots.length > 0) return { snapshots, isPublic: false };
      // Empty result (e.g. abandoned with no rows) — try the public path.
    } catch (err) {
      const status = httpStatus(err);
      // 403 = not a participant. 401 = stale/expired session that couldn't be
      // refreshed; the viewer may still be able to watch a public replay, so
      // fall back rather than dead-ending. Other errors propagate.
      if (status !== 403 && status !== 401) throw err;
    }
  }

  return loadPublicReplay(gameId, retries);
}
