/**
 * The digest of a bot's turn (ai_intents_enabled): one line for the player on
 * what the bot just did, and, below Expert, what it was going for.
 *
 * Built from the board before and after the turn, so it covers every way a
 * tile changes hands (an attack, an influence, a bomb), and it reads only
 * what every player sees anyway: who holds what. Never a garrison's size, so
 * it gives nothing away under fog of war. The live game sends it to the room
 * as `game:ai_turn_digest` once the turn is played and before it is handed
 * on (gameSocket.ts processAiTurn); the client words it.
 *
 * The goal (ai/aiIntent.ts) is the bot's own plan, so how much of it is told
 * falls with the level, as the panel asked: below Expert the digest names the
 * goal the bot played this turn; Expert only reports what it did
 * (`announcesIntent`, ai/aiProfiles.ts).
 */
import type { AiIntent, GameMap, GameState, PlayerState } from '../../types';
import { aiProfile, type AiLevel } from './aiProfiles';

/** Who held what, and who was still in, as the turn began. */
export interface AiTurnSnapshot {
  owners: Record<string, string | null>;
  eliminated: string[];
}

export interface AiTurnDigest {
  playerId: string;
  turnNumber: number;
  /** Territories it took this turn, and from whom (null: neutral ground). */
  taken: Array<{ territoryId: string; fromPlayerId: string | null }>;
  /** Regions it completed this turn. */
  regionsTaken: Array<{ regionId: string; name: string }>;
  /** Rivals' whole regions it broke into this turn. */
  regionsBroken: Array<{ regionId: string; name: string; fromPlayerId: string }>;
  /** Players it knocked out this turn. */
  eliminated: string[];
  /** The goal it played this turn, at levels that tell it. */
  goal?: { kind: AiIntent['kind']; target: string; name: string };
}

export function snapshotForDigest(state: GameState): AiTurnSnapshot {
  return {
    owners: Object.fromEntries(Object.entries(state.territories).map(([id, t]) => [id, t.owner_id ?? null])),
    eliminated: state.players.filter((p) => p.is_eliminated).map((p) => p.player_id),
  };
}

export function buildAiTurnDigest(
  before: AiTurnSnapshot,
  state: GameState,
  map: GameMap,
  player: PlayerState,
  difficulty: AiLevel,
): AiTurnDigest {
  const me = player.player_id;
  const taken: AiTurnDigest['taken'] = [];
  for (const [id, t] of Object.entries(state.territories)) {
    const was = before.owners[id] ?? null;
    if (t.owner_id === me && was !== me) taken.push({ territoryId: id, fromPlayerId: was });
  }
  const tookTile = new Set(taken.map((t) => t.territoryId));

  const regionsTaken: AiTurnDigest['regionsTaken'] = [];
  const regionsBroken: AiTurnDigest['regionsBroken'] = [];
  for (const region of map.regions) {
    // Only the territories in play, as the region bonus counts them.
    const tiles = map.territories
      .filter((t) => t.region_id === region.region_id && state.territories[t.territory_id])
      .map((t) => t.territory_id);
    if (tiles.length === 0) continue;
    const wasHeld = tiles.map((id) => before.owners[id] ?? null);
    const holder = wasHeld[0];
    if (tiles.every((id) => state.territories[id]!.owner_id === me) && !wasHeld.every((o) => o === me)) {
      regionsTaken.push({ regionId: region.region_id, name: region.name });
    } else if (
      holder && holder !== me && wasHeld.every((o) => o === holder)
      && tiles.some((id) => tookTile.has(id))
    ) {
      regionsBroken.push({ regionId: region.region_id, name: region.name, fromPlayerId: holder });
    }
  }

  const eliminated = state.players
    .filter((p) => p.is_eliminated && !before.eliminated.includes(p.player_id) && p.player_id !== me)
    .map((p) => p.player_id);

  const digest: AiTurnDigest = {
    playerId: me,
    turnNumber: state.turn_number,
    taken,
    regionsTaken,
    regionsBroken,
    eliminated,
  };
  const intent = player.ai_intent;
  if (intent && aiProfile(difficulty).announcesIntent) {
    const name = intent.kind === 'hunt'
      ? state.players.find((p) => p.player_id === intent.target)?.username
      : map.regions.find((r) => r.region_id === intent.target)?.name;
    if (name) digest.goal = { kind: intent.kind, target: intent.target, name };
  }
  return digest;
}
